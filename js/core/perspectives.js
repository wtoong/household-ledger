// 관점(perspective): 저장된 필터. 같은 거래 데이터를 "어떤 시선으로 볼지"만 바꾼다.
// 분류(태그)와 분리돼 있으므로, 거래를 다시 만지지 않고 관점만 갈아끼우면 된다.
//   - 태그된 거래 하나는 모든 관점에서 자동으로 알맞게 포함/제외된다(작업량이 곱→합으로 줄어드는 지점).
//   - 태그가 없어도 금액 임계값/이체 여부만으로 큰 자금이동을 상당 부분 걸러낸다(A 우선 동작).
(function () {
  window.HL = window.HL || {};

  const BIG_AMOUNT = 3000000;            // 절댓값 임계: 이 이상은 "큰 자금이동" 후보
  const BIG_TAGS = ["부동산", "대출", "투자"]; // 이 태그가 붙으면 금액과 무관하게 큰 자금이동

  // 생활 현금흐름에서 빼고 싶은 "큰/내부 이동" 판정.
  function isBigMove(t) {
    if (t.type === "transfer" || t.excludeFromTotal === true) return true;
    if (Math.abs(t.amount || 0) >= BIG_AMOUNT) return true;
    const tags = t.tags || [];
    for (let i = 0; i < tags.length; i++) if (BIG_TAGS.indexOf(tags[i]) !== -1) return true;
    return false;
  }

  function hasTag(t, tag) { return (t.tags || []).indexOf(tag) !== -1; }

  const LIST = [
    { id: "all", label: "전체", desc: "모든 거래", match: function () { return true; } },
    { id: "daily", label: "생활 현금흐름", desc: "부동산·고액·이체 제외한 자잘한 흐름",
      match: function (t) { return !isBigMove(t); } },
    { id: "big", label: "큰 자금이동", desc: "부동산·대출·투자·이체·고액(" + (BIG_AMOUNT / 10000) + "만↑)",
      match: isBigMove },
    { id: "realestate", label: "부동산", desc: "부동산 태그가 붙은 거래",
      match: function (t) { return hasTag(t, "부동산"); } },
  ];

  function get(id) {
    for (let i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return LIST[0];
  }

  // 관점 필터 적용. 다른 필터(기간/검색 등)와 독립적으로 합성된다.
  function apply(txs, id) {
    const p = get(id);
    if (p.id === "all") return txs.slice();
    return txs.filter(p.match);
  }

  // 세그먼트형 관점 선택기를 container에 그린다. 대시보드/거래내역에서 재사용.
  function renderSelector(container, activeId, onChange) {
    container.innerHTML = "";
    container.className = "perspective-bar";
    LIST.forEach(function (p) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "persp-btn" + (p.id === activeId ? " active" : "");
      b.textContent = p.label;
      b.title = p.desc;
      b.addEventListener("click", function () {
        if (HL.state.perspective === p.id) return;
        HL.state.perspective = p.id;
        onChange(p.id);
      });
      container.appendChild(b);
    });
  }

  HL.perspectives = {
    LIST: LIST,
    BIG_AMOUNT: BIG_AMOUNT,
    get: get,
    apply: apply,
    renderSelector: renderSelector,
  };
})();
