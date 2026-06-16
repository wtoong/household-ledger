// 대시보드: 선택한 달의 순현금흐름을 크게 강조 + 월별 수입/지출 추이 차트.
(function () {
  window.HL = window.HL || {};

  function el(id) { return document.getElementById(id); }

  // 최근 N개월만 차트에 표시(없는 달은 0으로 채워 연속성 유지)
  function fillMonths(monthlyArr, count) {
    if (!monthlyArr.length) return [];
    const byKey = {};
    monthlyArr.forEach(function (m) { byKey[m.month] = m; });
    const last = monthlyArr[monthlyArr.length - 1].month;
    const [ly, lm] = last.split("-").map(Number);
    const out = [];
    let y = ly, mo = lm;
    const seq = [];
    for (let i = 0; i < count; i++) {
      seq.unshift({ y: y, m: mo });
      mo--; if (mo === 0) { mo = 12; y--; }
    }
    seq.forEach(function (s) {
      const key = s.y + "-" + (s.m < 10 ? "0" + s.m : s.m);
      out.push(byKey[key] || { month: key, income: 0, expense: 0, net: 0, count: 0 });
    });
    return out;
  }

  function render() {
    const txs = HL.state.transactions;
    const monthly = HL.aggregate.monthly(txs);

    // 선택 월 기본값: 데이터가 있는 가장 최근 달, 없으면 이번 달
    if (!HL.state.selectedMonth) {
      HL.state.selectedMonth = monthly.length
        ? monthly[monthly.length - 1].month
        : new Date().toISOString().slice(0, 7);
    }
    const sel = HL.state.selectedMonth;
    const t = HL.aggregate.totalsForMonth(txs, sel);

    // 큰 순현금흐름
    el("dash-month-label").textContent = sel.replace("-", "년 ") + "월";
    const netEl = el("dash-net");
    netEl.textContent = HL.fmt.signedWon(t.net);
    netEl.className = "net-big " + (t.net > 0 ? "pos" : t.net < 0 ? "neg" : "");
    el("dash-income").textContent = HL.fmt.won(t.income);
    el("dash-expense").textContent = HL.fmt.won(t.expense);
    el("dash-count").textContent = t.count + "건";

    // 이전/다음 달 이동 가능 여부
    const months = monthly.map(function (m) { return m.month; });
    const idx = months.indexOf(sel);
    el("dash-prev").disabled = !(idx > 0);
    el("dash-next").disabled = !(idx >= 0 && idx < months.length - 1);

    // 차트
    HL.charts.renderBars(el("dash-chart"), fillMonths(monthly, 12), {
      selected: sel,
      onSelect: function (m) { HL.state.selectedMonth = m; render(); },
    });

    // 잔액 변동 추이(전체 기간, 선택 월과 무관)
    HL.charts.renderLine(el("dash-balance-chart"), HL.aggregate.balanceSeries(txs));

    if (!txs.length) {
      el("dash-empty").style.display = "";
    } else {
      el("dash-empty").style.display = "none";
    }
  }

  function moveMonth(delta) {
    const monthly = HL.aggregate.monthly(HL.state.transactions);
    const months = monthly.map(function (m) { return m.month; });
    let idx = months.indexOf(HL.state.selectedMonth);
    if (idx === -1) return;
    idx += delta;
    if (idx < 0 || idx >= months.length) return;
    HL.state.selectedMonth = months[idx];
    render();
  }

  HL.dashboard = {
    render: render,
    init: function () {
      el("dash-prev").addEventListener("click", function () { moveMonth(-1); });
      el("dash-next").addEventListener("click", function () { moveMonth(1); });
    },
  };
})();
