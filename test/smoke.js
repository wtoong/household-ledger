// 핵심 로직 스모크 테스트 (브라우저 없이 Node에서 실행).
// window/IndexedDB를 최소 스텁으로 대체하고 파싱/집계/멱등 로직을 검증한다.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { console: console, Intl: Intl, Date: Date, Math: Math, setTimeout: setTimeout,
  TextDecoder: TextDecoder, Uint8Array: Uint8Array, JSON: JSON, parseFloat: parseFloat, isNaN: isNaN };
sandbox.window = sandbox;
sandbox.crypto = { randomUUID: () => "id-" + Math.random().toString(16).slice(2) };
vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  vm.runInContext(code, sandbox, { filename: rel });
}

["js/lib/hash.js", "js/lib/encoding.js", "js/core/aggregate.js", "js/core/balance.js",
 "js/adapters/registry.js", "js/adapters/mg-account.js", "js/adapters/toss-paste.js",
 "js/core/categories.js", "js/core/perspectives.js",
 "js/core/store.js"].forEach(load);

const HL = sandbox.HL;

// 인메모리 IndexedDB 스텁 (멱등 로직 검증용)
const _db = [];
HL.idb = {
  getAll: () => Promise.resolve(_db.slice()),
  getAllDedupKeys: () => Promise.resolve(new Set(_db.map((t) => t.dedupKey))),
  putMany: (items) => { items.forEach((i) => _db.push(i)); return Promise.resolve(items.length); },
  remove: (id) => { const i = _db.findIndex((t) => t.id === id); if (i >= 0) _db.splice(i, 1); return Promise.resolve(); },
  clear: () => { _db.length = 0; return Promise.resolve(); },
};

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

