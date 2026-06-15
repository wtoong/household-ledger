// 집계: 월별 수입/지출/순액. 내부이체(transfer)와 excludeFromTotal 건은 합계에서 제외.
(function () {
  window.HL = window.HL || {};

  function monthKey(isoDate) {
    return (isoDate || "").slice(0, 7); // YYYY-MM
  }

  function isCounted(t) {
    if (t.excludeFromTotal === true) return false;
    if (t.type === "transfer") return false;
    return true;
  }

  // 전체 거래 -> { 'YYYY-MM': {income, expense, net, count} } 정렬된 배열 반환
  function monthly(transactions) {
    const map = new Map();
    transactions.forEach(function (t) {
      if (!isCounted(t)) return;
      const k = monthKey(t.date);
      if (!k) return;
      if (!map.has(k)) map.set(k, { month: k, income: 0, expense: 0, net: 0, count: 0 });
      const m = map.get(k);
      if (t.amount >= 0) m.income += t.amount;
      else m.expense += -t.amount;
      m.net += t.amount;
      m.count++;
    });
    const arr = Array.from(map.values());
    arr.sort(function (a, b) { return a.month < b.month ? -1 : a.month > b.month ? 1 : 0; });
    return arr;
  }

  function totalsForMonth(transactions, month) {
    const all = monthly(transactions);
    for (let i = 0; i < all.length; i++) if (all[i].month === month) return all[i];
    return { month: month, income: 0, expense: 0, net: 0, count: 0 };
  }

  HL.aggregate = { monthly: monthly, totalsForMonth: totalsForMonth, monthKey: monthKey };
})();
