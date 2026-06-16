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

["js/lib/hash.js", "js/lib/encoding.js", "js/core/aggregate.js",
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

  console.log("\n[8] 분류: 정규화 기본값 + 태그 보존");
  _db.length = 0;
  const nr = await HL.store.importTransactions([
    { date: "2026-06-01", amount: -5000, description: "스벅", dedupKey: "k1" },
  ]);
  check("import 1건", nr.added === 1);
  const norm = (await HL.idb.getAll())[0];
  check("tags 기본 []", Array.isArray(norm.tags) && norm.tags.length === 0);
  check("tagStatus 기본 none", norm.tagStatus === "none");

  console.log("\n[9] 분류 프롬프트 생성 + 결과 파싱");
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

  console.log("\n[10] 관점(perspective) 필터");
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
