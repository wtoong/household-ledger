// 토스 캡쳐 → JSON 붙여넣기 어댑터.
// 앱은 외부로 아무것도 전송하지 않는다. 사용자가 동봉된 프롬프트로 자기 LLM(Gemini/ChatGPT/Claude)에서
// 캡쳐→JSON 변환을 직접 수행한 뒤, 그 JSON을 여기에 붙여넣는다. (PRD 2.4 프라이버시 원칙 유지)
(function () {
  window.HL = window.HL || {};

  const SOURCE = "toss";

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // 오늘 날짜(YYYY-MM-DD). ISO 문자열이라 사전식 비교로 미래 여부를 판별할 수 있다.
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // 프롬프트는 오늘 날짜를 끼워 넣어야 하므로 접근 시점에 생성한다.
  function buildPrompt() {
    const today = todayIso();
    return [
      "다음은 토스 앱의 거래내역 화면 캡쳐입니다. 모든 거래 행을 추출해 아래 JSON 배열로만 출력하세요. 설명·코드펜스 없이 순수 JSON만.",
      "",
      "화면 구조(중요):",
      "- 토스 거래내역은 최신 거래가 맨 위, 과거 거래가 아래로 가는 '시간 역순'입니다. 보이는 순서를 그대로(위→아래) 유지하세요.",
      "- 날짜는 '6월 14일' 같은 날짜 구분선으로, 그 날 거래들 '바로 위'에 한 번만 표시됩니다. 그 아래 거래들에는 날짜가 다시 안 적힐 수 있습니다.",
      "- 행에 자체 날짜가 없으면, 그 행보다 '위쪽'에 있는 가장 가까운 날짜 구분선의 날짜를 따르세요. 절대로 그 행 '아래쪽'(다음에 나오는 더 과거) 날짜 구분선의 날짜를 쓰지 마세요.",
      "- 즉, 한 날짜 구분선 아래의 모든 거래는 그 다음(더 아래) 날짜 구분선이 나오기 전까지 전부 같은 날짜입니다.",
      "",
      "규칙:",
      "- date: \"YYYY-MM-DD\". 위 '화면 구조'대로 가장 가까운 위쪽 날짜 구분선을 적용하세요. 연도가 없으면 가장 가까운 표시 연도/문맥을 쓰고, 불확실하면 항목에 \"uncertain\": true 를 추가.",
      "- 오늘 날짜는 " + today + " 입니다. 이 날짜 이후(미래)의 날짜는 잘못 인식된 것이므로 그 거래는 출력에서 제외하세요.",
      "- time: \"HH:MM\" 또는 \"HH:MM:SS\"(24시간제). 화면/거래 상세에 시각이 있으면 넣고, 없으면 null. (같은 날 거래 정렬에 사용)",
      "- amount: 숫자만(콤마 제거). 출금/결제(잔액 감소)는 음수, 입금/수입은 양수.",
      "- type: 음수면 \"expense\", 양수면 \"income\".",
      "- description: 가맹점명/적요 그대로.",
      "- balance: 화면에 거래 후 잔액이 있으면 숫자로, 없으면 null.",
      "- 광고/배너/합계 요약 줄은 제외. 실제 개별 거래만.",
      "- 금액·날짜가 잘려 불확실한 행은 \"uncertain\": true.",
      "",
      "출력 형식:",
      "[",
      "  {\"date\":\"2026-06-14\",\"time\":\"13:05\",\"amount\":-12000,\"type\":\"expense\",\"description\":\"스타벅스 강남\",\"balance\":1530000},",
      "  {\"date\":\"2026-06-14\",\"time\":null,\"amount\":2500000,\"type\":\"income\",\"description\":\"급여\",\"balance\":1542000}",
      "]",
    ].join("\n");
  }

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
      let droppedFuture = 0;
      const today = todayIso();
      for (let i = 0; i < data.length; i++) {
        const r = data[i] || {};
        const mgInternal = HL.adapters.get("mg-account")._internal;
        const date = mgInternal.toIso(r.date);
        const amount = coerceNumber(r.amount);
        if (!date || isNaN(amount) || amount === 0) continue;
        // 미래 날짜는 LLM 오인식이므로 버린다 (당일은 유효).
        if (date > today) { droppedFuture++; continue; }
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
      if (!out.length) {
        if (droppedFuture) return reject(new Error("유효한 거래가 없습니다. 미래 날짜(오늘 " + today + " 이후) " + droppedFuture + "건은 잘못된 정보로 제외했습니다."));
        return reject(new Error("유효한 거래를 찾지 못했습니다. (date/amount 형식 확인)"));
      }
      resolve(out);
    });
  }

  HL.adapters.register({
    id: SOURCE,
    label: "토스 캡쳐 (JSON 붙여넣기)",
    kind: "text",
    // 접근 시점의 오늘 날짜를 반영해야 하므로 게터로 노출한다.
    get promptText() { return buildPrompt(); },
    help: "토스 거래내역 화면을 캡쳐한 뒤, 아래 프롬프트와 함께 본인의 LLM(Gemini/ChatGPT/Claude 등)에 넣어 JSON을 받고, 그 JSON을 붙여넣으세요. 이 앱은 캡쳐나 데이터를 외부로 보내지 않습니다.",
    parseText: parseText,
  });
})();
