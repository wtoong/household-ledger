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

  // data: [{month:'YYYY-MM', income, expense}]
  // opts: { rangeStart, rangeEnd ('YYYY-MM'),  onSelect(fromMonth, toMonth) }
  //  - 막대를 눌렀다 떼면 그 달(from===to). 좌우로 그으면 시작~끝 범위.
  //  - rangeStart~rangeEnd 구간을 띠로 강조(같으면 단일 선택).
  function renderBars(container, data, opts) {
    opts = opts || {};
    const rangeStart = opts.rangeStart, rangeEnd = opts.rangeEnd;
    const single = rangeStart && rangeStart === rangeEnd;
    const onSelect = opts.onSelect;
    function inRange(m) { return rangeStart && rangeEnd && m >= rangeStart && m <= rangeEnd; }
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
    svg.setAttribute("class", "chart-svg chart-bars");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.touchAction = "pan-y"; // 세로 스크롤은 살리고 가로 끌기만 가져온다

    // 끌어서 이동할 때 통째로 평행이동할 그룹
    const root = document.createElementNS(NS, "g");
    svg.appendChild(root);

    // 기준선
    const base = document.createElementNS(NS, "line");
    base.setAttribute("x1", padL); base.setAttribute("x2", W - padR);
    base.setAttribute("y1", padT + plotH); base.setAttribute("y2", padT + plotH);
    base.setAttribute("class", "chart-baseline");
    root.appendChild(base);

    data.forEach(function (d, i) {
      const cx = padL + groupW * i + groupW / 2;
      const incH = (d.income / max) * plotH;
      const expH = (d.expense / max) * plotH;

      // 선택 구간 강조 띠(막대 뒤). 끝점은 진하게.
      const within = inRange(d.month);
      if (within) {
        const band = document.createElementNS(NS, "rect");
        band.setAttribute("x", padL + groupW * i);
        band.setAttribute("y", padT);
        band.setAttribute("width", groupW);
        band.setAttribute("height", plotH);
        const edge = !single && (d.month === rangeStart || d.month === rangeEnd);
        band.setAttribute("class", "bar-band" + (single ? " single" : "") + (edge ? " edge" : ""));
        root.appendChild(band);
      }

      function bar(x, h, cls) {
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", padT + plotH - h);
        rect.setAttribute("width", barW);
        rect.setAttribute("height", Math.max(0, h));
        rect.setAttribute("class", cls);
        rect.setAttribute("rx", "2");
        root.appendChild(rect);
        return rect;
      }

      const incRect = bar(cx - barW - gap / 2, incH, "bar-income");
      const incTitle = document.createElementNS(NS, "title");
      incTitle.textContent = d.month + " 수입 " + Math.round(d.income).toLocaleString("ko-KR") + "원";
      incRect.appendChild(incTitle);
      const expRect = bar(cx + gap / 2, expH, "bar-expense");
      const expTitle = document.createElementNS(NS, "title");
      expTitle.textContent = d.month + " 지출 " + Math.round(d.expense).toLocaleString("ko-KR") + "원";
      expRect.appendChild(expTitle);

      // hover 영역(탭/끌기는 svg 전체에서 처리)
      const hit = document.createElementNS(NS, "rect");
      hit.setAttribute("x", padL + groupW * i);
      hit.setAttribute("y", padT);
      hit.setAttribute("width", groupW);
      hit.setAttribute("height", plotH);
      hit.setAttribute("class", "bar-hit");
      root.appendChild(hit);

      // x축 라벨 (MM월). 연도가 바뀌는 1월은 'YY.1월'로.
      const mm = +d.month.slice(5, 7);
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", cx);
      tx.setAttribute("y", H - 8);
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("class", "chart-xlabel" + (within ? " selected" : ""));
      tx.textContent = (mm === 1 || i === 0) ? (d.month.slice(2, 4) + "." + mm + "월") : (mm + "월");
      root.appendChild(tx);
    });

    container.appendChild(svg);

    // --- 누르면 그 달 / 좌우로 그으면 범위 선택 ---
    if (onSelect) {
      // 끌면서 미리 보여줄 띠
      const preview = document.createElementNS(NS, "rect");
      preview.setAttribute("class", "bar-band preview");
      preview.setAttribute("y", padT);
      preview.setAttribute("height", plotH);
      preview.style.display = "none";
      root.appendChild(preview);

      let active = false, startIdx = 0, curIdx = 0;
      function idxAt(clientX) {
        const r = svg.getBoundingClientRect();
        const scale = r.width ? W / r.width : 1;
        let idx = Math.floor(((clientX - r.left) * scale - padL) / groupW);
        return Math.max(0, Math.min(data.length - 1, idx));
      }
      function showPreview(a, b) {
        preview.setAttribute("x", padL + groupW * a);
        preview.setAttribute("width", groupW * (b - a + 1));
        preview.style.display = "";
      }
      svg.addEventListener("pointerdown", function (e) {
        active = true; startIdx = curIdx = idxAt(e.clientX);
        showPreview(startIdx, startIdx);
        try { svg.setPointerCapture(e.pointerId); } catch (_) {}
      });
      svg.addEventListener("pointermove", function (e) {
        if (!active) return;
        curIdx = idxAt(e.clientX);
        showPreview(Math.min(startIdx, curIdx), Math.max(startIdx, curIdx));
      });
      function finish() {
        if (!active) return;
        active = false; preview.style.display = "none";
        const a = Math.min(startIdx, curIdx), b = Math.max(startIdx, curIdx);
        onSelect(data[a].month, data[b].month);
      }
      svg.addEventListener("pointerup", finish);
      svg.addEventListener("pointercancel", function () { active = false; preview.style.display = "none"; });
    }

    // 범례
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML =
      '<span><i class="swatch income"></i>수입</span>' +
      '<span><i class="swatch expense"></i>지출</span>';
    container.appendChild(legend);
  }

  // 잔액 변동 추이 선형 차트. series: [{date:'YYYY-MM-DD', time?, balance}]
  // 한 점 = 한 거래 시점이라 같은 날 여러 건도 모두 표시된다. x축은 거래 순서(등간격)라
  // 점이 아무리 촘촘해도 겹치지 않아, 길게 봐도 당일 등락이 유실되지 않는다.
  // opts.onPick(fromDate, toDate) 를 주면 누르면 그날(from===to), 좌우로 그으면 연속 날짜 범위.
  function renderLine(container, series, opts) {
    opts = opts || {};
    const onPick = opts.onPick;
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

    const vals = series.map(function (d) { return d.balance; });
    const dataMin = Math.min.apply(null, vals);
    const dataMax = Math.max.apply(null, vals);
    // 변동 폭이 잘 보이도록 위아래로 약간 여유를 둔다(평평하면 ±1).
    let lo = dataMin, hi = dataMax;
    if (lo === hi) { lo -= 1; hi += 1; }
    const padY = (hi - lo) * 0.1;
    lo -= padY; hi += padY;
    const spanY = hi - lo;

    // x는 거래 순서로 등간격 배치(시각이 아니라 인덱스 기준). 같은 날 여러 점도 따로 보인다.
    const stepX = series.length > 1 ? plotW / (series.length - 1) : 0;
    function X(i) { return padL + stepX * i; }
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
      dLine += (i === 0 ? "M" : "L") + X(i).toFixed(1) + " " + Y(d.balance).toFixed(1) + " ";
    });
    const baseY = padT + plotH;
    const area = document.createElementNS(NS, "path");
    area.setAttribute("d", "M" + X(0).toFixed(1) + " " + baseY + " " +
      dLine.replace(/^M/, "L") + "L" + X(series.length - 1).toFixed(1) + " " + baseY + " Z");
    area.setAttribute("class", "chart-area");
    svg.appendChild(area);

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", dLine.trim());
    path.setAttribute("class", "chart-line");
    svg.appendChild(path);

    // x축 라벨: 달이 바뀌는 첫 지점마다 'M월'(점은 아래에서 모든 시점에 그린다)
    let prevMonth = "";
    series.forEach(function (d, i) {
      const month = d.date.slice(0, 7);
      if (month !== prevMonth) {
        prevMonth = month;
        const tx = document.createElementNS(NS, "text");
        tx.setAttribute("x", X(i));
        tx.setAttribute("y", H - 8);
        tx.setAttribute("text-anchor", "middle");
        tx.setAttribute("class", "chart-xlabel");
        tx.textContent = (+d.date.slice(5, 7)) + "월";
        svg.appendChild(tx);
      }
    });

    // 각 시점에 작은 점 표시.
    function pointLabel(d) {
      const when = d.date + (d.time ? " " + d.time.slice(0, 5) : "");
      return when + " · " + Math.round(d.balance).toLocaleString("ko-KR") + "원";
    }
    series.forEach(function (d, i) {
      const pt = document.createElementNS(NS, "circle");
      pt.setAttribute("cx", X(i)); pt.setAttribute("cy", Y(d.balance));
      pt.setAttribute("r", "2.2");
      pt.setAttribute("class", "chart-pt");
      const ht = document.createElementNS(NS, "title");
      ht.textContent = pointLabel(d);
      pt.appendChild(ht);
      svg.appendChild(pt);
    });

    // 마지막 지점 강조 + 현재 잔액 값
    const lastI = series.length - 1;
    const lastDot = document.createElementNS(NS, "circle");
    lastDot.setAttribute("cx", X(lastI));
    lastDot.setAttribute("cy", Y(series[lastI].balance));
    lastDot.setAttribute("r", "3.5");
    lastDot.setAttribute("class", "chart-dot last");
    const lastTitle = document.createElementNS(NS, "title");
    lastTitle.textContent = pointLabel(series[lastI]);
    lastDot.appendChild(lastTitle);
    svg.appendChild(lastDot);

    // --- 누르면 그날 / 좌우로 그으면 연속 날짜 범위 선택 ---
    if (onPick) {
      const band = document.createElementNS(NS, "rect");
      band.setAttribute("class", "chart-band");
      band.setAttribute("y", padT); band.setAttribute("height", plotH);
      band.style.display = "none";
      svg.insertBefore(band, svg.firstChild); // 선/면적 뒤에 깔기
      svg.style.touchAction = "pan-y";
      svg.style.cursor = "pointer";

      let active = false, startIdx = 0, curIdx = 0;
      function nearestIdx(clientX) {
        const r = svg.getBoundingClientRect();
        const scale = r.width ? W / r.width : 1;
        const xUser = (clientX - r.left) * scale;
        let best = 0, bd = Infinity;
        for (let i = 0; i < series.length; i++) {
          const dd = Math.abs(X(i) - xUser);
          if (dd < bd) { bd = dd; best = i; }
        }
        return best;
      }
      function showBand(a, b) {
        const xa = X(a), xb = X(b);
        band.setAttribute("x", Math.min(xa, xb) - 3);
        band.setAttribute("width", Math.abs(xb - xa) + 6);
        band.style.display = "";
      }
      svg.addEventListener("pointerdown", function (e) {
        active = true; startIdx = curIdx = nearestIdx(e.clientX);
        showBand(startIdx, startIdx);
        try { svg.setPointerCapture(e.pointerId); } catch (_) {}
      });
      svg.addEventListener("pointermove", function (e) {
        if (!active) return;
        curIdx = nearestIdx(e.clientX);
        showBand(Math.min(startIdx, curIdx), Math.max(startIdx, curIdx));
      });
      function finish() {
        if (!active) return;
        active = false;
        const a = Math.min(startIdx, curIdx), b = Math.max(startIdx, curIdx);
        onPick(series[a].date, series[b].date);
      }
      svg.addEventListener("pointerup", finish);
      svg.addEventListener("pointercancel", function () { active = false; band.style.display = "none"; });
    }

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
