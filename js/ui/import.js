// 가져오기: 소스 어댑터 선택 → 파일 업로드 또는 JSON 붙여넣기 → 멱등 임포트 결과 표시.
(function () {
  window.HL = window.HL || {};

  function el(id) { return document.getElementById(id); }

  function setResult(msg, kind) {
    const box = el("import-result");
    box.style.display = "";
    box.className = "import-result " + (kind || "");
    box.textContent = msg;
  }

  function afterImport(res) {
    setResult(
      "완료: 신규 " + res.added + "건 추가, 중복 " + res.skipped + "건 건너뜀 (총 " + res.total + "건 처리).",
      "ok"
    );
    HL.app.refresh();
  }

  function onAdapterChange() {
    const id = el("import-source").value;
    const adapter = HL.adapters.get(id);
    if (!adapter) return;
    el("import-help").textContent = adapter.help || "";
    el("import-file-zone").style.display = adapter.kind === "file" ? "" : "none";
    el("import-text-zone").style.display = adapter.kind === "text" ? "" : "none";
    el("import-prompt-zone").style.display = adapter.promptText ? "" : "none";
    if (adapter.promptText) el("import-prompt").value = adapter.promptText;
    if (adapter.kind === "file") el("import-file").setAttribute("accept", adapter.accept || "");
    el("import-result").style.display = "none";
  }

  function handleFile() {
    const id = el("import-source").value;
    const adapter = HL.adapters.get(id);
    const file = el("import-file").files[0];
    if (!file) { setResult("파일을 선택하세요.", "err"); return; }
    setResult("파싱 중…", "");
    adapter.parse(file)
      .then(function (txs) {
        if (!txs.length) { setResult("파일에서 거래를 찾지 못했습니다. 컬럼/형식을 확인하세요.", "err"); return; }
        return HL.store.importTransactions(txs).then(afterImport);
      })
      .catch(function (e) { setResult("오류: " + e.message, "err"); });
    el("import-file").value = "";
  }

  function handleText() {
    const id = el("import-source").value;
    const adapter = HL.adapters.get(id);
    const text = el("import-text").value;
    if (!text.trim()) { setResult("JSON을 붙여넣으세요.", "err"); return; }
    setResult("처리 중…", "");
    adapter.parseText(text)
      .then(function (txs) { return HL.store.importTransactions(txs).then(afterImport); })
      .catch(function (e) { setResult("오류: " + e.message, "err"); });
  }

  function copyPrompt() {
    const text = el("import-prompt").value;
    const done = function () {
      const btn = el("import-copy-prompt");
      const old = btn.textContent;
      btn.textContent = "복사됨 ✓";
      setTimeout(function () { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        el("import-prompt").select(); document.execCommand("copy"); done();
      });
    } else {
      el("import-prompt").select(); document.execCommand("copy"); done();
    }
  }

  HL.import = {
    render: function () {
      // 소스 셀렉트 채우기 (1회)
      const sel = el("import-source");
      if (!sel.options.length) {
        HL.adapters.list().forEach(function (a) {
          const o = document.createElement("option");
          o.value = a.id; o.textContent = a.label;
          sel.appendChild(o);
        });
        onAdapterChange();
      }
    },
    init: function () {
      el("import-source").addEventListener("change", onAdapterChange);
      el("import-file-btn").addEventListener("click", handleFile);
      el("import-text-btn").addEventListener("click", handleText);
      el("import-copy-prompt").addEventListener("click", copyPrompt);
    },
  };
})();
