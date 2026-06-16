# 공용 가계부 (Household Ledger)

은행/카드 거래내역을 **표준 포맷으로 변환·누적 저장**하고, **합산 현금흐름(수입/지출)**을 한눈에 보여주는 **클라이언트 전용** 가계부 웹앱.

- **로컬 전용**: 모든 데이터는 브라우저(IndexedDB)에만 저장. 외부 서버로 전송하지 않음.
- **백엔드/빌드 없음**: 정적 파일만. 그대로 열거나 정적 호스팅(GitHub Pages 등)에 올리면 동작.
- **어댑터 구조**: 소스(은행/카드/토스)마다 파서(어댑터)만 추가하면 확장됨.

현재 **Phase 1** 범위입니다(PRD 기준). 현금주의로만 집계하며, 카드 카테고리 분해/내부이체 자동감지 등은 Phase 2+입니다.

## 실행

빌드가 필요 없습니다.

```bash
# 방법 1) 로컬 서버 (권장)
npm run serve         # http://localhost:8080
# 또는: python3 -m http.server 8080

# 방법 2) 파일 더블클릭
# index.html 을 브라우저로 직접 열어도 동작합니다(IndexedDB 사용).
```

> 배포: 이 폴더를 그대로 GitHub Pages / Netlify / Vercel 등 정적 호스팅에 올리면 됩니다.

## 기능 (Phase 1)

- **가져오기**
  - **새마을금고 계좌 (CSV/XLSX)** — 인코딩(EUC-KR/CP949/UTF-8) 자동 감지, 헤더명 변동에 견고한 컬럼 매핑.
  - **토스 캡쳐 (JSON 붙여넣기)** — 아래 "토스 캡쳐 워크플로" 참고.
- **멱등 임포트** — 같은 기간을 다시 올려도 중복 적재되지 않음(`dedupKey`). 신규/스킵 건수 표시.
- **대시보드** — 선택한 달의 순현금흐름을 크게 강조 + 월별 수입/지출 막대 차트(차트 라이브러리 없이 SVG). **관점**별로 집계가 바뀝니다.
- **거래내역** — 기간·텍스트(적요)·수입/지출 필터, 최신순, 더보기. 상단에서 **관점** 전환.
- **관점(perspective)** — 같은 데이터를 "어떤 시선으로 볼지"만 바꾸는 저장된 필터. 아래 "관점 & 분류" 참고.
- **분류** — 미분류 거래를 본인 LLM에 위임해 태그를 받고, 검토 후 반영. 아래 "관점 & 분류" 참고.
- **데이터 관리** — JSON/CSV 내보내기(데이터 소유권), 전체 초기화.

## 관점 & 분류 (perspective + tagging)

> "부동산 자금이동을 뺀 자잘한 생활 현금흐름만", "부동산만" 처럼 **보는 시선**을 바꾸고 싶을 때.

핵심은 **분류(태그)와 관점(필터)을 분리**하는 것입니다. 둘을 묶으면 작업량이 *거래 × 관점*(곱)으로 늘지만, 분리하면 *거래 + 관점*(합)으로 끝납니다.

- **태그 (1층, 거래의 속성)** — 거래마다 **한 번만** 매깁니다. 한 거래에 여러 개 가능(예: `부동산`,`대출`). 닫힌 목록에서만 고릅니다.
- **관점 (2층, 필터)** — 태그 위에 얹히는 저장된 필터일 뿐입니다. 태그된 거래는 모든 관점에서 자동으로 알맞게 포함/제외됩니다.

기본 관점:

| 관점 | 의미 |
|---|---|
| 전체 | 모든 거래 |
| 생활 현금흐름 | 부동산·대출·투자 태그, 고액(300만↑), 이체를 **제외**한 자잘한 흐름 |
| 큰 자금이동 | 위와 반대(부동산·대출·투자·이체·고액) |
| 부동산 | `부동산` 태그가 붙은 거래 |

> 태그가 아직 없어도 **금액 임계값/이체 여부**만으로 큰 자금이동을 상당 부분 자동으로 걸러냅니다(태그를 채우면 정확도↑).

### 분류 워크플로 (외부 LLM 위임)

앱은 아무것도 외부로 보내지 않습니다. 토스 캡쳐와 같은 "사용자 게이트키퍼" 방식입니다.

1. [분류] → **미분류 추출** — 미분류 거래 + 지시문이 담긴 프롬프트가 생성됩니다(`prompts/categorize.txt` 참고).
2. 복사해 본인 LLM에 넣으면, 이름을 보고 카테고리를 추론한 JSON을 돌려줍니다.
3. 그 JSON을 **②에 붙여넣고 결과 분석** — 칩으로 태그를 가감하고, 신뢰도가 낮은 항목만 추려 검토.
4. **적용** — 태그를 고른 행은 `확정`, 보류 표시한 행은 `보류`(다시 LLM에 안 보냄), 둘 다 아니면 `미분류`로 남습니다.

