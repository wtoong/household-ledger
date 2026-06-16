// 잔액 검증 + 시간순 정렬 보강.
// 거래에 '거래후잔액(balance)'이 같이 들어오면, 계좌별로 시간 오름차순 체인을 만들어
//   직전잔액 + 현재금액 == 현재잔액
// 이 성립하는지 확인한다. 성립하면 그 사이에 누락된 거래가 없음이 '확정'된다.
// 성립하지 않으면 그 차액만큼의 거래가 (시간 미상으로) 누락된 것으로 추정한다.
// 같은 시각이 여러 건이라 순서가 모호할 땐, 잔액 체인이 들어맞는 순열을 찾아 순서를 확정한다.
(function () {
  window.HL = window.HL || {};

  // 잔액은 계좌 단위 개념이라 같은 계좌끼리만 체인을 만든다.
  // account(계좌 라벨)가 우선이고, 없으면 source를 계좌로 본다(하위호환).
  function acctKey(t) { return t.account || t.source || ""; }
  function dtKey(t) { return t.date + "T" + (t.time || ""); }
  function hasBal(t) { return typeof t.balance === "number" && !isNaN(t.balance); }
  // 원 단위 정수라 정확히 떨어지지만, 부동소수/반올림 여지를 위해 0.5원 허용.
  function eq(a, b) { return Math.abs(a - b) < 0.5; }

  // 동일 시각(또는 시각 미상) 묶음의 내부 순서를 잔액 체인으로 맞춘다.
  // incoming: 직전 확정 잔액(없으면 null). 반환: {order, links} (links=일관된 연결 수).
  function orderCluster(items, incoming) {
    if (items.length <= 1) {
      var lk = items.length === 1 && incoming != null && eq(incoming + items[0].amount, items[0].balance) ? 1 : 0;
      return { order: items.slice(), links: lk };
    }
    // 순열 폭발 방지: 너무 크면 들어온 순서 그대로 둔다.
    if (items.length > 7) return { order: items.slice(), links: 0 };

    var best = null, bestScore = -1;
    permute(items, function (perm) {
      var score = 0, run = incoming;
      for (var i = 0; i < perm.length; i++) {
        if (run != null && eq(run + perm[i].amount, perm[i].balance)) score++;
        run = perm[i].balance;
      }
      if (score > bestScore) { bestScore = score; best = perm.slice(); }
    });
    return { order: best || items.slice(), links: bestScore < 0 ? 0 : bestScore };
  }

  // 모든 순열에 대해 cb 호출 (Heap's algorithm). items.length <= 7 에서만 사용.
  function permute(items, cb) {
    var a = items.slice();
    var c = new Array(a.length).fill(0);
    cb(a);
    var i = 0;
    while (i < a.length) {
      if (c[i] < i) {
        var j = i % 2 === 0 ? 0 : c[i];
        var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        cb(a);
        c[i]++;
        i = 0;
      } else { c[i] = 0; i++; }
    }
  }

  // transactions 전체를 받아 계좌별 잔액 체인을 검증한다.
  // 반환: { annotations:{id->ann}, orderRank:{id->n}, problems:[...], summary:{...} }
  function validate(transactions) {
    var annotations = {};
    var orderRank = {};
    var problems = [];
    var summary = { ok: 0, gaps: 0, noBalance: 0, reordered: 0, checked: 0 };

    // 계좌별로 분리
    var bySource = {};
    (transactions || []).forEach(function (t) {
      var k = acctKey(t);
      (bySource[k] = bySource[k] || []).push(t);
    });

    Object.keys(bySource).forEach(function (src) {
      var list = bySource[src];

      // 잔액 없는 건은 체인 검증 불가 → 따로 표시
      var withBal = [];
      list.forEach(function (t) {
        if (hasBal(t)) { withBal.push(t); }
        else {
          annotations[t.id] = { status: "no-balance" };
          summary.noBalance++;
        }
      });
      if (!withBal.length) return;

      // 시각 오름차순(가장 이른 것 먼저). 시각 미상은 그날 가장 이른 것으로 본다.
      withBal.sort(function (a, b) {
        var ka = dtKey(a), kb = dtKey(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });

      // 같은 dtKey끼리 묶음(=시각이 같아 순서가 모호한 구간)으로 분할
      var clusters = [];
      for (var i = 0; i < withBal.length;) {
        var j = i + 1;
        while (j < withBal.length && dtKey(withBal[j]) === dtKey(withBal[i])) j++;
        clusters.push(withBal.slice(i, j));
        i = j;
      }

      // 잔액 체인을 따라 묶음 내부 순서를 확정하며 한 줄로 펼친다
      var ordered = [];
      var running = null; // 직전 확정 잔액
      clusters.forEach(function (cluster) {
        var res = orderCluster(cluster, running);
        // 시각이 같은데 순서가 바뀌었으면(=잔액으로 순서를 찾아냄) 표시
        if (cluster.length > 1) {
          var changed = false;
          for (var k = 0; k < cluster.length; k++) if (cluster[k] !== res.order[k]) { changed = true; break; }
          if (changed) {
            summary.reordered++;
            problems.push({
              kind: "reordered", account: src,
              date: cluster[0].date, time: cluster[0].time || "",
              count: cluster.length,
              ids: res.order.map(function (t) { return t.id; }),
            });
          }
        }
        res.order.forEach(function (t) { ordered.push(t); });
        running = res.order[res.order.length - 1].balance;
      });

      // 펼쳐진 순서대로 인접 검증 + 주석/순위 부여
      for (var n = 0; n < ordered.length; n++) {
        var t = ordered[n];
        orderRank[t.id] = n; // 계좌 내 시간 오름차순 순위 (클수록 나중)
        summary.checked++;
        if (n === 0) {
          // 체인의 첫 거래: 직전이 없어 비교 불가(시작점)
          annotations[t.id] = { status: "start" };
          continue;
        }
        var prev = ordered[n - 1];
        var expected = prev.balance + t.amount; // 직전잔액 + 현재금액
        if (eq(expected, t.balance)) {
          annotations[t.id] = { status: "ok", prevId: prev.id };
          summary.ok++;
        } else {
          // 누락 추정액 = (현재잔액 - 현재금액) - 직전잔액
          // 양수면 그 사이 입금(들), 음수면 출금(들)이 더 있었던 것.
          var gap = (t.balance - t.amount) - prev.balance;
          annotations[t.id] = { status: "gap", prevId: prev.id, gapAmount: gap };
          summary.gaps++;
          problems.push({
            kind: "gap", account: src, id: t.id, prevId: prev.id,
            date: t.date, time: t.time || "",
            prevDate: prev.date, prevTime: prev.time || "",
            gapAmount: gap,
          });
        }
      }
    });

    return {
      annotations: annotations,
      orderRank: orderRank,
      problems: problems,
      summary: summary,
    };
  }

  HL.balance = {
    validate: validate,
    // 테스트/디버깅용 내부 함수 노출
    _internal: { orderCluster: orderCluster, permute: permute },
  };
})();
