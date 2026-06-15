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

  HL.dataView = {
    render: function () {
      el("data-count").textContent = HL.state.transactions.length;
    },
    init: function () {
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
