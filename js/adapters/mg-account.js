// 새마을금고 계좌(허브) 어댑터. CSV/XLSX 모두 대응.
// 실제 컬럼 스키마는 다운로드 파일마다 다를 수 있어(헤더명 변동) 동의어 매칭으로 견고하게 처리한다.
(function () {
  window.HL = window.HL || {};

  const SOURCE = "mg-account";

  // 헤더 동의어 (정규화 후 '포함' 매칭)
  const SYN = {
    date: ["거래일시", "거래일자", "거래일", "이체일", "거래날짜", "일자", "날짜", "date"],
    withdraw: ["출금금액", "출금액", "출금", "지급금액", "보내신금액", "지출금액", "지출"],
    deposit: ["입금금액", "입금액", "입금", "받으신금액", "수입금액"],
    amount: ["거래금액", "금액", "amount"],
    balance: ["거래후잔액", "잔액", "balance"],
    desc: ["거래내용", "적요내용", "적요", "내용", "기재내용", "받는분", "보내는분", "메모", "가맹점", "거래처", "비고", "description"],
  };

  function norm(s) {
    return String(s == null ? "" : s).replace(/\s+/g, "").replace(/[()（）]/g, "").toLowerCase();
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function toIso(v) {
    if (v instanceof Date && !isNaN(v)) {
      return v.getFullYear() + "-" + pad2(v.getMonth() + 1) + "-" + pad2(v.getDate());
    }
    const s = String(v == null ? "" : v).trim();
    if (!s) return null;
    let m = s.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
    if (m) return m[1] + "-" + pad2(+m[2]) + "-" + pad2(+m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    const d = new Date(s);
    if (!isNaN(d)) return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    return null;
  }

  // 시각 추출: "HH:MM" 또는 "HH:MM:SS"(24시간) 정규화. 없으면 null.
  // 거래일시 컬럼(예: "2026-06-01 14:30:25")이나 별도 시각 값 모두 대응.
  function toTime(v) {
    if (v instanceof Date && !isNaN(v)) {
      const t = v.getHours() || v.getMinutes() || v.getSeconds();
      if (!t) return null; // 자정(시각 정보 없음으로 간주)은 무시
      return pad2(v.getHours()) + ":" + pad2(v.getMinutes()) + ":" + pad2(v.getSeconds());
    }
    const s = String(v == null ? "" : v).trim();
    if (!s) return null;
    const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const hh = +m[1], mm = +m[2], ss = m[3] == null ? 0 : +m[3];
    if (hh > 23 || mm > 59 || ss > 59) return null;
    return pad2(hh) + ":" + pad2(mm) + ":" + pad2(ss);
  }

  function num(v) {
    if (typeof v === "number") return v;
    let s = String(v == null ? "" : v).trim();
    if (!s) return 0;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[₩원,\s]/g, "");
    if (s[0] === "-") { neg = true; s = s.slice(1); }
    if (s[0] === "+") s = s.slice(1);
    s = s.replace(/[^0-9.]/g, "");
    if (s === "") return 0;
    const n = parseFloat(s);
    if (isNaN(n)) return 0;
    return neg ? -n : n;
  }

  // headers 배열에서 동의어에 맞는 컬럼 인덱스를 찾는다
  function findCol(headers, syns) {
    const H = headers.map(norm);
    // 정확 일치 우선
    for (let s = 0; s < syns.length; s++) {
      const key = norm(syns[s]);
      for (let i = 0; i < H.length; i++) if (H[i] === key) return i;
    }
    // 포함 매칭
    for (let s = 0; s < syns.length; s++) {
      const key = norm(syns[s]);
      for (let i = 0; i < H.length; i++) if (H[i].indexOf(key) !== -1) return i;
    }
    return -1;
  }

  // 헤더 행 탐지: 동의어 매칭이 가장 많이 되는 행을 헤더로 본다(상단 안내문 스킵)
  function detectHeaderRow(rows) {
    let best = -1, bestScore = 0;
    const limit = Math.min(rows.length, 15);
    for (let r = 0; r < limit; r++) {
      const headers = rows[r];
      let score = 0;
      ["date", "desc", "withdraw", "deposit", "amount", "balance"].forEach(function (k) {
        if (findCol(headers, SYN[k]) !== -1) score++;
      });
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return bestScore >= 2 ? best : 0;
  }

  function rowsToTransactions(rows, account) {
    if (!rows.length) return [];
    const hr = detectHeaderRow(rows);
    const headers = rows[hr];
    const cDate = findCol(headers, SYN.date);
    const cWd = findCol(headers, SYN.withdraw);
    const cDp = findCol(headers, SYN.deposit);
    const cAmt = findCol(headers, SYN.amount);
    const cBal = findCol(headers, SYN.balance);
    const cDesc = findCol(headers, SYN.desc);

    if (cDate === -1 || (cWd === -1 && cDp === -1 && cAmt === -1)) {
      throw new Error(
        "컬럼을 인식하지 못했습니다. 감지된 헤더: [" + headers.join(" | ") + "]\n" +
        "날짜 컬럼과 (입금/출금 또는 금액) 컬럼이 필요합니다."
      );
    }

    const out = [];
    for (let r = hr + 1; r < rows.length; r++) {
      const row = rows[r];
      const date = toIso(row[cDate]);
      if (!date) continue; // 합계줄/빈줄/안내문 스킵
      const time = toTime(row[cDate]); // 거래일시 컬럼에 시각이 함께 있으면 추출

      let amount;
      if (cWd !== -1 || cDp !== -1) {
        const wd = cWd !== -1 ? num(row[cWd]) : 0;
        const dp = cDp !== -1 ? num(row[cDp]) : 0;
        amount = Math.abs(dp) - Math.abs(wd);
      } else {
        amount = num(row[cAmt]);
      }
      if (amount === 0) continue;

      const description = cDesc !== -1 ? String(row[cDesc] == null ? "" : row[cDesc]).trim() : "";
      const balance = cBal !== -1 ? num(row[cBal]) : undefined;

      // dedupKey 기준은 '계좌(account)'. 지정 안 하면 SOURCE로 폴백해 기존 멱등성을 유지한다.
      // 시각·잔액까지 포함해 같은 날 동일 금액/적요 충돌을 줄인다 (PRD 5.2)
      const acct = account || SOURCE;
      const keyParts = [acct, date, time || "", amount, description, balance == null ? "" : balance];
      out.push({
        date: date,
        time: time || undefined,
        amount: amount,
        type: amount >= 0 ? "income" : "expense",
        description: description,
        source: SOURCE,
        account: account || undefined,
        balance: typeof balance === "number" ? balance : undefined,
        dedupKey: HL.hash.cyrb53(keyParts.join("|")),
      });
    }
    return out;
  }

  function readFileBuffer(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }

  function parse(file, opts) {
    const account = opts && opts.account ? opts.account : undefined;
    const name = (file.name || "").toLowerCase();
    const isXlsx = /\.(xlsx|xls)$/.test(name);
    return readFileBuffer(file).then(function (buf) {
      let rows;
      if (isXlsx) {
        if (typeof XLSX === "undefined") {
          throw new Error("XLSX 파서(vendor/xlsx.full.min.js)가 로드되지 않았습니다.");
        }
        const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      } else {
        const text = HL.encoding.decodeBuffer(buf);
        rows = HL.encoding.parseCsv(text);
      }
      return rowsToTransactions(rows, account);
    });
  }

  HL.adapters.register({
    id: SOURCE,
    label: "새마을금고 계좌 (CSV/XLSX)",
    kind: "file",
    accept: ".csv,.xlsx,.xls",
    help: "새마을금고 인터넷뱅킹 거래내역조회에서 받은 CSV 또는 XLSX 파일을 업로드하세요. 인코딩(EUC-KR/UTF-8)은 자동 감지됩니다.",
    parse: parse,
    // 테스트/디버깅을 위해 내부 함수 노출
    _internal: { rowsToTransactions: rowsToTransactions, toIso: toIso, toTime: toTime, num: num },
  });
})();