> 분류 상태기계: `none`(미시도) → `proposed`(검토대기) → `confirmed`(확정) | `skipped`(보류). **`none`만** 다음 추출 대상이라, LLM에 같은 거래를 두 번 안 보냅니다. 사람 이름처럼 판단 불가한 건은 "미분류·보류 직접 분류"로 손수 태그를 답니다.

## 토스 캡쳐 워크플로

앱은 캡쳐를 **외부로 보내지 않습니다.** 변환은 사용자가 본인이 선택한 LLM에서 직접 수행합니다.

1. 토스 거래내역 화면을 캡쳐합니다(필요하면 여러 장).
2. [가져오기] → 소스 "토스 캡쳐" 선택 → **프롬프트 복사**.
3. 복사한 프롬프트 + 캡쳐를 본인의 LLM(Gemini/ChatGPT/Claude 등)에 넣어 JSON을 받습니다.
   - 프롬프트 원문: [`prompts/toss-extract.txt`](prompts/toss-extract.txt)
4. 받은 JSON을 붙여넣고 **JSON 가져오기**. 멱등 처리되므로 캡쳐가 겹쳐도 안전합니다.

> **프라이버시 주의**: 캡쳐를 외부 LLM에 올리는 것은 사용자의 선택입니다. 특히 **Gemini 무료(AI Studio) 티어는 입력 데이터를 모델 개선에 사용**할 수 있으므로 금융 캡쳐에는 유료 티어 또는 데이터 미사용이 보장되는 경로를 권장합니다. (향후 앱 내장 Gemini 자동 변환은 명시적 opt-in 옵션으로만 검토 — 아래 Roadmap)

## 데이터 모델 (표준 거래)

```ts
interface Transaction {
  id: string;            // 내부 고유 ID
  date: string;          // 'YYYY-MM-DD' (출금/입금 시점, 현금주의)
  amount: number;        // 양수=수입, 음수=지출
  type: 'income' | 'expense' | 'transfer';
  description: string;   // 적요/가맹점
  source: string;        // 'mg-account' | 'toss' | ...
  dedupKey: string;      // 멱등 임포트용 키
  importedAt: string;
  balance?: number;      // 거래 후 잔액(있으면 dedup 정확도↑)
  tags: string[];        // 관점용 태그(닫힌 목록). 한 거래에 여러 개 가능.
  tagStatus: 'none' | 'proposed' | 'confirmed' | 'skipped'; // 분류 상태기계
  tagSource?: 'llm' | 'manual' | 'rule';                    // 태그가 매겨진 경로
  category?: string;        // Phase 2+ (미사용)
  installment?: object;     // Phase 2+
  excludeFromTotal?: boolean; // Phase 2+ (내부이체 자동감지)
}
```

`transfer` 또는 `excludeFromTotal=true` 거래는 합계 집계에서 제외됩니다.

## 구조

```
index.html              # 화면 골격 + 스크립트 로드 순서
css/styles.css
vendor/xlsx.full.min.js  # SheetJS (XLSX 파싱, 오프라인용 동봉)
js/
  lib/   hash.js · encoding.js(CSV+인코딩) · idb.js(IndexedDB 래퍼)
  core/  store.js(멱등 저장/내보내기) · aggregate.js(월별 집계)
         categories.js(태그 체계+LLM 프롬프트/파싱) · perspectives.js(관점=저장된 필터)
  adapters/ registry.js · mg-account.js · toss-paste.js
  ui/    charts.js · dashboard.js · transactions.js · categorize.js(분류) · import.js · data.js
  app.js  # 부트스트랩(상태/탭/refresh/포맷)
test/smoke.js           # Node 스모크 테스트
prompts/toss-extract.txt · prompts/categorize.txt
```

### 어댑터 추가하기

`HL.adapters.register({...})` 한 번이면 가져오기 UI에 자동으로 노출됩니다.

```js
HL.adapters.register({
  id: 'samsung-card',
  label: '삼성카드 (XLSX)',
  kind: 'file',                 // 'file' | 'text'
  accept: '.xlsx,.xls',
  parse: function (file) { /* 표준 거래 배열 반환 (dedupKey 포함) */ },
});
```

모든 어댑터는 **표준 거래 객체만** 반환하며, 이후 저장/집계/시각화는 소스를 알 필요가 없습니다.

## 테스트

```bash
npm test    # node test/smoke.js — 파싱/멱등/집계/토스 JSON 로직 검증
```

## Roadmap (Phase 2+)

- 카드 이용내역 어댑터(삼성·롯데) + **내부이체 자동감지**(카드 결제대금 출금 → `transfer`로 합계 제외, 이중계상 방지).
- 카테고리 분류(발생주의 뷰), 할부 처리, 수기 입력.
- (옵션) **앱 내장 Gemini Vision 변환** — 사용자 API 키를 로컬 저장, 명시적 opt-in + 프라이버시 경고. 기본값은 항상 "외부 전송 없음".
- PWA/오프라인, 공유/동기화(예: 개인 Google Drive `drive.file`).
