// 거래목록: 기간 필터 + 텍스트 검색(적요) + 수입/지출 필터, 시간 역순, 더보기.
// 잔액 검증(HL.balance) 결과로 같은 시각 순서를 보정하고, 누락 추정/연속 확정을 표시한다.
(function () {
  window.HL = window.HL || {};

  function el(id) { return document.getElementById(id); }

  // 정렬용 날짜+시각 키. 시각이 없으면 그날의 가장 이른 거래로 취급("")한다.
  function dtKey(t) { return t.date + "T" + (t.time || ""); }

  const PAGE = 50;
  let _shown = PAGE;
  let _filtered = [];
  let _report = { annotations: {}, orderRank: {}, problems: [], summary: {} };

  function applyFilters() {
    const from = el("tx-from").value;
    const to = el("tx-to").value;
    const q = el("tx-search").value.trim().toLowerCase();
    const type = el("tx-type").value; // all/income/expense
    const issuesOnly = el("tx-issues-only") && el("tx-issues-only").checked;

    // 잔액 검증은 전체 거래 기준으로 한 번 계산(계좌별 체인이라 필터와 무관해야 정확).
    _report = HL.balance.validate(HL.state.transactions);
    const ann = _report.annotations;

    _filtered = HL.state.transactions.filter(function (t) {
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (type === "income" && t.amount < 0) return false;
      if (type === "expense" && t.amount >= 0) return false;
      if (q && String(t.description || "").toLowerCase().indexOf(q) === -1) return false;
      if (issuesOnly) {
        const st = ann[t.id] && ann[t.id].status;
        if (st !== "gap" && st !== "no-balance") return false;
      }
      return true;
    });
    _filtered.sort(function (a, b) {
      // 날짜+시각 기준 최신 먼저. 시각이 있으면 같은 날 거래도 올바르게 정렬된다.
      const ka = dtKey(a), kb = dtKey(b);
      if (ka !== kb) return ka < kb ? 1 : -1;
      // 시각이 같으면: 같은 계좌는 잔액 체인으로 찾은 순서(orderRank)를 따른다(나중 거래가 위로).
      if ((a.source || "") === (b.source || "")) {
        const ra = _report.orderRank[a.id], rb = _report.orderRank[b.id];
        if (ra != null && rb != null && ra !== rb) return rb - ra;
      }
      return (b.importedAt || "").localeCompare(a.importedAt || ""); // 최종 동점 처리
    });
    _shown = PAGE;
    renderList();
  }

  function renderValidation() {
    const box = el("tx-validation");
    if (!box) return;
    const s = _report.summary || {};
    const probs = _report.problems || [];
    const gaps = probs.filter(function (p) { return p.kind === "gap"; });

    if (!s.checked && !s.noBalance) { box.style.display = "none"; box.innerHTML = ""; return; }

    // 상세 사유는 아래 표의 각 행에 인라인으로 표시한다. 여기서는 한 줄 요약만 둔다.
    let html = '<div class="val-head">';
    if (!gaps.length && !s.noBalance) {
      html += '<span class="val-badge ok">✓ 잔액 연속성 확인됨</span>' +
        '<span class="muted small"> 검증한 ' + s.checked + '건이 모두 잔액과 맞물립니다 (사이 누락 없음 확정).</span>';
    } else {
      html += '<span class="val-badge warn">⚠ 잔액 검증 결과</span>';
      const parts = [];
      if (gaps.length) parts.push(gaps.length + '곳 누락 추정(아래 ⚠ 행 참고)');
      if (s.noBalance) parts.push(s.noBalance + '건은 잔액 없어 검증 불가');
      if (s.reordered) parts.push(s.reordered + '곳 같은시각 순서를 잔액으로 보정');
      html += '<span class="muted small"> ' + HL.fmt.esc(parts.join(' · ')) + '</span>';
    }
    html += '</div>';
    box.innerHTML = html;
    box.style.display = "";
  }

  // 잔액 셀 옆에 붙일 검증 배지
  function statusBadge(t) {
    const a = _report.annotations[t.id];
    if (!a) return "";
    if (a.status === "ok") return '<span class="bal-flag ok" title="직전 잔액과 맞물림: 사이 누락 없음 확정">✓</span>';
    if (a.status === "start") return '<span class="bal-flag start" title="이 계좌에서 검증된 가장 이른 거래(기준점)">●</span>';
    if (a.status === "no-balance") return '<span class="bal-flag none" title="잔액 정보가 없어 검증 불가">?</span>';
    if (a.status === "gap") {
      const dir = a.gapAmount >= 0 ? "입금" : "출금";
      return '<span class="bal-flag gap" title="직전 거래와 잔액 ' + HL.fmt.signedWon(a.gapAmount) +
        ' 어긋남 → ' + dir + ' 약 ' + HL.fmt.won(Math.abs(a.gapAmount)) + ' 누락 추정(시간 미상)">⚠</span>';
    }
    return "";
  }

  function renderList() {
    const tbody = el("tx-tbody");
    tbody.innerHTML = "";
    const slice = _filtered.slice(0, _shown);

    renderValidation();

    // 필터 합계 요약
    let inc = 0, exp = 0;
    _filtered.forEach(function (t) { if (t.amount >= 0) inc += t.amount; else exp += -t.amount; });
    el("tx-summary").textContent =
      _filtered.length + "건 · 수입 " + HL.fmt.won(inc) + " · 지출 " + HL.fmt.won(exp) + " · 순액 " + HL.fmt.signedWon(inc - exp);

    if (!_filtered.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">조건에 맞는 거래가 없습니다.</td></tr>';
      el("tx-more").style.display = "none";
      return;
    }

    const frag = document.createDocumentFragment();
    slice.forEach(function (t) {
      const tr = document.createElement("tr");
      const sign = t.amount >= 0 ? "pos" : "neg";
      const srcLabel = HL.fmt.sourceLabel(t.source);
      const timeLabel = t.time ? '<span class="td-time">' + HL.fmt.esc(t.time.slice(0, 5)) + "</span>" : "";
      const bal = typeof t.balance === "number" ? HL.fmt.won(t.balance) : "";
      const a = _report.annotations[t.id];
      if (a && a.status === "gap") tr.className = "row-gap";
      tr.innerHTML =
        '<td class="td-date">' + HL.fmt.esc(t.date) + timeLabel + "</td>" +
        '<td class="td-desc">' + HL.fmt.esc(t.description || "(적요 없음)") +
          '<span class="src-tag">' + HL.fmt.esc(srcLabel) + "</span></td>" +
        '<td class="td-amt ' + sign + '">' + HL.fmt.signedWon(t.amount) + "</td>" +
        '<td class="td-bal">' + bal + statusBadge(t) + "</td>" +
        '<td class="td-act"><button type="button" class="row-del" data-id="' + HL.fmt.esc(t.id) +
          '" title="이 거래 삭제" aria-label="삭제">✕</button></td>";
      frag.appendChild(tr);

      // 검증 문제(누락 추정) 행은 바로 아래에 사유를 인라인으로 펼친다.
      if (a && a.status === "gap") {
        const dir = a.gapAmount >= 0 ? "입금" : "출금";
        const note = document.createElement("tr");
        note.className = "row-note";
        note.innerHTML = '<td colspan="5" class="td-note">⚠ 직전 거래와 잔액이 ' +
          HL.fmt.signedWon(a.gapAmount) + ' 어긋남 → ' + dir + ' 약 ' +
          HL.fmt.won(Math.abs(a.gapAmount)) + ' 누락 추정 (시간 미상, 확인 필요)</td>';
        frag.appendChild(note);
      }
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
      if (el("tx-issues-only")) el("tx-issues-only").addEventListener("change", applyFilters);
      el("tx-search").addEventListener("input", function () {
        clearTimeout(HL.transactions._t);
        HL.transactions._t = setTimeout(applyFilters, 150);
      });
      el("tx-reset-filter").addEventListener("click", function () {
        el("tx-from").value = ""; el("tx-to").value = "";
        el("tx-search").value = ""; el("tx-type").value = "all";
        if (el("tx-issues-only")) el("tx-issues-only").checked = false;
        applyFilters();
      });
      el("tx-more").addEventListener("click", function () {
        _shown += PAGE; renderList();
      });
      // 행별 삭제 (잘못 들어온 거래 제거). tbody는 매번 다시 그려지므로 위임으로 처리.
      el("tx-tbody").addEventListener("click", function (e) {
        const btn = e.target && e.target.closest ? e.target.closest(".row-del") : null;
        if (!btn) return;
        const id = btn.getAttribute("data-id");
        if (!id) return;
        let label = "이 거래";
        for (let i = 0; i < HL.state.transactions.length; i++) {
          const x = HL.state.transactions[i];
          if (x.id === id) { label = x.date + " · " + (x.description || "(적요 없음)") + " · " + HL.fmt.signedWon(x.amount); break; }
        }
        if (!confirm("이 거래를 삭제할까요?\n" + label + "\n되돌릴 수 없습니다.")) return;
        HL.store.remove(id).then(function () { HL.app.refresh(); });
      });
    },
  };
})();
