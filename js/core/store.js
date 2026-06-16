// 거래 저장소: 멱등 임포트 + 조회 + 초기화 + 내보내기.
// 어댑터가 만든 표준 거래(부분 객체)를 받아 id/importedAt를 채우고 중복을 건너뛴다.
(function () {
  window.HL = window.HL || {};

  // 어댑터 산출물 -> 완전한 표준 거래로 정규화
  function normalize(t) {
    return {
      id: HL.hash.uuid(),
      date: t.date,
      time: t.time || undefined,
      amount: t.amount,
      type: t.type || (t.amount >= 0 ? "income" : "expense"),
      description: t.description || "",
      source: t.source,
      dedupKey: t.dedupKey,
      importedAt: new Date().toISOString(),
      // 관점(perspective)용 태그 + 분류 상태기계.
      //   tagStatus: none(미시도) → proposed(LLM제안·검토대기) → confirmed(확정) | skipped(보류)
      //   skipped/confirmed/proposed는 재추출 대상에서 제외(none만 다시 LLM에 보냄).
      tags: Array.isArray(t.tags) ? t.tags.slice() : [],
      tagStatus: t.tagStatus || "none",
      tagSource: t.tagSource || undefined, // llm | manual | rule
      // Phase 2+ 자리만 잡아둠
      category: t.category,
      installment: t.installment,
      excludeFromTotal: t.excludeFromTotal === true ? true : undefined,
      // 투명성/디버깅용 원본 보조필드
      balance: typeof t.balance === "number" ? t.balance : undefined,
    };
  }

  // items: 어댑터가 반환한 거래 배열. 멱등 처리 후 {added, skipped, total} 반환.
  function importTransactions(items) {
    if (!items || !items.length) return Promise.resolve({ added: 0, skipped: 0, total: 0 });
    return HL.idb.getAllDedupKeys().then(function (existing) {
      const seen = new Set(existing); // 이번 배치 내부 중복도 함께 제거
      const fresh = [];
      let skipped = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it || !it.dedupKey) { skipped++; continue; }
        if (seen.has(it.dedupKey)) { skipped++; continue; }
        seen.add(it.dedupKey);
        fresh.push(normalize(it));
      }
      return HL.idb.putMany(fresh).then(function () {
        return { added: fresh.length, skipped: skipped, total: items.length };
      });
    });
  }

  function getAll() {
    return HL.idb.getAll();
  }

  // 이미 저장된 거래(전체 레코드)를 갱신 저장. putMany는 id(keyPath)로 upsert하므로 그대로 덮어쓴다.
  // 태그/분류 상태 변경 등 부분 수정 시, 호출부에서 메모리의 전체 레코드를 수정해 넘긴다.
  function updateMany(txs) {
    if (!txs || !txs.length) return Promise.resolve(0);
    return HL.idb.putMany(txs);
  }

  function clear() {
    return HL.idb.clear();
  }

  function exportJSON(transactions) {
    return JSON.stringify(transactions, null, 2);
  }

  function csvEscape(v) {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV(transactions) {
    const cols = ["date", "time", "amount", "type", "description", "source", "tags", "tagStatus", "balance", "dedupKey", "importedAt"];
    const lines = [cols.join(",")];
    transactions.forEach(function (t) {
      lines.push(cols.map(function (c) {
        if (c === "tags") return csvEscape((t.tags || []).join(";")); // 배열은 ; 로 합쳐 한 칸에
        return csvEscape(t[c]);
      }).join(","));
    });
    // 엑셀에서 한글 깨짐 방지용 UTF-8 BOM
    return "﻿" + lines.join("\r\n");
  }

  HL.store = {
    importTransactions: importTransactions,
    getAll: getAll,
    updateMany: updateMany,
    clear: clear,
    exportJSON: exportJSON,
    exportCSV: exportCSV,
  };
})();
