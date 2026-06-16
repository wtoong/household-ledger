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

  console.log("\n[6] CSV 내보내기 round-trip 헤더");
  const csvOut = HL.store.exportCSV(_db);
  check("CSV 헤더 포함", csvOut.indexOf("date,amount,type,description,source") !== -1);

  console.log("\n결과: " + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
