// 부트스트랩: 포맷 헬퍼 + 상태 + 탭 라우팅 + refresh.
(function () {
  window.HL = window.HL || {};

  // --- 포맷 헬퍼 ---
  const wonFmt = new Intl.NumberFormat("ko-KR");
  HL.fmt = {
    won: function (n) { return wonFmt.format(Math.round(n || 0)) + "원"; },
    signedWon: function (n) {
      n = Math.round(n || 0);
      const sign = n > 0 ? "+" : n < 0 ? "−" : "";
      return sign + wonFmt.format(Math.abs(n)) + "원";
    },
    esc: function (s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },
    sourceLabel: function (id) {
      const a = HL.adapters.get(id);
      if (a) return a.label.replace(/\s*\(.*\)\s*$/, "");
      return id || "";
    },
  };

  // --- 상태 ---
  HL.state = {
    transactions: [], perspective: "all",
    selectedMonth: null,                 // 하위 호환(= rangeEnd)
    monthWindowEnd: null,                // 막대 차트 12개월 창의 끝(YYYY-MM)
    rangeStart: null, rangeEnd: null,    // 선택 기간(YYYY-MM)
    dayFrom: null, dayTo: null,          // 잔액 추이에서 고른 날짜/연속 날짜(YYYY-MM-DD)
  };

  const views = {
    dashboard: HL.dashboard,
    transactions: HL.transactions,
    categorize: HL.categorize,
    import: HL.import,
    data: HL.dataView,
  };
  let _active = "dashboard";

  function showTab(name) {
    _active = name;
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("active", v.id === "view-" + name);
    });
    if (views[name] && views[name].render) views[name].render();
  }

  function refresh() {
    return HL.store.getAll().then(function (txs) {
      HL.state.transactions = txs;
      if (views[_active] && views[_active].render) views[_active].render();
      // 데이터 카운트는 항상 최신으로
      const dc = document.getElementById("data-count");
      if (dc) dc.textContent = txs.length;
    });
  }

  HL.app = { refresh: refresh, showTab: showTab };

  function boot() {
    // 각 뷰 초기화
    Object.keys(views).forEach(function (k) {
      if (views[k] && views[k].init) views[k].init();
    });
    // 탭 버튼
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.addEventListener("click", function () { showTab(b.dataset.tab); });
    });
    // import 뷰는 어댑터 옵션을 미리 채워둠
    if (HL.import && HL.import.render) HL.import.render();

    refresh().then(function () { showTab("dashboard"); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
