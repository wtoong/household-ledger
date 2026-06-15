// 어댑터 레지스트리. 새 데이터 소스는 여기에 등록만 하면 파이프라인에 연결된다.
// 어댑터 계약 (PRD 7장 확장):
//   { id, label, kind: 'file'|'text', accept?, help?, promptText?,
//     parse(file)->Promise<Tx[]>            // kind==='file'
//     parseText(text)->Promise<Tx[]> }      // kind==='text'
// 모든 어댑터는 표준 거래 객체(부분: date/amount/type/description/source/dedupKey/balance?)만 반환.
(function () {
  window.HL = window.HL || {};

  const _adapters = [];

  function register(adapter) {
    _adapters.push(adapter);
  }
  function list() { return _adapters.slice(); }
  function get(id) {
    for (let i = 0; i < _adapters.length; i++) if (_adapters[i].id === id) return _adapters[i];
    return null;
  }

  HL.adapters = { register: register, list: list, get: get };
})();
