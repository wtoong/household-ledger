// 의존성 없는 최소 IndexedDB 래퍼. (Dexie 대신 직접 구현 — 오프라인/경량 우선)
(function () {
  window.HL = window.HL || {};

  const DB_NAME = "household-ledger";
  const DB_VERSION = 1;
  const STORE = "transactions";

  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          // dedupKey는 비유니크 인덱스: 멱등 처리는 앱 레벨에서 Set으로 수행
          os.createIndex("dedupKey", "dedupKey", { unique: false });
          os.createIndex("date", "date", { unique: false });
          os.createIndex("source", "source", { unique: false });
        }
      };
      req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
      req.onerror = function (e) { reject(e.target.error); };
    });
  }

  function tx(mode) {
    return open().then(function (db) {
      return db.transaction(STORE, mode).objectStore(STORE);
    });
  }

  function getAll() {
    return tx("readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        const req = store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getAllDedupKeys() {
    return tx("readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        const set = new Set();
        const idx = store.index("dedupKey");
        const req = idx.openKeyCursor();
        req.onsuccess = function () {
          const cur = req.result;
          if (cur) { set.add(cur.key); cur.continue(); }
          else resolve(set);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // 여러 건을 한 트랜잭션에서 추가
  function putMany(items) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, "readwrite");
        const store = t.objectStore(STORE);
        items.forEach(function (it) { store.put(it); });
        t.oncomplete = function () { resolve(items.length); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function remove(id) {
    return tx("readwrite").then(function (store) {
      return new Promise(function (resolve, reject) {
        const req = store.delete(id);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function clear() {
    return tx("readwrite").then(function (store) {
      return new Promise(function (resolve, reject) {
        const req = store.clear();
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  HL.idb = {
    open: open,
    getAll: getAll,
    getAllDedupKeys: getAllDedupKeys,
    putMany: putMany,
    remove: remove,
    clear: clear,
  };
})();
