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

  function afterImport(res, dropped) {
    let msg = "완료: 신규 " + res.added + "건 추가, 중복 " + res.skipped + "건 건너뜀 (총 " + res.total + "건 처리).";
    // 복원은 '전부 돌아왔는지'가 핵심이라 버려진 건수를 숨기지 않는다.
    if (dropped) msg += "\n※ " + dropped + "건은 date/amount가 없어 되살리지 못했습니다.";
    setResult(msg, dropped ? "" : "ok");
    HL.app.refresh();
  }

  function onAdapterChange() {
    const id = el("import-source").value;
    const adapter = HL.adapters.get(id);
    if (!adapter) return;
    el("import-help").textContent = adapter.help || "";
    // 백업 복원은 계좌 라벨이 파일 안에 들어 있다. 여기서 덮어쓰면 복원이 아니게 되므로 칸을 감춘다.
    el("import-account-zone").style.display = adapter.noAccount ? "none" : "";
    el("import-file-zone").style.display = adapter.kind === "file" ? "" : "none";
    el("import-text-zone").style.display = adapter.kind === "text" ? "" : "none";
    el("import-prompt-zone").style.display = adapter.promptText ? "" : "none";
    if (adapter.promptText) el("import-prompt").value = adapter.promptText;
    if (adapter.kind === "file") el("import-file").setAttribute("accept", adapter.accept || "");
    el("import-result").style.display = "none";
  }

  // 계좌 라벨을 확정한다. 오타면 별개 계좌가 생기고 dedupKey까지 갈라지므로,
  // 처음 보는 라벨일 때 한 번 되묻는다. 취소하면 null을 돌려 임포트를 중단한다.
  function importOpts(adapter) {
    if (adapter && adapter.noAccount) return {};
    const acct = el("import-account").value.trim();
    if (!acct) return { account: undefined };

    const known = HL.accounts.labels(HL.state.transactions);
    if (known.indexOf(acct) !== -1) return { account: acct };

    const near = HL.accounts.suggest(acct, known);
    let msg = "‘" + acct + "’은(는) 처음 쓰는 계좌 라벨입니다.\n\n";
    if (near) msg += "혹시 ‘" + near.label + "’를 쓰려던 건가요? (" + near.distance + "글자 차이)\n\n";
    msg += known.length
      ? "기존 계좌: " + known.join(", ") + "\n\n"
      : "아직 라벨을 지정한 계좌가 없습니다.\n\n";
    msg += "오타가 아니라면 새 계좌로 등록됩니다. 계속할까요?\n" +
      "(나중에 데이터 관리 → 계좌 라벨에서 고치거나 합칠 수 있습니다)";

    return confirm(msg) ? { account: acct } : null;
  }

  function handleFile() {
    const id = el("import-source").value;
    const adapter = HL.adapters.get(id);
    const file = el("import-file").files[0];
    if (!file) { setResult("파일을 선택하세요.", "err"); return; }
    const opts = importOpts(adapter);
    if (!opts) { setResult("취소했습니다. 계좌 라벨을 확인하세요.", ""); return; }
    setResult("파싱 중…", "");
    adapter.parse(file, opts)
      .then(function (txs) {
        if (!txs.length) { setResult("파일에서 거래를 찾지 못했습니다. 컬럼/형식을 확인하세요.", "err"); return; }
        return HL.store.importTransactions(txs).then(function (res) { afterImport(res, txs._dropped); });
      })
      .catch(function (e) { setResult("오류: " + e.message, "err"); });
    el("import-file").value = "";
  }

  function handleText() {
    const id = el("import-source").value;
    const adapter = HL.adapters.get(id);
    const text = el("import-text").value;
    if (!text.trim()) { setResult("JSON을 붙여넣으세요.", "err"); return; }
    const opts = importOpts(adapter);
    if (!opts) { setResult("취소했습니다. 계좌 라벨을 확인하세요.", ""); return; }
    setResult("처리 중…", "");
    adapter.parseText(text, opts)
      .then(function (txs) {
        return HL.store.importTransactions(txs).then(function (res) { afterImport(res, txs._dropped); });
      })
      .catch(function (e) { setResult("오류: " + e.message, "err"); });
  }

  // 이미 저장된 거래에서 쓰인 계좌 라벨을 datalist에 채워 재입력을 돕는다.
  function refreshAccountList() {
    const dl = el("account-labels");
    if (!dl) return;
    dl.innerHTML = "";
    HL.accounts.labels(HL.state.transactions).forEach(function (label) {
      const o = document.createElement("option");
      o.value = label;
      dl.appendChild(o);
    });
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
      refreshAccountList();
    },
    // 데이터 관리 탭도 같은 datalist를 쓰므로 밖에서 다시 채울 수 있게 열어둔다.
    refreshAccountList: refreshAccountList,
    init: function () {
      el("import-source").addEventListener("change", onAdapterChange);
      el("import-file-btn").addEventListener("click", handleFile);
      el("import-text-btn").addEventListener("click", handleText);
      el("import-copy-prompt").addEventListener("click", copyPrompt);
    },
  };
})();
