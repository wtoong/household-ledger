// 토스 캡쳐 → JSON 붙여넣기 어댑터.
// 앱은 외부로 아무것도 전송하지 않는다. 사용자가 동봉된 프롬프트로 자기 LLM(Gemini/ChatGPT/Claude)에서
// 캡쳐→JSON 변환을 직접 수행한 뒤, 그 JSON을 여기에 붙여넣는다. (PRD 2.4 프라이버시 원칙 유지)
(function () {
  window.HL = window.HL || {};

  const SOURCE = "toss";

  const PROMPT = [
    "다음은 토스 앱의 거래내역 화면 캡쳐입니다. 모든 거래 행을 추출해 아래 JSON 배열로만 출력하세요. 설명·코드펜스 없이 순수 JSON만.",
    "",
    "규칙:",
    "- date: \"YYYY-MM-DD\". 화면에 연도가 없으면 가장 가까운 표시 연도/문맥을 쓰고, 불확실하면 항목에 \"uncertain\": true 를 추가.",
    "- time: \"HH:MM\" 또는 \"HH:MM:SS\"(24시간제). 화면/거래 상세에 시각이 있으면 넣고, 없으면 null. (같은 날 거래 정렬에 사용)",
    "- amount: 숫자만(콤마 제거). 출금/결제(잔액 감소)는 음수, 입금/수입은 양수.",
    "- type: 음수면 \"expense\", 양수면 \"income\".",
    "- description: 가맹점명/적요 그대로.",
    "- balance: 화면에 거래 후 잔액이 있으면 숫자로, 없으면 null.",
    "- 같은 날 거래는 화면에 보이는 순서(위→아래) 그대로 유지하세요.",
    "- 광고/배너/합계 요약 줄은 제외. 실제 개별 거래만.",
    "- 금액·날짜가 잘려 불확실한 행은 \"uncertain\": true.",
    "",
    "출력 형식:",
    "[",
    "  {\"date\":\"2026-06-14\",\"time\":\"13:05\",\"amount\":-12000,\"type\":\"expense\",\"description\":\"스타벅스 강남\",\"balance\":1530000},",
    "  {\"date\":\"2026-06-14\",\"time\":null,\"amount\":2500000,\"type\":\"income\",\"description\":\"급여\",\"balance\":1542000}",
    "]",
  ].join("\n");

  function coerceNumber(v) {
    if (typeof v === "number") return v;
    if (v == null) return NaN;
    const s = String(v).replace(/[,\s₩원]/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? NaN : n;
  }

  // 입력 JSON 텍스트 → 표준 거래 배열. opts.account 로 어느 계좌 이력인지 지정.
  function parseText(text, opts) {
    const account = opts && opts.account ? opts.account : undefined;
    return new Promise(function (resolve, reject) {
      let data;
      let raw = String(text || "").trim();
      // 모델이 코드펜스를 붙인 경우 관대하게 벗겨낸다
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return reject(new Error("JSON 파싱 실패: " + e.message + "\n붙여넣은 내용이 올바른 JSON 배열인지 확인하세요."));
      }
      if (!Array.isArray(data)) {
        if (data && Array.isArray(data.transactions)) data = data.transactions;
        else return reject(new Error("JSON 최상위는 거래 배열이어야 합니다."));
      }
      const out = [];
      for (let i = 0; i < data.length; i++) {
        const r = data[i] || {};
        const mgInternal = HL.adapters.get("mg-account")._internal;
        const date = mgInternal.toIso(r.date);
        const amount = coerceNumber(r.amount);
        if (!date || isNaN(amount) || amount === 0) continue;
        // 시각: 별도 time 필드 우선, 없으면 date 문자열(예: "2026-06-14 13:05")에서 추출
        const time = mgInternal.toTime(r.time) || mgInternal.toTime(r.date) || undefined;
        const description = String(r.description == null ? "" : r.description).trim();
        const balance = (r.balance == null || r.balance === "") ? undefined : coerceNumber(r.balance);
        // dedupKey 기준은 '계좌(account)'. 지정 안 하면 SOURCE로 폴백(기존 멱등성 유지).
        const acct = account || SOURCE;
        const keyParts = [acct, date, time || "", amount, description, (balance == null || isNaN(balance)) ? "" : balance];
        out.push({
          date: date,
          time: time,
          amount: amount,
          type: amount >= 0 ? "income" : "expense",
          description: description,
          source: SOURCE,
          account: account || undefined,
          balance: (balance == null || isNaN(balance)) ? undefined : balance,
          dedupKey: HL.hash.cyrb53(keyParts.join("|")),
        });
      }
      if (!out.length) return reject(new Error("유효한 거래를 찾지 못했습니다. (date/amount 형식 확인)"));
      resolve(out);
    });
  }

  HL.adapters.register({
    id: SOURCE,
    label: "토스 캡쳐 (JSON 붙여넣기)",
    kind: "text",
    promptText: PROMPT,
    help: "토스 거래내역 화면을 캡쳐한 뒤, 아래 프롬프트와 함께 본인의 LLM(Gemini/ChatGPT/Claude 등)에 넣어 JSON을 받고, 그 JSON을 붙여넣으세요. 이 앱은 캡쳐나 데이터를 외부로 보내지 않습니다.",
    parseText: parseText,
  });
})();
