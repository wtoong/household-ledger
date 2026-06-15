// 거래목록: 기간 필터 + 텍스트 검색(적요) + 수입/지출 필터, 시간 역순, 더보기.
(function () {
  window.HL = window.HL || {};

  function el(id) { return document.getElementById(id); }

  // 정렬용 날짜+시각 키. 시각이 없으면 그날의 가장 이른 거래로 취급("")한다.
  function dtKey(t) { return t.date + "T" + (t.time || ""); }

  const PAGE = 50;
  let _shown = PAGE;
  let _filtered = [];

  function applyFilters() {
    const from = el("tx-from").value;
    const to = el("tx-to").value;
    const q = el("tx-search").value.trim().toLowerCase();
    const type = el("tx-type").value; // all/income/expense

    _filtered = HL.state.transactions.filter(function (t) {
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (type === "income" && t.amount < 0) return false;
      if (type === "expense" && t.amount >= 0) return false;
      if (q && String(t.description || "").toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    _filtered.sort(function (a, b) {
      // 날짜+시각 기준 최신 먼저. 시각이 있으면 같은 날 거래도 올바르게 정렬된다.
      const ka = dtKey(a), kb = dtKey(b);
      if (ka !== kb) return ka < kb ? 1 : -1;
      return (b.importedAt || "").localeCompare(a.importedAt || ""); // 최종 동점 처리
    });
    _shown = PAGE;
    renderList();
  }

  function renderList() {
    const tbody = el("tx-tbody");
    tbody.innerHTML = "";
    const slice = _filtered.slice(0, _shown);

    // 필터 합계 요약
    let inc = 0, exp = 0;
    _filtered.forEach(function (t) { if (t.amount >= 0) inc += t.amount; else exp += -t.amount; });
    el("tx-summary").textContent =
      _filtered.length + "건 · 수입 " + HL.fmt.won(inc) + " · 지출 " + HL.fmt.won(exp) + " · 순액 " + HL.fmt.signedWon(inc - exp);

    if (!_filtered.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;padding:24px">조건에 맞는 거래가 없습니다.</td></tr>';
      el("tx-more").style.display = "none";
      return;
    }

    const frag = document.createDocumentFragment();
    slice.forEach(function (t) {
      const tr = document.createElement("tr");
      const sign = t.amount >= 0 ? "pos" : "neg";
      const srcLabel = HL.fmt.sourceLabel(t.source);
      const timeLabel = t.time ? '<span class="td-time">' + HL.fmt.esc(t.time.slice(0, 5)) + "</span>" : "";
      tr.innerHTML =
        '<td class="td-date">' + HL.fmt.esc(t.date) + timeLabel + "</td>" +
        '<td class="td-desc">' + HL.fmt.esc(t.description || "(적요 없음)") +
          '<span class="src-tag">' + HL.fmt.esc(srcLabel) + "</span></td>" +
        '<td class="td-amt ' + sign + '">' + HL.fmt.signedWon(t.amount) + "</td>" +
        '<td class="td-bal">' + (typeof t.balance === "number" ? HL.fmt.won(t.balance) : "") + "</td>";
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);

    el("tx-more").style.display = _shown < _filtered.length ? "" : "none";
    el("tx-more").textContent = "더 보기 (" + (_filtered.length - _shown) + "건 남음)";
  }

  HL.transactions = {
    render: applyFilters,
    init: function () {
      ["tx-from", "tx-to", "tx-type"].forEach(function (id) {
        el(id).addEventListener("change", applyFilters);
      });
      el("tx-search").addEventListener("input", function () {
        clearTimeout(HL.transactions._t);
        HL.transactions._t = setTimeout(applyFilters, 150);
      });
      el("tx-reset-filter").addEventListener("click", function () {
        el("tx-from").value = ""; el("tx-to").value = "";
        el("tx-search").value = ""; el("tx-type").value = "all";
        applyFilters();
      });
      el("tx-more").addEventListener("click", function () {
        _shown += PAGE; renderList();
      });
    },
  };
})();
