// 분류 탭: 미분류 거래를 외부 LLM에 위임 → 결과를 검토(수락/보류/태그 가감) → 반영.
// 사용자가 게이트키퍼다. 앱은 아무것도 외부로 보내지 않는다(프롬프트+데이터는 사용자가 복사해 직접 LLM에).
(function () {
  window.HL = window.HL || {};

  function el(id) { return document.getElementById(id); }

  // 현재 검토 중인 작업 목록. 각 항목: { tx, tags:[], confidence, skip }
  let _review = [];

  // --- 상태 카운트 ---
  function counts() {
    const c = { none: 0, proposed: 0, confirmed: 0, skipped: 0 };
    HL.state.transactions.forEach(function (t) {
      const s = t.tagStatus || "none";
      if (c[s] == null) c[s] = 0;
      c[s]++;
    });
    return c;
  }

  function renderSummary() {
    const c = counts();
    el("cat-summary").innerHTML =
      '<span class="pill">미분류 <b>' + c.none + "</b></span>" +
      '<span class="pill">검토대기 <b>' + c.proposed + "</b></span>" +
      '<span class="pill income">확정 <b>' + c.confirmed + "</b></span>" +
      '<span class="pill">보류 <b>' + c.skipped + "</b></span>";
  }

  function uncategorized() {
    return HL.state.transactions.filter(function (t) { return (t.tagStatus || "none") === "none"; });
  }

  // --- ① 미분류 추출 → 프롬프트 생성 ---
  function extract() {
    const rows = uncategorized();
    if (!rows.length) {
      setMsg("cat-extract-msg", "미분류 거래가 없습니다. 모두 분류되었거나 보류 처리됐어요.", "ok");
      el("cat-prompt-zone").style.display = "none";
      return;
    }
    el("cat-prompt").value = HL.categories.buildPrompt(rows);
    el("cat-prompt-zone").style.display = "";
    setMsg("cat-extract-msg", "미분류 " + rows.length + "건을 프롬프트에 담았습니다. 복사해 본인 LLM에 넣으세요.", "ok");
  }

  // --- ② 결과 붙여넣기 → 검토 목록 구성 ---
  function parseInput() {
    const text = el("cat-input").value;
    if (!text.trim()) { setMsg("cat-parse-msg", "LLM이 만든 JSON을 붙여넣으세요.", "err"); return; }
    const byId = {};
    HL.state.transactions.forEach(function (t) { byId[t.id] = t; });
    const knownIds = new Set(Object.keys(byId));
    const res = HL.categories.parseResult(text, knownIds);
    if (res.error) { setMsg("cat-parse-msg", "오류: " + res.error, "err"); return; }
    if (!res.matched) {
      setMsg("cat-parse-msg", "매칭되는 거래가 없습니다. (모르는 id " + res.unknown + "건) id를 그대로 돌려줬는지 확인하세요.", "err");
      return;
    }
    _review = res.items.map(function (it) {
      return { tx: byId[it.id], tags: it.tags.slice(), confidence: it.confidence, skip: it.skip };
    });
    const note = res.unknown ? " (모르는 id " + res.unknown + "건은 무시)" : "";
    setMsg("cat-parse-msg", res.matched + "건을 불러왔습니다." + note, "ok");
    renderReview();
  }

  // --- 미분류·보류 항목을 LLM 없이 직접 분류 ---
  function openManual() {
    const rows = HL.state.transactions.filter(function (t) {
      const s = t.tagStatus || "none";
      return s === "none" || s === "skipped";
    });
    if (!rows.length) { setMsg("cat-parse-msg", "직접 분류할 미분류·보류 항목이 없습니다.", "ok"); return; }
    _review = rows.map(function (t) {
      return { tx: t, tags: (t.tags || []).slice(), confidence: null, skip: false };
    });
    setMsg("cat-parse-msg", "미분류·보류 " + rows.length + "건을 직접 분류 목록으로 불러왔습니다.", "ok");
    renderReview();
  }

  // --- 검토 목록 렌더 ---
  function confBadge(conf) {
    if (conf == null) return "";
    const pct = Math.round(conf * 100);
    const cls = conf >= 0.8 ? "high" : conf >= 0.5 ? "mid" : "low";
    return '<span class="conf ' + cls + '">' + pct + "%</span>";
  }

  function rowHtml(item, idx) {
    const t = item.tx;
    const tagSet = item.tags;
    const chips = HL.categories.TAGS.map(function (tag) {
      const on = tagSet.indexOf(tag) !== -1 ? " on" : "";
      return '<button type="button" class="tag-chip' + on + '" data-idx="' + idx + '" data-tag="' +
        HL.fmt.esc(tag) + '">' + HL.fmt.esc(tag) + "</button>";
    }).join("");
    const amt = HL.fmt.signedWon(t.amount);
    const sign = t.amount >= 0 ? "pos" : "neg";
    return '<div class="cat-row' + (item.skip ? " skipped" : "") + '" data-idx="' + idx + '">' +
      '<div class="cat-row-head">' +
        '<span class="cat-desc">' + HL.fmt.esc(t.description || "(적요 없음)") + "</span>" +
        '<span class="cat-meta">' + HL.fmt.esc(t.date) + " · <span class=\"" + sign + '">' + amt + "</span></span>" +
        confBadge(item.confidence) +
        '<button type="button" class="cat-skip" data-idx="' + idx + '">' +
          (item.skip ? "보류됨" : "보류") + "</button>" +
      "</div>" +
      '<div class="cat-chips">' + chips + "</div>" +
    "</div>";
  }

  function renderReview() {
    const wrap = el("cat-review");
    const list = el("cat-review-list");
    if (!_review.length) { wrap.style.display = "none"; return; }
    wrap.style.display = "";
    const onlyReview = el("cat-only-review").checked;
    list.innerHTML = _review.map(function (item, idx) {
      if (onlyReview && !(item.skip || item.confidence == null || item.confidence < 0.8)) return "";
      return rowHtml(item, idx);
    }).join("");
    el("cat-apply").textContent = "적용 (" + _review.length + "건)";
  }

  // 칩/보류 클릭 (이벤트 위임)
  function onListClick(e) {
    const idx = e.target.getAttribute && e.target.getAttribute("data-idx");
    if (idx == null) return;
    const item = _review[Number(idx)];
    if (!item) return;
    if (e.target.classList.contains("tag-chip")) {
      const tag = e.target.getAttribute("data-tag");
      const at = item.tags.indexOf(tag);
      if (at === -1) item.tags.push(tag); else item.tags.splice(at, 1);
      e.target.classList.toggle("on");
    } else if (e.target.classList.contains("cat-skip")) {
      item.skip = !item.skip;
      e.target.textContent = item.skip ? "보류됨" : "보류";
      e.target.closest(".cat-row").classList.toggle("skipped", item.skip);
    }
  }

  // --- 반영: 검토 결과를 거래 레코드에 써넣고 저장 ---
  function apply() {
    if (!_review.length) return;
    const updates = [];
    let confirmed = 0, skipped = 0, left = 0;
    _review.forEach(function (item) {
      const t = item.tx;
      if (item.skip) {
        t.tags = []; t.tagStatus = "skipped"; t.tagSource = "llm";
        skipped++; updates.push(t);
      } else if (item.tags.length) {
        t.tags = item.tags.slice(); t.tagStatus = "confirmed"; t.tagSource = "llm";
        confirmed++; updates.push(t);
      } else {
        left++; // 태그도 없고 보류도 아니면 미분류로 남겨 재추출 대상으로 둔다
      }
    });
    if (!updates.length) {
      setMsg("cat-parse-msg", "반영할 변경이 없습니다. (태그를 고르거나 보류로 표시하세요)", "err");
      return;
    }
    HL.store.updateMany(updates).then(function () {
      _review = [];
      el("cat-review").style.display = "none";
      el("cat-input").value = "";
      el("cat-prompt-zone").style.display = "none";
      setMsg("cat-parse-msg", "반영 완료: 확정 " + confirmed + "건 · 보류 " + skipped + "건" +
        (left ? " · 미분류 유지 " + left + "건" : ""), "ok");
      HL.app.refresh();
    });
  }

  function setMsg(id, msg, kind) {
    const box = el(id);
    box.style.display = "";
    box.className = "import-result " + (kind || "");
    box.textContent = msg;
  }

  function copyPrompt() {
    const text = el("cat-prompt").value;
    const btn = el("cat-copy-prompt");
    const done = function () {
      const old = btn.textContent;
      btn.textContent = "복사됨 ✓";
      setTimeout(function () { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        el("cat-prompt").select(); document.execCommand("copy"); done();
      });
    } else {
      el("cat-prompt").select(); document.execCommand("copy"); done();
    }
  }

  HL.categorize = {
    render: function () {
      renderSummary();
      // 데이터가 바뀌면(임포트 등) 진행 중이던 검토 목록은 비운다.
      if (!_review.length) el("cat-review").style.display = "none";
    },
    init: function () {
      el("cat-extract-btn").addEventListener("click", extract);
      el("cat-copy-prompt").addEventListener("click", copyPrompt);
      el("cat-parse-btn").addEventListener("click", parseInput);
      el("cat-manual-btn").addEventListener("click", openManual);
      el("cat-review-list").addEventListener("click", onListClick);
      el("cat-only-review").addEventListener("change", renderReview);
      el("cat-apply").addEventListener("click", apply);
    },
  };
})();
