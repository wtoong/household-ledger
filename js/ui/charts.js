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

  HL.charts = { renderBars: renderBars, fmtMan: fmtMan };
})();
