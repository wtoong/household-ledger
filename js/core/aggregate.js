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

  // 잔액 추이: balance가 있는 거래만 사용해 날짜별 "합산 잔액"을 만든다.
  // 소스(계좌)별로 가장 최근에 알려진 잔액을 들고 있다가, 각 시점에 모두 더해 총 보유 잔액을 낸다.
  // (단일 계좌면 그 계좌 잔액 그대로, 여러 계좌면 계좌 합계의 시계열)
  // 반환: [{date:'YYYY-MM-DD', balance}] 날짜 오름차순
  function balanceSeries(transactions) {
    const withBal = transactions.filter(function (t) {
      return typeof t.balance === "number" && t.date;
    });
    if (!withBal.length) return [];
    // 날짜 오름차순. 같은 날은 원래 순서를 유지(은행 파일은 대체로 시간순) — sort 안정성에 의존.
    const sorted = withBal.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    const lastBySource = {}; // source -> 가장 최근 잔액
    const byDate = new Map(); // date -> 그 날 종료시점의 합산 잔액
    sorted.forEach(function (t) {
      lastBySource[t.source || "_"] = t.balance;
      let total = 0;
      for (const k in lastBySource) total += lastBySource[k];
      byDate.set(t.date, total); // 같은 날 여러 건이면 마지막 값으로 갱신
    });
    const out = [];
    byDate.forEach(function (bal, date) { out.push({ date: date, balance: bal }); });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  HL.aggregate = {
    monthly: monthly,
    totalsForMonth: totalsForMonth,
    monthKey: monthKey,
    balanceSeries: balanceSeries,
  };
})();