(async function () {
  console.log("\n[1] 새마을금고 CSV 파싱 (입금/출금 분리 컬럼, EUC-KR 가정)");
  const mg = HL.adapters.get("mg-account");
  const csv = [
    "거래일시,적요,출금금액,입금금액,잔액",
    "2026-06-01,급여,,2500000,3000000",
    "2026.06.03,스타벅스,5000,,2995000",
    "20260610,이마트,52000,,2943000",
    "합계,,57000,2500000,",
  ].join("\n");
  const rows = HL.encoding.parseCsv(csv);
  const txs = mg._internal.rowsToTransactions(rows);
  check("3건 추출 (합계줄 스킵)", txs.length === 3);
  check("급여 +2,500,000 income", txs[0].amount === 2500000 && txs[0].type === "income");
  check("스타벅스 -5,000 expense", txs[1].amount === -5000 && txs[1].type === "expense");
  check("YYYYMMDD 날짜 파싱", txs[2].date === "2026-06-10");
  check("dedupKey 존재", !!txs[0].dedupKey);

  console.log("\n[2] 단일 금액 컬럼(부호 포함) + 다른 헤더명");
  const csv2 = HL.encoding.parseCsv(["거래일자,거래내용,거래금액,거래후잔액",
    "2026/05/02,월세,-700000,1000000",
    "2026/05/05,이자,1200,1001200"].join("\n"));
  const txs2 = mg._internal.rowsToTransactions(csv2);
  check("월세 -700,000", txs2[0].amount === -700000);
  check("이자 +1,200 income", txs2[1].amount === 1200 && txs2[1].type === "income");

  console.log("\n[3] 멱등 임포트 (같은 파일 두 번)");
  _db.length = 0;
  const r1 = await HL.store.importTransactions(txs);
  const r2 = await HL.store.importTransactions(txs);
  check("1차: 3건 추가", r1.added === 3 && r1.skipped === 0);
  check("2차: 0건 추가, 3건 스킵", r2.added === 0 && r2.skipped === 3);
  check("DB 총 3건", _db.length === 3);

  console.log("\n[4] 토스 JSON 붙여넣기 어댑터");
  const toss = HL.adapters.get("toss");
  const tjson = '```json\n[{"date":"2026-06-14","amount":-12000,"type":"expense","description":"스타벅스 강남","balance":1530000},{"date":"2026-06-14","amount":2500000,"description":"급여","balance":1542000}]\n```';
  const ttx = await toss.parseText(tjson);
  check("코드펜스 벗기고 2건 파싱", ttx.length === 2);
  check("음수→expense, type 자동추론", ttx[0].type === "expense" && ttx[1].type === "income");
  check("source=toss", ttx[0].source === "toss");

  console.log("\n[4-1] 미래 날짜(오늘 이후)는 잘못된 정보라 버린다");
  const pad2 = (n) => (n < 10 ? "0" : "") + n;
  const now = new Date();
  const todayIso = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
  const future = new Date(now.getTime() + 86400000 * 2);
  const futureIso = future.getFullYear() + "-" + pad2(future.getMonth() + 1) + "-" + pad2(future.getDate());
  const fjson = JSON.stringify([
    { date: "2026-01-02", amount: -1000, description: "과거거래" },
    { date: todayIso, amount: -2000, description: "오늘거래" },
    { date: futureIso, amount: -3000, description: "미래거래" },
  ]);
  const ftx = await toss.parseText(fjson);
  check("미래 거래 제외 (3건 중 2건)", ftx.length === 2);
  check("당일 거래는 유지", ftx.some((t) => t.date === todayIso));
  check("미래 거래는 없음", !ftx.some((t) => t.date === futureIso));
  let onlyFutureErr = null;
  try { await toss.parseText(JSON.stringify([{ date: futureIso, amount: -100, description: "x" }])); }
  catch (e) { onlyFutureErr = e; }
  check("전부 미래면 안내 에러", !!onlyFutureErr && /미래 날짜/.test(onlyFutureErr.message));

  console.log("\n[5] 월별 집계 (transfer 제외)");
  const sample = [
    { date: "2026-06-01", amount: 2500000, type: "income" },
    { date: "2026-06-03", amount: -5000, type: "expense" },
    { date: "2026-06-10", amount: -800000, type: "transfer", excludeFromTotal: true },
    { date: "2026-05-20", amount: -30000, type: "expense" },
  ];
  const m = HL.aggregate.monthly(sample);
  const jun = m.find((x) => x.month === "2026-06");
  check("2026-06 수입 2,500,000", jun.income === 2500000);
  check("2026-06 지출 5,000 (transfer 제외)", jun.expense === 5000);
  check("2026-06 순액 2,495,000", jun.net === 2495000);
  check("월 정렬: 05가 06보다 먼저", m[0].month === "2026-05");

  console.log("\n[7] 잔액 추이 (소스별 마지막 잔액 합산)");
  const balSample = [
    { date: "2026-06-01", amount: -5000, source: "mg-account", balance: 1000 },
    { date: "2026-06-02", amount: -3000, source: "toss", balance: 500 },
    { date: "2026-06-03", amount: 200, source: "mg-account", balance: 1200 },
    { date: "2026-06-03", amount: -100, source: "mg-account", balance: 1100 },
    { date: "2026-06-04", amount: -1000, source: "no-balance-here" }, // balance 없음 → 제외
  ];
  const bs = HL.aggregate.balanceSeries(balSample);
  check("3개 시점(날짜 중복 병합, balance 없는 건 제외)", bs.length === 3);
  check("첫 시점 합산 1000", bs[0].balance === 1000);
  check("둘째 시점 합산 1500 (mg1000+toss500)", bs[1].balance === 1500);
  check("같은 날 마지막 값 사용: 1100+500=1600", bs[2].balance === 1600);
  check("날짜 오름차순", bs[0].date === "2026-06-01" && bs[2].date === "2026-06-03");
  check("balance 없으면 빈 배열", HL.aggregate.balanceSeries([{ date: "2026-06-01", amount: 1 }]).length === 0);

  console.log("\n[7-1] 월 산술/범위 유틸 + 기간 잔액 추이/합계");
  check("addMonths 다음달", HL.aggregate.addMonths("2026-06", 1) === "2026-07");
  check("addMonths 연 넘김(+)", HL.aggregate.addMonths("2026-11", 3) === "2027-02");
  check("addMonths 연 넘김(-)", HL.aggregate.addMonths("2026-01", -2) === "2025-11");
  check("monthDiff", HL.aggregate.monthDiff("2026-01", "2026-06") === 5 && HL.aggregate.monthDiff("2026-06", "2026-01") === -5);
  const mr = HL.aggregate.monthRange("2025-11", "2026-02");
  check("monthRange 연속 4개월", mr.length === 4 && mr[0] === "2025-11" && mr[3] === "2026-02");
  check("monthRange 역순이면 빈 배열", HL.aggregate.monthRange("2026-06", "2026-01").length === 0);
  // 기간(월) 필터: 6월만 잘라내도 합산 절대값은 유지(다른 계좌의 5월 잔액 보존)
  const balSpan = [
    { date: "2026-05-20", amount: -5000, source: "toss", balance: 500 },     // 5월(필터 밖)
    { date: "2026-06-02", amount: -3000, source: "mg-account", balance: 1000 },
    { date: "2026-06-03", amount: 200, source: "mg-account", balance: 1200 },
  ];
  const bsRange = HL.aggregate.balanceSeries(balSpan, "2026-06", "2026-06");
  check("기간 필터: 6월 2시점만 남음", bsRange.length === 2 && bsRange[0].date === "2026-06-02");
  check("기간 필터: 합산값 보존(toss500+mg1000=1500)", bsRange[0].balance === 1500);
  check("기간 밖(7월)이면 빈 배열", HL.aggregate.balanceSeries(balSpan, "2026-07", "2026-07").length === 0);
  // 기간 합계
  const rngSample = [
    { date: "2026-04-10", amount: -10000, type: "expense" },
    { date: "2026-05-10", amount: 200000, type: "income" },
    { date: "2026-05-12", amount: -5000, type: "expense" },
    { date: "2026-06-10", amount: -30000, type: "expense" },
  ];
  const rt = HL.aggregate.totalsForRange(rngSample, "2026-05", "2026-06");
  check("totalsForRange 수입 200,000", rt.income === 200000);
  check("totalsForRange 지출 35,000(5월12+6월30k)", rt.expense === 35000);
  check("totalsForRange 순액 165,000", rt.net === 165000);
  check("totalsForRange 건수 3(4월 제외)", rt.count === 3);

  console.log("\n[6] CSV 내보내기 round-trip 헤더");
  const csvOut = HL.store.exportCSV(_db);
  check("CSV 헤더 포함(time 컬럼)", csvOut.indexOf("date,time,amount,type,description,source") !== -1);

  console.log("\n[7] 시각(time) 파싱 + 같은 날 정렬");
  // 새마을금고: 거래일시 컬럼에 시각 포함
  const csvT = HL.encoding.parseCsv(["거래일시,적요,출금금액,입금금액,잔액",
    "2026-05-22 09:30:00,아침,1000,,100000",
    "2026-05-22 18:45:12,저녁,2000,,98000"].join("\n"));
  const txsT = mg._internal.rowsToTransactions(csvT);
  check("거래일시에서 시각 추출", txsT[0].time === "09:30:00" && txsT[1].time === "18:45:12");
  check("시각이 dedupKey를 구분", txsT[0].dedupKey !== txsT[1].dedupKey);

  // 토스: 별도 time 필드
  const tossT = await toss.parseText(JSON.stringify([
    { date: "2026-05-22", time: "23:10", amount: -20000, description: "남현지", balance: 15363722 },
    { date: "2026-05-22", time: "08:00", amount: -25600, description: "버거킹", balance: 15338122 },
  ]));
  check("토스 time 필드 파싱", tossT[0].time === "23:10:00" && tossT[1].time === "08:00:00");
  check("토스 time 없으면 undefined", (await toss.parseText('[{"date":"2026-05-22","amount":-100,"description":"x"}]'))[0].time === undefined);

  // 같은 날 시각 역순 정렬 (transactions.dtKey 동작과 동일한 키)
  function dtKey(t) { return t.date + "T" + (t.time || ""); }
  const mixed = [
    { date: "2026-05-22", time: "08:00:00" }, // 버거킹
    { date: "2026-05-22", time: "23:10:00" }, // 남현지
    { date: "2026-05-23", time: undefined },  // 다음날
  ].slice().sort((a, b) => { const ka = dtKey(a), kb = dtKey(b); return ka === kb ? 0 : (ka < kb ? 1 : -1); });
  check("다음날이 맨 위", mixed[0].date === "2026-05-23");
  check("같은 날은 늦은 시각이 먼저", mixed[1].time === "23:10:00" && mixed[2].time === "08:00:00");

  console.log("\n[8] 잔액 검증: 연속성 확정 + 누락 추정");
  // 같은 계좌(source) 시간순 체인. 두번째 거래의 잔액이 한 칸 어긋나 누락 추정이 떠야 한다.
  const chain = [
    { id: "a", source: "mg", date: "2026-06-01", time: "09:00:00", amount: 100000, balance: 100000 },
    { id: "b", source: "mg", date: "2026-06-02", time: "10:00:00", amount: -3000, balance: 97000 },   // ok: 100000-3000
    { id: "c", source: "mg", date: "2026-06-03", time: "11:00:00", amount: -5000, balance: 80000 },   // gap: 97000-5000=92000≠80000
    { id: "d", source: "mg", date: "2026-06-04", time: "12:00:00", amount: -2000, balance: 78000 },   // ok: 80000-2000
  ];
  const rep = HL.balance.validate(chain);
  check("첫 거래는 기준점(start)", rep.annotations.a.status === "start");
  check("연속 일치 거래는 ok", rep.annotations.b.status === "ok" && rep.annotations.d.status === "ok");
  check("어긋난 거래는 gap", rep.annotations.c.status === "gap");
  check("누락 추정액 -12,000 (출금)", rep.annotations.c.gapAmount === -12000);
  check("문제 1곳 집계", rep.summary.gaps === 1 && rep.problems.filter((p) => p.kind === "gap").length === 1);

  console.log("\n[9] 같은 시각 묶음: 잔액으로 순서 보정");
  // 동일 날짜·시각, 잔액만으로 올바른 순서를 찾아야 한다(들어온 순서는 거꾸로).
  const sameTime = [
    { id: "x", source: "mg", date: "2026-06-10", time: "14:00:00", amount: -12000, balance: 1530000 }, // 나중
    { id: "y", source: "mg", date: "2026-06-10", time: "14:00:00", amount: 2500000, balance: 1542000 }, // 먼저
  ];
  const rep2 = HL.balance.validate(sameTime);
  check("잔액 체인이 맞는 순서로 rank 확정(y가 먼저)", rep2.orderRank.y < rep2.orderRank.x);
  check("보정 후 x는 연속 ok", rep2.annotations.x.status === "ok");
  check("순서 보정 1곳 기록", rep2.summary.reordered === 1);

  console.log("\n[10] 잔액 없는 건 + 계좌 분리");
  const mixed2 = [
    { id: "p", source: "mg", date: "2026-06-01", amount: -1000 },                       // 잔액 없음
    { id: "q", source: "toss", date: "2026-06-01", amount: -1000, balance: 5000 },       // 다른 계좌, 단독
  ];
  const rep3 = HL.balance.validate(mixed2);
  check("잔액 없는 건 no-balance", rep3.annotations.p.status === "no-balance" && rep3.summary.noBalance === 1);
  check("다른 계좌 단독은 start", rep3.annotations.q.status === "start");

  console.log("\n[11] 거래 개별 삭제 (잘못 들어온 거래 제거)");
  _db.length = 0;
  await HL.store.importTransactions(txs); // 3건
  const before = (await HL.store.getAll()).length;
  const victim = (await HL.store.getAll())[0];
  await HL.store.remove(victim.id);
  const after = await HL.store.getAll();
  check("삭제 전 3건", before === 3);
  check("1건 삭제 후 2건", after.length === 2);
  check("삭제한 id는 사라짐", !after.some((t) => t.id === victim.id));
  // 삭제해도 dedupKey가 비므로 같은 거래를 다시 임포트할 수 있어야 한다(되돌리기/재시도).
  const reAdd = await HL.store.importTransactions([{ date: victim.date, time: victim.time, amount: victim.amount,
    type: victim.type, description: victim.description, source: victim.source, balance: victim.balance, dedupKey: victim.dedupKey }]);
  check("삭제 후 같은 거래 재임포트 가능", reAdd.added === 1);

  console.log("\n[12] 토스 프롬프트: 날짜 구분선 상속 규칙 명시");
  const tossPrompt = HL.adapters.get("toss").promptText;
  check("위쪽 날짜 구분선을 따르라는 규칙 포함", tossPrompt.indexOf("위쪽") !== -1 && tossPrompt.indexOf("날짜 구분선") !== -1);
  check("아래쪽 날짜를 쓰지 말라는 경고 포함", tossPrompt.indexOf("아래쪽") !== -1);

  console.log("\n[13] 계좌(account) 기준: 토스+CSV 같은 계좌를 한 체인으로 병합 검증");
  // 같은 새마을금고 계좌를 CSV(급여)와 토스 캡쳐(커피)로 나눠 넣어도 account가 같으면 한 체인.
  const mgRows = HL.encoding.parseCsv(["거래일시,적요,출금금액,입금금액,잔액",
    "2026-06-01 09:00:00,급여,,1000000,1000000"].join("\n"));
  const mgTx = mg._internal.rowsToTransactions(mgRows, "주계좌");
  check("account 라벨 스탬프", mgTx[0].account === "주계좌");
  // account를 주면 dedupKey가 source-폴백과 달라진다(계좌가 키에 반영됨)
  const mgNoAcct = mg._internal.rowsToTransactions(mgRows);
  check("account가 dedupKey에 반영(미지정과 다름)", mgTx[0].dedupKey !== mgNoAcct[0].dedupKey);
  check("account 미지정은 기존대로 source 폴백(키 안정)", mgNoAcct[0].account === undefined);

  const tossAcct = await toss.parseText(
    '[{"date":"2026-06-02","time":"10:00","amount":-3000,"description":"커피","balance":997000}]', { account: "주계좌" });
  check("토스도 account 스탬프", tossAcct[0].account === "주계좌");

  const merged = [
    Object.assign({ id: "m1" }, mgTx[0]),
    Object.assign({ id: "t1" }, tossAcct[0]),
  ];
  const repM = HL.balance.validate(merged);
  check("같은 계좌라 한 체인: CSV가 기준점", repM.annotations.m1.status === "start");
  check("토스 거래가 잔액으로 연속 확정(ok)", repM.annotations.t1.status === "ok");
  check("누락/문제 없음", repM.summary.gaps === 0);

  console.log("\n[14] 분류: 정규화 기본값 + 태그 보존");
  _db.length = 0;
  const nr = await HL.store.importTransactions([
    { date: "2026-06-01", amount: -5000, description: "스벅", dedupKey: "k1" },
  ]);
  check("import 1건", nr.added === 1);
  const norm = (await HL.idb.getAll())[0];
  check("tags 기본 []", Array.isArray(norm.tags) && norm.tags.length === 0);
  check("tagStatus 기본 none", norm.tagStatus === "none");

  console.log("\n[15] 분류 프롬프트 생성 + 결과 파싱");
  const prompt = HL.categories.buildPrompt([{ id: "abc", date: "2026-06-01", amount: -5000, description: "스타벅스" }]);
  check("허용 태그가 프롬프트에 포함", prompt.indexOf("식비") !== -1 && prompt.indexOf("부동산") !== -1);
  check("입력 id가 payload에 포함", prompt.indexOf('"id":"abc"') !== -1);

  const known = new Set(["abc", "def"]);
  const parsed = HL.categories.parseResult(
    '```json\n[{"id":"abc","tags":["식비","없는태그"],"confidence":0.9,"status":"ok"},' +
    '{"id":"def","tags":[],"confidence":0.1,"status":"skip"},' +
    '{"id":"zzz","tags":["식비"],"status":"ok"}]\n```', known);
  check("코드펜스 벗기고 파싱", parsed.error === null);
  check("모르는 id(zzz) 1건 무시", parsed.unknown === 1 && parsed.matched === 2);
  check("허용 외 태그 제거", parsed.items[0].tags.length === 1 && parsed.items[0].tags[0] === "식비");
  check("status skip 또는 빈 태그 → skip", parsed.items[1].skip === true);

  console.log("\n[16] 관점(perspective) 필터");
  const pTx = [
    { amount: -8000, type: "expense", tags: [] },                    // 생활
    { amount: -300000000, type: "expense", tags: ["부동산"] },       // 부동산/큰 자금
    { amount: -5000000, type: "expense", tags: [] },                 // 금액만으로 큰 자금
    { amount: -1000000, type: "transfer", excludeFromTotal: true, tags: [] }, // 이체
  ];
  check("전체 = 4건", HL.perspectives.apply(pTx, "all").length === 4);
  check("생활 현금흐름 = 1건(자잘한 것만)", HL.perspectives.apply(pTx, "daily").length === 1);
  check("큰 자금이동 = 3건", HL.perspectives.apply(pTx, "big").length === 3);
  check("부동산 = 1건(태그 기준)", HL.perspectives.apply(pTx, "realestate").length === 1);
  check("알 수 없는 관점은 전체로 폴백", HL.perspectives.apply(pTx, "nope").length === 4);

  console.log("\n결과: " + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
