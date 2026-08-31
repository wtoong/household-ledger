// 작고 결정적인 문자열 해시 (cyrb53). dedupKey 생성과 fallback id에 사용.
// SubtleCrypto는 보안 컨텍스트(file://)에서 불안정하므로 동기 해시를 쓴다.
(function () {
  window.HL = window.HL || {};

  function cyrb53(str, seed) {
    seed = seed || 0;
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  // 거래 중복 판정 키. 계좌·날짜·시각·금액·적요·잔액 조합.
  // 어댑터와 백업 복원, 계좌 라벨 변경이 모두 이 함수를 써야 키가 어긋나지 않는다.
  // (라벨을 바꾸면 acct가 바뀌므로 dedupKey도 반드시 다시 계산해야 한다.)
  function txDedupKey(acct, date, time, amount, description, balance) {
    const bal = (balance == null || (typeof balance === "number" && isNaN(balance))) ? "" : balance;
    return cyrb53([acct, date, time || "", amount, description == null ? "" : description, bal].join("|"));
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      try { return window.crypto.randomUUID(); } catch (e) {}
    }
    // fallback
    return "id-" + Date.now().toString(16) + "-" + cyrb53(Math.random() + ":" + Math.random());
  }

  HL.hash = { cyrb53: cyrb53, txDedupKey: txDedupKey, uuid: uuid };
})();
