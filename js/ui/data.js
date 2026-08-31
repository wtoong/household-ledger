// 데이터 관리: 표준 포맷 내보내기(JSON/CSV) + 전체 초기화. (데이터 소유권 원칙)
(function () {
  window.HL = window.HL || {};

  function el(id) { return document.getElementById(id); }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function setAcctResult(msg, kind) {
    const box = el("acct-result");
    box.style.display = "";
    box.className = "import-result " + (kind || "");
    box.textContent = msg;
  }

  // 현재 계좌 그룹을 표와 선택박스에 그린다.
  function renderAccounts() {
    const groups = HL.accounts.list(HL.state.transactions);
    const listBox = el("acct-list");
    const sel = el("acct-from");
    const prev = sel.value;

    if (!groups.length) {
      listBox.innerHTML = '<p class="muted small">아직 거래가 없습니다.</p>';
      sel.innerHTML = "";
      el("acct-apply").disabled = true;
      return;
    }
    el("acct-apply").disabled = false;

    listBox.innerHTML =
      '<table class="tx-table"><thead><tr><th>계좌</th><th>거래</th><th>기간</th><th>소스</th></tr></thead><tbody>' +
      groups.map(function (g) {
        // 라벨이 없는 그룹은 소스명으로 묶인 상태라는 걸 드러낸다(합쳐질 위험이 있는 쪽).
        const name = g.labeled
          ? HL.fmt.esc(g.label)
          : HL.fmt.esc(HL.fmt.sourceLabel(g.label)) + ' <span class="muted small">(라벨 없음)</span>';
        const srcs = g.sources.map(function (id) { return HL.fmt.sourceLabel(id); }).join(", ");
        return "<tr><td>" + name + "</td><td>" + g.count + "건</td><td class=\"muted small\">" +
          HL.fmt.esc(g.first) + " ~ " + HL.fmt.esc(g.last) + "</td><td class=\"muted small\">" +
          HL.fmt.esc(srcs) + "</td></tr>";
      }).join("") +
      "</tbody></table>";

    sel.innerHTML = "";
    groups.forEach(function (g) {
      const o = document.createElement("option");
      o.value = g.key;
      o.textContent = (g.labeled ? g.label : HL.fmt.sourceLabel(g.label) + " (라벨 없음)") + " · " + g.count + "건";
      sel.appendChild(o);
    });
    if (prev) sel.value = prev;
    if (!sel.value && sel.options.length) sel.value = sel.options[0].value;
  }

  function applyRelabel() {
    const fromKey = el("acct-from").value;
    const to = el("acct-to").value.trim();
    if (!fromKey) { setAcctResult("바꿀 계좌를 고르세요.", "err"); return; }
    if (!to) { setAcctResult("새 라벨을 입력하세요.", "err"); return; }

    let plan;
    try {
      plan = HL.accounts.relabel(HL.state.transactions, fromKey, to);
    } catch (e) {
      setAcctResult("오류: " + e.message, "err");
      return;
    }

    const existing = HL.accounts.labels(HL.state.transactions);
    const isMerge = existing.indexOf(to) !== -1 && fromKey !== "a:" + to;
    let msg = plan.moved + "건을 ‘" + to + "’로 " + (isMerge ? "합칩니다." : "바꿉니다.") + "\n";
    if (plan.merged) msg += "이 중 " + plan.merged + "건은 대상 계좌에 같은 거래가 이미 있어 삭제됩니다.\n";
    msg += "\n중복 판정 키(dedupKey)도 새 라벨 기준으로 다시 계산되어, 앞으로 같은 파일을 올리면 정상적으로 중복 처리됩니다.\n계속할까요?";
    if (!confirm(msg)) return;

    HL.store.applyRelabel(plan).then(function (res) {
      return HL.app.refresh().then(function () {
        el("acct-to").value = "";
        setAcctResult(
          "완료: " + res.moved + "건을 ‘" + res.target + "’로 정리했습니다." +
          (res.merged ? " (중복 " + res.merged + "건 삭제)" : ""),
          "ok"
        );
      });
    }).catch(function (e) { setAcctResult("오류: " + e.message, "err"); });
  }

  HL.dataView = {
    render: function () {
      el("data-count").textContent = HL.state.transactions.length;
      renderAccounts();
      // 계좌 라벨 datalist는 가져오기 탭과 공유한다. 이 탭만 열어도 자동완성이 되도록 여기서도 채운다.
      if (HL.import && HL.import.refreshAccountList) HL.import.refreshAccountList();
    },
    init: function () {
      el("acct-apply").addEventListener("click", applyRelabel);
      el("data-export-json").addEventListener("click", function () {
        download("ledger-" + stamp() + ".json", HL.store.exportJSON(HL.state.transactions), "application/json");
      });
      el("data-export-csv").addEventListener("click", function () {
        download("ledger-" + stamp() + ".csv", HL.store.exportCSV(HL.state.transactions), "text/csv;charset=utf-8");
      });
      el("data-reset").addEventListener("click", function () {
        if (!HL.state.transactions.length) { alert("저장된 데이터가 없습니다."); return; }
        const ok = confirm(
          "정말 모든 거래(" + HL.state.transactions.length + "건)를 삭제할까요?\n" +
          "되돌릴 수 없습니다. 먼저 내보내기로 백업하는 것을 권장합니다."
        );
        if (!ok) return;
        HL.store.clear().then(function () {
          HL.state.selectedMonth = null;
          HL.app.refresh();
          alert("초기화되었습니다.");
        });
      });
    },
  };
})();
