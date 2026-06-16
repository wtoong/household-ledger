// 의존성 없는 작은 SVG 막대 차트 (수입 vs 지출). 차트 라이브러리 없이 오프라인 동작.
(function () {
  window.HL = window.HL || {};

  function fmtMan(n) {
    // 만원 단위 축약 라벨
    const man = n / 10000;
    if (Math.abs(man) >= 10000) return Math.round(man / 1000) / 10 + "억";
    if (Math.abs(man) >= 1) return Math.round(man) + "만";
    return Math.round(n).toLocaleString("ko-KR");
  }

  // data: [{month:'YYYY-MM', income, expense, net}], onSelect(month), selected
  function renderBars(container, data, opts) {
    opts = opts || {};
    const selected = opts.selected;
    const onSelect = opts.onSelect;
    container.innerHTML = "";
    if (!data.length) {
      container.innerHTML = '<p class="muted">표시할 데이터가 없습니다. [가져오기]에서 거래를 추가하세요.</p>';
      return;
    }

    const W = 720, H = 260;
    const padL = 8, padR = 8, padT = 16, padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const max = Math.max(1, ...data.map(function (d) { return Math.max(d.income, d.expense); }));
    const groupW = plotW / data.length;
    const barW = Math.min(22, groupW / 2.6);
    const gap = 3;

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("class", "chart-svg");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // 기준선
    const base = document.createElementNS(NS, "line");
    base.setAttribute("x1", padL); base.setAttribute("x2", W - padR);
    base.setAttribute("y1", padT + plotH); base.setAttribute("y2", padT + plotH);
    base.setAttribute("class", "chart-baseline");
    svg.appendChild(base);

    data.forEach(function (d, i) {
      const cx = padL + groupW * i + groupW / 2;
      const incH = (d.income / max) * plotH;
      const expH = (d.expense / max) * plotH;

      function bar(x, h, cls, label) {
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", padT + plotH - h);
        rect.setAttribute("width", barW);
        rect.setAttribute("height", Math.max(0, h));
        rect.setAttribute("class", cls);
        rect.setAttribute("rx", "2");
        const title = document.createElementNS(NS, "title");
        title.textContent = d.month + " " + label + " " + Math.round(d.income).toLocaleString();
        rect.appendChild(title);
        return rect;
      }

      const incRect = bar(cx - barW - gap / 2, incH, "bar-income", "수입");
      incRect.querySelector("title").textContent = d.month + " 수입 " + Math.round(d.income).toLocaleString("ko-KR") + "원";
      const expRect = bar(cx + gap / 2, expH, "bar-expense", "지출");
      expRect.querySelector("title").textContent = d.month + " 지출 " + Math.round(d.expense).toLocaleString("ko-KR") + "원";
      svg.appendChild(incRect);
      svg.appendChild(expRect);

      // 선택 하이라이트 + 클릭 영역
      const hit = document.createElementNS(NS, "rect");
      hit.setAttribute("x", padL + groupW * i);
      hit.setAttribute("y", padT);
      hit.setAttribute("width", groupW);
      hit.setAttribute("height", plotH);
      hit.setAttribute("class", "bar-hit" + (d.month === selected ? " selected" : ""));
      hit.style.cursor = "pointer";
      hit.addEventListener("click", function () { if (onSelect) onSelect(d.month); });
      svg.appendChild(hit);

      // x축 라벨 (MM월)
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", cx);
      tx.setAttribute("y", H - 8);
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("class", "chart-xlabel" + (d.month === selected ? " selected" : ""));
      tx.textContent = (+d.month.slice(5, 7)) + "월";
      svg.appendChild(tx);
    });

    container.appendChild(svg);

    // 범례
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML =
      '<span><i class="swatch income"></i>수입</span>' +
      '<span><i class="swatch expense"></i>지출</span>';
    container.appendChild(legend);
  }

  // 잔액 변동 추이 선형 차트. series: [{date:'YYYY-MM-DD', balance}]
  function renderLine(container, series, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!series.length) {
      container.innerHTML = '<p class="muted">표시할 잔액 데이터가 없습니다. 잔액이 포함된 내역을 가져오면 추이가 나타납니다.</p>';
      return;
    }
    if (series.length === 1) {
      container.innerHTML = '<p class="muted">추이를 그리려면 둘 이상의 시점이 필요합니다. 현재 잔액 <b>' +
        Math.round(series[0].balance).toLocaleString("ko-KR") + "원</b></p>";
      return;
    }

    const W = 720, H = 240;
    const padL = 8, padR = 8, padT = 16, padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const xs = series.map(function (d) { return new Date(d.date + "T00:00:00").getTime(); });
    const minX = xs[0], maxX = xs[xs.length - 1];
    const spanX = Math.max(1, maxX - minX);
    const vals = series.map(function (d) { return d.balance; });
    const dataMin = Math.min.apply(null, vals);
    const dataMax = Math.max.apply(null, vals);
    // 변동 폭이 잘 보이도록 위아래로 약간 여유를 둔다(평평하면 ±1).
    let lo = dataMin, hi = dataMax;
    if (lo === hi) { lo -= 1; hi += 1; }
    const padY = (hi - lo) * 0.1;
    lo -= padY; hi += padY;
    const spanY = hi - lo;

    function X(t) { return padL + ((t - minX) / spanX) * plotW; }
    function Y(v) { return padT + plotH - ((v - lo) / spanY) * plotH; }

    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("class", "chart-svg");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // 가로 가이드선 + y축 라벨 (최저 / 중간 / 최고 = 실제 데이터 값 기준)
    [dataMax, (dataMax + dataMin) / 2, dataMin].forEach(function (v) {
      const y = Y(v);
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", padL); line.setAttribute("x2", W - padR);
      line.setAttribute("y1", y); line.setAttribute("y2", y);
      line.setAttribute("class", "chart-grid");
      svg.appendChild(line);
      const lbl = document.createElementNS(NS, "text");
      lbl.setAttribute("x", padL + 2);
      lbl.setAttribute("y", y - 3);
      lbl.setAttribute("class", "chart-ylabel");
      lbl.textContent = fmtMan(v);
      svg.appendChild(lbl);
    });

    // 면적 + 선 경로
    let dLine = "";
    series.forEach(function (d, i) {
      dLine += (i === 0 ? "M" : "L") + X(xs[i]).toFixed(1) + " " + Y(d.balance).toFixed(1) + " ";
    });
    const baseY = padT + plotH;
    const area = document.createElementNS(NS, "path");
    area.setAttribute("d", "M" + X(xs[0]).toFixed(1) + " " + baseY + " " +
      dLine.replace(/^M/, "L") + "L" + X(xs[xs.length - 1]).toFixed(1) + " " + baseY + " Z");
    area.setAttribute("class", "chart-area");
    svg.appendChild(area);

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", dLine.trim());
    path.setAttribute("class", "chart-line");
    svg.appendChild(path);

    // x축 라벨: 달이 바뀌는 첫 지점마다 'M월' (+필요시 점/툴팁)
    let prevMonth = "";
    series.forEach(function (d, i) {
      const month = d.date.slice(0, 7);
      const newMonth = month !== prevMonth;
      if (newMonth) {
        prevMonth = month;
        const tx = document.createElementNS(NS, "text");
        tx.setAttribute("x", X(xs[i]));
        tx.setAttribute("y", H - 8);
        tx.setAttribute("text-anchor", "middle");
        tx.setAttribute("class", "chart-xlabel");
        tx.textContent = (+d.date.slice(5, 7)) + "월";
        svg.appendChild(tx);
        // 달 시작점에 작은 점 + 툴팁
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", X(xs[i]));
        dot.setAttribute("cy", Y(d.balance));
        dot.setAttribute("r", "2.5");
        dot.setAttribute("class", "chart-dot");
        const title = document.createElementNS(NS, "title");
        title.textContent = d.date + " · " + Math.round(d.balance).toLocaleString("ko-KR") + "원";
        dot.appendChild(title);
        svg.appendChild(dot);
      }
    });

    // 마지막 지점 강조 + 현재 잔액 값
    const lastI = series.length - 1;
    const lastDot = document.createElementNS(NS, "circle");
    lastDot.setAttribute("cx", X(xs[lastI]));
    lastDot.setAttribute("cy", Y(series[lastI].balance));
    lastDot.setAttribute("r", "3.5");
    lastDot.setAttribute("class", "chart-dot last");
    const lastTitle = document.createElementNS(NS, "title");
    lastTitle.textContent = series[lastI].date + " · " + Math.round(series[lastI].balance).toLocaleString("ko-KR") + "원";
    lastDot.appendChild(lastTitle);
    svg.appendChild(lastDot);

    container.appendChild(svg);

    // 요약: 현재/최고/최저 잔액
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML =
      "<span>현재 <b>" + Math.round(series[lastI].balance).toLocaleString("ko-KR") + "원</b></span>" +
      "<span>최고 " + Math.round(dataMax).toLocaleString("ko-KR") + "원</span>" +
      "<span>최저 " + Math.round(dataMin).toLocaleString("ko-KR") + "원</span>";
    container.appendChild(legend);
  }

  HL.charts = { renderBars: renderBars, renderLine: renderLine, fmtMan: fmtMan };
})();
