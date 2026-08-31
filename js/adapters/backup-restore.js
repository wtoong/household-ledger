// 백업 JSON 복원 어댑터. "JSON 내보내기"로 받은 파일을 그대로 되돌린다.
//
// 다른 어댑터와 달리 값을 새로 만들지 않고 '보존'하는 것이 목적이다:
//   id / source / account / dedupKey / importedAt / 태그 / 분류 상태를 원본 그대로 되살린다.
//   (토스 어댑터에 백업을 붙여넣으면 전부 source=toss로 바뀌고 id·dedupKey가 재계산되어 백업이 아니게 된다.)
// dedupKey가 그대로라서 이미 같은 거래가 있으면 중복으로 걸러진다 → 몇 번 복원해도 안전하다.
(function () {
  window.HL = window.HL || {};

  const SOURCE = "backup";

  function toNum(v) {
    if (typeof v === "number") return v;
    if (v == null || v === "") return NaN;
    const n = parseFloat(String(v).replace(/[,\s₩원]/g, ""));
    return isNaN(n) ? NaN : n;
  }

  // 백업 레코드 1건 → 표준 거래. 되살릴 수 없는 항목은 null.
  function reviveRow(r) {
    if (!r || typeof r !== "object") return null;
    const mg = HL.adapters.get("mg-account")._internal;

    const date = mg.toIso(r.date);
    const amount = toNum(r.amount);
    if (!date || isNaN(amount) || amount === 0) return null;

    const time = mg.toTime(r.time) || mg.toTime(r.date) || undefined;
    const description = String(r.description == null ? "" : r.description).trim();
    const account = r.account ? String(r.account).trim() : undefined;
    // source가 비어 있으면 계좌 라벨이라도 있어야 잔액 체인이 갈라지지 않는다. 둘 다 없으면 SOURCE로 표시.
    const source = r.source ? String(r.source).trim() : (account ? SOURCE : SOURCE);
    const balNum = toNum(r.balance);
    const balance = isNaN(balNum) ? undefined : balNum;

    // CSV에서 손으로 옮겨 적어 dedupKey가 빠진 경우를 대비해 같은 공식으로 다시 만든다.
    const dedupKey = r.dedupKey ? String(r.dedupKey)
      : HL.hash.txDedupKey(account || source, date, time, amount, description, balance);

    return {
      id: r.id ? String(r.id) : undefined,             // store.normalize가 없으면 새로 발급
      date: date,
      time: time,
      amount: amount,
      type: r.type || (amount >= 0 ? "income" : "expense"),
      description: description,
      source: source,
      account: account,
      balance: balance,
      dedupKey: dedupKey,
      importedAt: r.importedAt ? String(r.importedAt) : undefined,
      // 분류 작업 결과까지 살려야 복원 후 다시 LLM을 돌리지 않는다.
      tags: Array.isArray(r.tags) ? r.tags.slice() : [],
      tagStatus: r.tagStatus || "none",
      tagSource: r.tagSource || undefined,
      category: r.category,
      installment: r.installment,
      excludeFromTotal: r.excludeFromTotal === true ? true : undefined,
    };
  }

  function parseText(text) {
    return new Promise(function (resolve, reject) {
      let raw = String(text || "").trim();
      if (!raw) return reject(new Error("복원할 JSON을 붙여넣으세요."));
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return reject(new Error("JSON 파싱 실패: " + e.message + "\n내보내기로 받은 JSON 파일의 내용을 그대로 붙여넣었는지 확인하세요."));
      }
      if (!Array.isArray(data)) {
        if (data && Array.isArray(data.transactions)) data = data.transactions;
        else return reject(new Error("JSON 최상위는 거래 배열이어야 합니다. (내보내기 파일은 [ ... ] 형태입니다)"));
      }

      const out = [];
      let dropped = 0;
      for (let i = 0; i < data.length; i++) {
        const t = reviveRow(data[i]);
        if (t) out.push(t); else dropped++;
      }
      if (!out.length) {
        return reject(new Error("복원할 거래를 찾지 못했습니다. (date/amount 필드를 확인하세요)"));
      }
      if (dropped) {
        // 조용히 버리지 않고 알린다. 백업 복원은 '전부 돌아왔는지'가 핵심이라 건수 불일치를 숨기면 안 된다.
        console.warn("[backup] 되살리지 못한 레코드 " + dropped + "건 (date/amount 누락)");
      }
      out._dropped = dropped;
      resolve(out);
    });
  }

  function parse(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || "")); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file, "utf-8");
    }).then(parseText);
  }

  HL.adapters.register({
    id: SOURCE,
    label: "백업 JSON 복원 (내보내기 파일)",
    kind: "file",
    accept: ".json",
    // 계좌 라벨은 백업 안에 이미 들어 있다. 여기서 덮어쓰면 복원이 아니라 재분류가 된다.
    noAccount: true,
    help: "‘데이터 관리 → JSON 내보내기’로 받은 파일을 그대로 올리세요. 계좌·태그·분류 결과까지 원래대로 되살아나며, 이미 있는 거래는 중복으로 걸러집니다.",
    parse: parse,
    parseText: parseText,
    _internal: { reviveRow: reviveRow },
  });
})();
