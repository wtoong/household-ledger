// 계좌 라벨 관리: 목록 집계 + 일괄 변경/병합 + 오타 방지용 유사 라벨 제안.
//
// 왜 필요한가:
//   잔액 체인(HL.balance)과 대시보드는 `account || source`를 계좌 단위로 쓴다.
//   라벨을 오타 내면 그 순간 별개 계좌가 생기고, dedupKey에도 라벨이 섞여 들어가
//   같은 파일을 다시 올려도 중복으로 안 걸린다(전량 재삽입).
//   → 라벨을 나중에 고칠 수 있어야 하고, 고칠 때 dedupKey도 같이 다시 계산해야 한다.
(function () {
  window.HL = window.HL || {};

  // 라벨이 없으면 source가 계좌 역할을 한다(하위호환). 그래서 그룹 키에 종류를 함께 담는다.
  //   "a:라벨"  = 사용자가 지정한 계좌 라벨
  //   "s:소스"  = 라벨 미지정 → 소스명으로 묶인 그룹
  function groupKey(t) {
    return t.account ? "a:" + t.account : "s:" + (t.source || "");
  }

  function labelOf(t) {
    return t.account || t.source || "";
  }

  // 계좌 그룹 목록. [{key, label, labeled, source, count, first, last}] (거래 많은 순)
  function list(transactions) {
    const byKey = {};
    (transactions || []).forEach(function (t) {
      const k = groupKey(t);
      let g = byKey[k];
      if (!g) {
        g = byKey[k] = {
          key: k,
          label: labelOf(t),
          labeled: !!t.account,
          sources: {},
          count: 0,
          first: t.date,
          last: t.date,
        };
      }
      g.count++;
      if (t.source) g.sources[t.source] = true;
      if (t.date && t.date < g.first) g.first = t.date;
      if (t.date && t.date > g.last) g.last = t.date;
    });
    return Object.keys(byKey)
      .map(function (k) {
        const g = byKey[k];
        g.sources = Object.keys(g.sources).sort();
        return g;
      })
      .sort(function (a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); });
  }

  // 이미 쓰인 계좌 라벨(account가 실제로 채워진 것만). 자동완성/중복확인용.
  function labels(transactions) {
    const seen = {};
    (transactions || []).forEach(function (t) { if (t.account) seen[t.account] = true; });
    return Object.keys(seen).sort();
  }

  // 편집 거리(Levenshtein). 라벨은 짧아 O(n*m)으로 충분하다.
  function distance(a, b) {
    a = String(a || ""); b = String(b || "");
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1);
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 오타 의심 라벨 제안. 완전히 새 라벨이면 null.
  // 기준: 편집거리 <= max(1, 길이의 25%). 짧은 라벨에서 과잉 제안하지 않도록 상한 3.
  function suggest(label, existing) {
    const s = String(label == null ? "" : label).trim();
    if (!s || !existing || !existing.length) return null;
    let best = null, bestD = Infinity;
    for (let i = 0; i < existing.length; i++) {
      const e = existing[i];
      if (e === s) return null; // 이미 있는 라벨이면 제안할 것이 없다
      const d = distance(s, e);
      if (d < bestD) { bestD = d; best = e; }
    }
    const limit = Math.min(3, Math.max(1, Math.round(Math.max(s.length, best.length) * 0.25)));
    return bestD <= limit ? { label: best, distance: bestD } : null;
  }

  // fromKey 그룹의 거래를 toLabel로 옮긴다(이름 변경 = 대상이 없을 때, 병합 = 대상이 있을 때).
  // 순수 함수: 저장은 호출부가 한다. 반환 {updated, removeIds, moved, merged, target}
  //   updated  : 라벨/dedupKey를 새로 계산해 덮어쓸 레코드
  //   removeIds: 병합 결과 dedupKey가 겹쳐 버려야 하는 레코드 id
  function relabel(transactions, fromKey, toLabel) {
    const to = String(toLabel == null ? "" : toLabel).trim();
    if (!to) throw new Error("새 계좌 라벨을 입력하세요.");

    const all = (transactions || []).slice();
    const targets = all.filter(function (t) { return groupKey(t) === fromKey; });
    if (!targets.length) throw new Error("그 계좌에 해당하는 거래가 없습니다.");

    // 대상만 새 라벨로. 라벨이 dedupKey에 들어가므로 반드시 같이 다시 계산한다.
    const changed = {};
    const updated = targets.map(function (t) {
      const n = Object.assign({}, t);
      n.account = to;
      n.dedupKey = HL.hash.txDedupKey(to, n.date, n.time, n.amount, n.description, n.balance);
      changed[n.id] = n;
      return n;
    });

    // 병합 시 같은 거래가 양쪽에 있으면 dedupKey가 겹친다. 먼저 들어온 것(importedAt 빠른 쪽)을 남긴다.
    const ordered = all.slice().sort(function (a, b) {
      return String(a.importedAt || "").localeCompare(String(b.importedAt || ""));
    });
    const seen = {};
    const removeIds = [];
    ordered.forEach(function (orig) {
      const t = changed[orig.id] || orig;
      if (!t.dedupKey) return;
      if (seen[t.dedupKey]) { removeIds.push(t.id); return; }
      seen[t.dedupKey] = true;
    });

    const drop = {};
    removeIds.forEach(function (id) { drop[id] = true; });

    return {
      target: to,
      moved: targets.length,
      merged: removeIds.length,
      updated: updated.filter(function (t) { return !drop[t.id]; }),
      removeIds: removeIds,
    };
  }

  HL.accounts = {
    groupKey: groupKey,
    list: list,
    labels: labels,
    suggest: suggest,
    relabel: relabel,
    _internal: { distance: distance },
  };
})();
