// 분류 태그 체계(닫힌 목록) + 외부 LLM 왕복용 프롬프트 생성/결과 파싱.
// 핵심 원칙:
//   - 태그는 "거래의 속성"으로 건당 1회만 매긴다. 관점(perspective)은 이 태그 위에 얹는 필터일 뿐이다.
//   - LLM이 자유롭게 카테고리를 만들면 "식비/외식/음식"처럼 갈라지므로, 반드시 아래 닫힌 목록에서만 고르게 한다.
//   - 앱은 외부로 아무것도 전송하지 않는다. 사용자가 미분류 항목을 본인 LLM에 넣고, 그 JSON을 다시 붙여넣는다.
(function () {
  window.HL = window.HL || {};

  // 허용 태그(닫힌 목록). 한 거래에 여러 개 붙을 수 있다(예: ["부동산","대출"]).
  const TAGS = [
    "부동산", "대출", "투자", "급여", "공과금", "주거",
    "식비", "외식", "교통", "의료", "보험", "교육",
    "여가", "쇼핑", "이체", "기타",
  ];
  const TAG_SET = new Set(TAGS);

  function isAllowed(tag) { return TAG_SET.has(tag); }

  // 허용 목록에 있는 태그만 남기고 중복 제거.
  function sanitizeTags(arr) {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (let i = 0; i < arr.length; i++) {
      const t = String(arr[i] || "").trim();
      if (TAG_SET.has(t) && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  // 미분류 거래 배열 -> LLM에 그대로 붙여넣을 단일 텍스트(지시문 + 입력 JSON).
  // rows: [{id, date, amount, description}]
  function buildPrompt(rows) {
    const payload = (rows || []).map(function (t) {
      return { id: t.id, date: t.date, amount: t.amount, desc: t.description || "" };
    });
    return [
      "다음 가계부 거래들을 분류해줘. 각 거래의 desc(가맹점/적요)를 보고 성격을 판단해.",
      "필요하면 가맹점명을 검색해서라도 추정하되, 확신이 없으면 절대 억지로 끼우지 말 것.",
      "",
      "반드시 아래 허용 태그에서만 고르세요(새 태그 금지). 한 거래에 여러 개 가능:",
      "  " + TAGS.join(", "),
      "",
      "규칙:",
      "- 출력은 아래 형식의 순수 JSON 배열만. 설명·코드펜스 금지.",
      "- id는 입력값을 그대로(똑같이) 되돌려줘. 순서는 바뀌어도 됨.",
      "- tags: 허용 목록의 문자열 배열. 적절한 게 없으면 [].",
      "- status: 분류했으면 \"ok\", 사람 이름·정보 부족 등으로 판단 불가하면 \"skip\".",
      "- confidence: 0~1 사이 확신도(숫자). 검수 우선순위에 쓰임.",
      "- 애매하면 추측하지 말고 status \"skip\", tags [].",
      "",
      "출력 형식:",
      "[",
      "  {\"id\":\"<그대로>\",\"tags\":[\"식비\"],\"confidence\":0.95,\"status\":\"ok\"},",
      "  {\"id\":\"<그대로>\",\"tags\":[],\"confidence\":0.2,\"status\":\"skip\"}",
      "]",
      "",
      "입력:",
      JSON.stringify(payload),
    ].join("\n");
  }

  // LLM이 돌려준 JSON 텍스트 -> 검토용 항목.
  // knownIds: 현재 DB에 존재하는 id Set (모르는 id는 버림).
  // 반환: { items:[{id, tags, confidence, skip}], matched, unknown, error }
  function parseResult(text, knownIds) {
    let raw = String(text || "").trim();
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    if (!raw) return { items: [], matched: 0, unknown: 0, error: "붙여넣은 내용이 비어 있습니다." };
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return { items: [], matched: 0, unknown: 0, error: "JSON 파싱 실패: " + e.message };
    }
    if (!Array.isArray(data)) {
      if (data && Array.isArray(data.items)) data = data.items;
      else return { items: [], matched: 0, unknown: 0, error: "JSON 최상위는 배열이어야 합니다." };
    }
    const items = [];
    let unknown = 0;
    const seen = new Set();
    for (let i = 0; i < data.length; i++) {
      const r = data[i] || {};
      const id = String(r.id == null ? "" : r.id);
      if (!id || (knownIds && !knownIds.has(id)) || seen.has(id)) { unknown++; continue; }
      seen.add(id);
      const tags = sanitizeTags(r.tags);
      let conf = typeof r.confidence === "number" ? r.confidence : parseFloat(r.confidence);
      if (isNaN(conf)) conf = null;
      const skip = r.status === "skip" || tags.length === 0;
      items.push({ id: id, tags: tags, confidence: conf, skip: skip });
    }
    return { items: items, matched: items.length, unknown: unknown, error: null };
  }

  HL.categories = {
    TAGS: TAGS,
    isAllowed: isAllowed,
    sanitizeTags: sanitizeTags,
    buildPrompt: buildPrompt,
    parseResult: parseResult,
  };
})();
