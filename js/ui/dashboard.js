// 대시보드: 선택한 기간(달 또는 범위)의 순현금흐름 + 월별 수입/지출 막대(12개월 창) + 그 기간의 잔액 추이.
// 막대 차트는 좌우로 끌어 12개월 창을 이동(과거/최신), 막대를 탭해 달/범위를 선택한다.
// 잔액 추이의 한 점을 탭하면 그날 거래내역으로 이동한다.
(function () {
  window.HL = window.HL || {};

  function el(id) { return document.getElementById(id); }
  const WINDOW = 12; // 막대 차트에 한 번에 보이는 개월 수

  function labelMonth(key) { return key.slice(0, 4) + "년 " + (+key.slice(5, 7)) + "월"; }

  // 현재 상태/데이터로부터 창(window)·선택(range) 경계를 계산해 정규화한다.
  function computeView() {
    const txs = HL.perspectives.apply(HL.state.transactions, HL.state.perspective);
    const monthly = HL.aggregate.monthly(txs);
    if (!monthly.length) return { txs: txs, monthly: monthly, empty: true };

    const dataFrom = monthly[0].month;
    const dataTo = monthly[monthly.length - 1].month;
    const clamp = function (k) { return k < dataFrom ? dataFrom : k > dataTo ? dataTo : k; };

    // 창의 끝(가장 최신 보이는 달). 없거나 범위를 벗어나면 최신으로.
    let winEnd = HL.state.monthWindowEnd;
    if (!winEnd || winEnd < dataFrom || winEnd > dataTo) winEnd = dataTo;

    // 선택 범위. 없거나 데이터 밖이면 winEnd 단일 선택으로.
    let rs = HL.state.rangeStart, re = HL.state.rangeEnd;
    if (!rs || !re || rs < dataFrom || re > dataTo || rs > re) { rs = winEnd; re = winEnd; }

    HL.state.monthWindowEnd = winEnd;
    HL.state.rangeStart = rs; HL.state.rangeEnd = re;
    HL.state.selectedMonth = re; // 하위 호환

    return {
      txs: txs, monthly: monthly, empty: false,
      dataFrom: dataFrom, dataTo: dataTo, clamp: clamp,
      winEnd: winEnd, rangeStart: rs, rangeEnd: re,
    };
  }

  // winEnd에서 끝나는 WINDOW개월 배열(없는 달은 0으로 채움).
  function windowMonths(monthly, winEnd) {
    const byKey = {};
    monthly.forEach(function (m) { byKey[m.month] = m; });
    const out = [];
    let k = HL.aggregate.addMonths(winEnd, -(WINDOW - 1));
    for (let i = 0; i < WINDOW; i++) {
      out.push(byKey[k] || { month: k, income: 0, expense: 0, net: 0, count: 0 });
      k = HL.aggregate.addMonths(k, 1);
    }
    return out;
  }

  function render() {
    HL.perspectives.renderSelector(el("dash-perspective"), HL.state.perspective, render);

    const v = computeView();

    if (v.empty) {
      el("dash-month-label").textContent = "—";
      el("dash-net").textContent = "—"; el("dash-net").className = "net-big";
      el("dash-income").textContent = "—"; el("dash-expense").textContent = "—";
      el("dash-count").textContent = "0건";
      el("dash-prev").disabled = true; el("dash-next").disabled = true;
      HL.charts.renderBars(el("dash-chart"), [], {});
      HL.charts.renderLine(el("dash-balance-chart"), []);
      el("dash-balance-title").textContent = "잔액 변동 추이";
      el("dash-day").style.display = "none"; el("dash-day").innerHTML = "";
      el("dash-empty").style.display = "";
      return;
    }
    el("dash-empty").style.display = "none";

    const rs = v.rangeStart, re = v.rangeEnd;
    const t = HL.aggregate.totalsForRange(v.txs, rs, re);

    // 선택 기간 라벨 + 순현금흐름
    const periodLabel = rs === re ? labelMonth(rs) : (labelMonth(rs) + " ~ " + labelMonth(re));
    el("dash-month-label").textContent = periodLabel;
    const netEl = el("dash-net");
    netEl.textContent = HL.fmt.signedWon(t.net);
    netEl.className = "net-big " + (t.net > 0 ? "pos" : t.net < 0 ? "neg" : "");
    el("dash-income").textContent = HL.fmt.won(t.income);
    el("dash-expense").textContent = HL.fmt.won(t.expense);
    el("dash-count").textContent = t.count + "건";

    // ‹ › 는 창+선택을 함께 한 달씩 이동. 데이터 경계에서 비활성.
    el("dash-prev").disabled = panLimit(v, -1) === 0;
    el("dash-next").disabled = panLimit(v, 1) === 0;

    // 월별 막대(12개월 창). 누르면 그 달, 좌우로 그으면 범위. 이동은 ‹ › 버튼.
    HL.charts.renderBars(el("dash-chart"), windowMonths(v.monthly, v.winEnd), {
      rangeStart: rs, rangeEnd: re,
      onSelect: selectRange,
    });

    // 선택 기간의 잔액 추이. 누르면 그날, 그으면 연속 날짜 → 아래에 거래 표시.
    el("dash-balance-title").textContent = "잔액 변동 추이 · " + periodLabel;
    HL.charts.renderLine(el("dash-balance-chart"), HL.aggregate.balanceSeries(v.txs, rs, re), {
      onPick: function (from, to) {
        HL.state.dayFrom = from; HL.state.dayTo = to;
        renderDayDetail();
      },
    });

    renderDayDetail();
  }

  // 막대에서 달/범위 선택. 기간이 바뀌면 아래 날짜 상세는 닫는다.
  function selectRange(from, to) {
    HL.state.rangeStart = from; HL.state.rangeEnd = to;
    HL.state.dayFrom = null; HL.state.dayTo = null;
    render();
  }

  // 잔액 추이에서 고른 날짜(또는 연속 날짜)의 거래를 카드 아래에 인라인으로 표시.
  function renderDayDetail() {
    const box = el("dash-day");
    const from = HL.state.dayFrom, to = HL.state.dayTo;
    if (!from) { box.style.display = "none"; box.innerHTML = ""; return; }

    const txs = HL.perspectives.apply(HL.state.transactions, HL.state.perspective)
      .filter(function (t) { return t.date >= from && t.date <= to; })
      .sort(function (a, b) {
        const ka = a.date + "T" + (a.time || ""), kb = b.date + "T" + (b.time || "");
        return ka === kb ? 0 : (ka < kb ? 1 : -1); // 최신 먼저
      });

    const title = from === to ? (from + " 거래") : (from + " ~ " + to + " 거래");
    let inc = 0, exp = 0;
    txs.forEach(function (t) { if (t.amount >= 0) inc += t.amount; else exp += -t.amount; });

    let rows = "";
    if (!txs.length) {
      rows = '<tr><td colspan="4" class="muted" style="text-align:center;padding:18px">이 날짜에는 거래가 없습니다.</td></tr>';
    } else {
      txs.forEach(function (t) {
        const sign = t.amount >= 0 ? "pos" : "neg";
        const src = t.account ? t.account : HL.fmt.sourceLabel(t.source);
        const time = t.time ? '<span class="td-time">' + HL.fmt.esc(t.time.slice(0, 5)) + "</span>" : "";
        const bal = typeof t.balance === "number" ? HL.fmt.won(t.balance) : "";
        rows +=
          '<tr><td class="td-date">' + HL.fmt.esc(t.date) + time + "</td>" +
          '<td class="td-desc">' + HL.fmt.esc(t.description || "(적요 없음)") +
            '<span class="src-tag">' + HL.fmt.esc(src) + "</span></td>" +
          '<td class="td-amt ' + sign + '">' + HL.fmt.signedWon(t.amount) + "</td>" +
          '<td class="td-bal">' + bal + "</td></tr>";
      });
    }

    box.innerHTML =
      '<div class="day-head"><h2 class="card-title" style="margin:0">' + HL.fmt.esc(title) + "</h2>" +
      '<button type="button" id="dash-day-close" class="ghost-btn" aria-label="닫기">✕</button></div>' +
      '<div class="tx-summary muted">' + txs.length + "건 · 수입 " + HL.fmt.won(inc) +
        " · 지출 " + HL.fmt.won(exp) + " · 순액 " + HL.fmt.signedWon(inc - exp) + "</div>" +
      '<div class="table-scroll"><table class="tx-table"><thead><tr>' +
        "<th>날짜</th><th>적요</th><th class=\"right\">금액</th><th class=\"right\">잔액</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table></div>";
    box.style.display = "";
    const close = el("dash-day-close");
    if (close) close.addEventListener("click", function () {
      HL.state.dayFrom = null; HL.state.dayTo = null; renderDayDetail();
    });
  }

  // 창과 선택을 함께 delta개월 이동할 수 있는 실제 한도(데이터 경계로 클램프).
  // 양수 = 최신 쪽. 반환은 적용 가능한 delta(0이면 더 못 감).
  function panLimit(v, delta) {
    const D = HL.aggregate.monthDiff;
    if (delta < 0) {
      const room = Math.min(D(v.dataFrom, v.winEnd), D(v.dataFrom, v.rangeStart));
      return Math.max(delta, -room);
    }
    if (delta > 0) {
      const room = Math.min(D(v.winEnd, v.dataTo), D(v.rangeEnd, v.dataTo));
      return Math.min(delta, room);
    }
    return 0;
  }

  function pan(delta) {
    const v = computeView();
    if (v.empty) return;
    const d = panLimit(v, delta);
    if (!d) return;
    const add = HL.aggregate.addMonths;
    HL.state.monthWindowEnd = add(v.winEnd, d);
    HL.state.rangeStart = add(v.rangeStart, d);
    HL.state.rangeEnd = add(v.rangeEnd, d);
    HL.state.dayFrom = null; HL.state.dayTo = null; // 기간이 바뀌면 날짜 상세 닫기
    render();
  }

  HL.dashboard = {
    render: render,
    init: function () {
      el("dash-prev").addEventListener("click", function () { pan(-1); });
      el("dash-next").addEventListener("click", function () { pan(1); });
    },
  };
})();
