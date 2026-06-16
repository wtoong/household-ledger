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
- **대시보드** — 선택한 달의 순현금흐름을 크게 강조 + 월별 수입/지출 막대 차트(차트 라이브러리 없이 SVG).
- **거래내역** — 기간·텍스트(적요)·수입/지출 필터, 최신순, 더보기.
- **잔액 검증(연속성 체크)** — 거래에 `거래후잔액`이 함께 들어오면 계좌별로 시간순 잔액 체인을 만들어 검증합니다. 아래 "잔액 검증" 참고.
- **데이터 관리** — JSON/CSV 내보내기(데이터 소유권), 전체 초기화.

## 잔액 검증 (연속성 체크 + 시간순 정렬)

은행/토스 내역에는 보통 **거래후잔액**이 같이 들어옵니다. 잔액은 계좌 단위 누적값이므로, **같은 계좌(`source`)** 끼리 시간 오름차순으로 줄을 세우면 다음이 성립해야 합니다.

```
직전 잔액 + 현재 금액 == 현재 잔액
```

- **맞물림(✓ ok)** — 두 거래 사이에 **누락된 거래가 없음이 확정**됩니다.
- **어긋남(⚠ gap)** — 그 차액만큼의 거래가 **누락된 것으로 추정**됩니다. 추정 누락액 `= (현재잔액 − 현재금액) − 직전잔액` (양수면 입금, 음수면 출금). **시각은 알 수 없으므로 "확인필요"** 로 표시합니다.
- **기준점(● start)** — 계좌에서 검증된 가장 이른 거래(직전이 없어 비교 대상 없음).
- **검증 불가(? no-balance)** — 잔액 정보가 없는 거래.

**같은 시각이 여러 건**이라 순서가 모호할 땐, 잔액 체인이 들어맞는 **순열을 찾아 순서를 확정**합니다(예: 같은 분에 결제 두 건이 찍혀도 잔액으로 선후가 정해짐). 시각이 서로 다르면 순서는 시각으로 이미 확정되므로 검증은 누락 탐지에만 쓰입니다.

거래내역 상단에 검증 요약 배너가 뜨고, 각 행의 잔액 옆에 상태 배지가 붙습니다. **`검증 문제만`** 체크박스로 누락 추정·검증 불가 행만 모아 볼 수 있습니다. (검증은 필터와 무관하게 항상 전체 거래 기준으로 계산합니다.)

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
  time?: string;         // 'HH:MM(:SS)' 24시간 (있으면 같은 날 정렬·잔액 검증 정확도↑)
  amount: number;        // 양수=수입, 음수=지출
  type: 'income' | 'expense' | 'transfer';
  description: string;   // 적요/가맹점
  source: string;        // 'mg-account' | 'toss' | ...
  dedupKey: string;      // 멱등 임포트용 키
  importedAt: string;
  balance?: number;      // 거래 후 잔액(있으면 dedup 정확도↑)
  category?: string;        // Phase 2+
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
  core/  store.js(멱등 저장/내보내기) · balance.js(잔액 검증/시간순) · aggregate.js(월별 집계)
  adapters/ registry.js · mg-account.js · toss-paste.js
  ui/    charts.js · dashboard.js · transactions.js · import.js · data.js
  app.js  # 부트스트랩(상태/탭/refresh/포맷)
test/smoke.js           # Node 스모크 테스트
prompts/toss-extract.txt
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
npm test    # node test/smoke.js — 파싱/멱등/집계/토스 JSON/잔액 검증 로직 검증
```

## Roadmap (Phase 2+)

- 카드 이용내역 어댑터(삼성·롯데) + **내부이체 자동감지**(카드 결제대금 출금 → `transfer`로 합계 제외, 이중계상 방지).
- 카테고리 분류(발생주의 뷰), 할부 처리, 수기 입력.
- (옵션) **앱 내장 Gemini Vision 변환** — 사용자 API 키를 로컬 저장, 명시적 opt-in + 프라이버시 경고. 기본값은 항상 "외부 전송 없음".
- PWA/오프라인, 공유/동기화(예: 개인 Google Drive `drive.file`).
