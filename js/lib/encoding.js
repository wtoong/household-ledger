// 인코딩 견고성: 국내 은행 CSV는 EUC-KR/CP949로 떨어지는 경우가 있어 UTF-8 가정 금지.
// + 작은 CSV 파서(따옴표/줄바꿈 처리).
(function () {
  window.HL = window.HL || {};

  // ArrayBuffer를 디코드. UTF-8 strict 시도 후 실패하면 EUC-KR(CP949)로 폴백.
  function decodeBuffer(buf) {
    const bytes = new Uint8Array(buf);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      try {
        return new TextDecoder("euc-kr").decode(bytes);
      } catch (e2) {
        // 최후의 수단: 관대한 UTF-8
        return new TextDecoder("utf-8").decode(bytes);
      }
    }
  }

  // RFC4180 류의 CSV 파서. 콤마 구분, 따옴표 안 콤마/줄바꿈 처리.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    // BOM 제거
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ",") {
          row.push(field); field = "";
        } else if (c === "\r") {
          // CRLF의 CR은 무시
        } else if (c === "\n") {
          row.push(field); field = "";
          rows.push(row); row = [];
        } else {
          field += c;
        }
      }
    }
    // 마지막 필드/행
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    // 완전히 빈 행 제거
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ""; });
    });
  }

  HL.encoding = { decodeBuffer: decodeBuffer, parseCsv: parseCsv };
})();
