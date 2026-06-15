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

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      try { return window.crypto.randomUUID(); } catch (e) {}
    }
    // fallback
    return "id-" + Date.now().toString(16) + "-" + cyrb53(Math.random() + ":" + Math.random());
  }

  HL.hash = { cyrb53: cyrb53, uuid: uuid };
})();
