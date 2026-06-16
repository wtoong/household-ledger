// 집계: 월별 수입/지출/순액. 내부이체(transfer)와 excludeFromTotal 건은 합계에서 제외.
(function () {
  window.HL = window.HL || {};

  function monthKey(isoDate) {
    return (isoDate || "").slice(0, 7); // YYYY-MM
  }

  // 'YYYY-MM'에 n개월을 더한 키. (n은 음수 가능)
  function addMonths(key, n) {
    const parts = (key || "").split("-");
    const idx = Number(parts[0]) * 12 + (Number(parts[1]) - 1) + (n || 0);
    const y = Math.floor(idx / 12);
    const m = idx - y * 12 + 1;
    return y + "-" + (m < 10 ? "0" + m : m);
  }

  // 두 'YYYY-MM' 사이의 개월 차(to - from). from <= to면 0 이상.
  function monthDiff(fromKey, toKey) {
    const a = fromKey.split("-"), b = toKey.split("-");
    return (Number(b[0]) * 12 + Number(b[1])) - (Number(a[0]) * 12 + Number(a[1]));
  }

  // from~to(포함) 연속 월 키 배열. 데이터가 없는 달도 채워 연속성을 보장.
  function monthRange(fromKey, toKey) {
    const out = [];
    if (!fromKey || !toKey || fromKey > toKey) return out;
    let k = fromKey;
    for (let i = 0; i < 1200 && k <= toKey; i++) { out.push(k); k = addMonths(k, 1); }
    return out;
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

  // fromMonth~toMonth(포함, 'YYYY-MM') 구간의 합산 수입/지출/순액/건수.
  function totalsForRange(transactions, fromMonth, toMonth) {
    const acc = { from: fromMonth, to: toMonth, income: 0, expense: 0, net: 0, count: 0 };
    monthly(transactions).forEach(function (m) {
      if (m.month < fromMonth || m.month > toMonth) return;
      acc.income += m.income; acc.expense += m.expense;
      acc.net += m.net; acc.count += m.count;
    });
    return acc;
  }

  // 잔액 추이: balance가 있는 거래를 "거래 단위"로 모두 펼쳐 하루 안의 등락까지 보존한다.
  // 소스(계좌)별로 가장 최근에 알려진 잔액을 들고 있다가, 거래가 일어날 때마다 그 계좌 잔액을
  // 갱신하고 모든 계좌의 잔액을 더한 "총 보유 잔액"을 그 시점의 한 점으로 남긴다.
  // (단일 계좌면 그 계좌 잔액 그대로, 여러 계좌면 매 거래 시점의 계좌 합계)
  // 같은 날 여러 건도 각각 한 점이 되므로, 당일 큰 출렁임이 한 값으로 뭉개지지 않는다.
  // 정렬은 날짜+시각 오름차순. 같은 시각/시각 미상은 입력 순서를 유지(안정 정렬에 의존).
  // fromMonth/toMonth('YYYY-MM')를 주면 그 구간의 시점만 남긴다. 합산 잔액은
  // 전체 거래로 계산한 뒤 잘라내므로(여러 계좌의 직전 잔액이 보존됨) 절대값이 정확하다.
  // 반환: [{date:'YYYY-MM-DD', time, balance}] 날짜·시각 오름차순
  function balanceSeries(transactions, fromMonth, toMonth) {
    const withBal = transactions.filter(function (t) {
      return typeof t.balance === "number" && t.date;
    });
    if (!withBal.length) return [];
    // 날짜+시각 오름차순. 같은 키는 원래 순서 유지(은행 파일은 대체로 시간순) — sort 안정성에 의존.
    const sorted = withBal.slice().sort(function (a, b) {
      const ka = a.date + "T" + (a.time || ""), kb = b.date + "T" + (b.time || "");
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    const lastBySource = {}; // source -> 가장 최근 잔액
    let out = [];
    sorted.forEach(function (t) {
      lastBySource[t.source || "_"] = t.balance;
      let total = 0;
      for (const k in lastBySource) total += lastBySource[k];
      out.push({ date: t.date, time: t.time || "", balance: total }); // 거래마다 한 점
    });
    if (fromMonth || toMonth) {
      out = out.filter(function (p) {
        const mk = p.date.slice(0, 7);
        if (fromMonth && mk < fromMonth) return false;
        if (toMonth && mk > toMonth) return false;
        return true;
      });
    }
    return out;
  }

  HL.aggregate = {
    monthly: monthly,
    totalsForMonth: totalsForMonth,
    totalsForRange: totalsForRange,
    monthKey: monthKey,
    addMonths: addMonths,
    monthDiff: monthDiff,
    monthRange: monthRange,
    balanceSeries: balanceSeries,
  };
})();
