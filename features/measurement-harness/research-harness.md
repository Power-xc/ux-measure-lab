# Measurement Harness와 Source Adapter 계약 리서치

> **보존 상태:** 구현 전 설계 리서치다. 로드맵 항목이며 단계별 spec과 실행 검증을 통과해야 "현재 구현"으로 이동한다.
> **조사일:** 2026-07-14
> **결정 질문:** 사용자가 UX 질문을 입력하면 필요한 측정이 자동 구성되어 정규화된 `Evidence`로 Measure Loop에 공급되는 구조를, 8단계 루프와 결정적 계산 경계를 바꾸지 않고 어떻게 얹을 것인가.

## 0. 전제와 범위

이 문서는 두 가지를 설계한다.

- **Measurement harness** — 질문("가입 퍼널 어디서 새?")을 결정적 측정 조합으로 변환해 provenance가 붙은 `Evidence` 초안을 만드는 라우팅 계층.
- **Source Adapter 계약** — 모든 행동 데이터 소스가 동일한 정규화 `Evidence`로 응답하도록 강제하는 인터페이스. 자체 SDK/ingest가 1호 구현, PostHog가 2호(read-only) 구현이다.

범위 밖(불변):

- 8단계 Measure Loop(Context → KPI → Funnel → Diagnose → Hypothesis → Experiment → Validate → Decide)의 순서·의미.
- 결정적 계산 경계: 전환율·delta·guardrail·verdict는 계속 TypeScript가 계산한다. harness는 새 수치 엔진이 아니라 **입력 소스를 넓히는 계층**이다.
- Human-in-the-loop: 측정 결과는 사용자가 검토하고 명시적으로 적용해야 Project에 저장된다.
- 실험 사전 등록과 practical-threshold verdict가 결정의 system of record다. 전후 비교 같은 관찰형 측정은 실험을 대체하지 않는다.

harness는 기존 루프의 **Measure**와 **Diagnose** 사이에 소스를 꽂는 확장이며, 어떤 단계도 새로 만들거나 재정의하지 않는다.

## 1. 측정 스킬 카탈로그

측정 스킬은 "질문 유형 → 결정적 측정 레시피 → 요구 소스 capability" 대응을 고정한 표다. AI 도구가 아니라, 자연어 질문을 코드가 실행할 수 있는 측정으로 좁히는 도메인 매핑이다. 각 스킬은 산출 `Evidence`의 `sourceKind`(기존 enum 재사용)를 고정한다.

| 스킬 | 실사용 예시 질문 | 결정적 측정 레시피 | 요구 capability | 산출 `sourceKind` |
|---|---|---|---|---|
| 퍼널 이탈 | "가입 퍼널 어디서 사용자가 새는가?" | 인접 단계 전환·이탈·최대 이탈 구간 (`analyzeFunnel`) | `funnel` | `calculated` |
| 마찰 신호 | "연동 방식 선택 화면에서 사람들이 막히는가?" | 대상 영역의 rage/dead/error click 비율과 발생 표본 | `interaction` (+`sessions` 보강) | `measured` |
| 여정 연속성 | "가입한 사용자가 첫 핵심 행동까지 이어지는가?" | 시작→목표 이벤트 경로 도달률과 이탈 분기 | `paths` (+`funnel`) | `calculated` |
| 전후 비교 | "결제 버튼 문구를 바꾼 뒤 전환이 올랐는가?" | 두 기간의 동일 지표 delta(관찰용, verdict 아님) | `funnel` 또는 `events` (기간 2개) | `calculated` |
| KPI 추적 | "이번 주 활성 사용자 추세는?" | 이벤트 집계 시계열과 기간 대비 변화 | `events` | `measured` |
| 세그먼트 격차 | "신규와 재방문의 가입 이탈 차이는?" | 세그먼트별 퍼널 분해와 격차 | `funnel` + `segments` | `calculated` |
| 재현 맥락 | "이탈 구간에서 사용자가 실제로 뭘 하는가?" | 해당 구간 세션 표본 목록과 녹화 딥링크(수치화 없음) | `sessions` (+`recordings`) | `qualitative` |

원칙:

- **레시피는 수치를 만들지 않는다. 원자료를 정규화할 뿐이고 파생 수치는 기존 TS 엔진이 계산한다.** 퍼널 이탈은 `analyzeFunnel`, 전후 비교의 delta는 기존 delta 계산을 재사용한다.
- **전후 비교는 관찰형 증거만 만든다.** 채택 판정은 사전 등록 실험과 practical threshold가 담당한다. 이 구분을 지켜 8단계 루프를 침범하지 않는다.
- **재현 맥락은 절대 수치로 환산하지 않는다.** 녹화는 표본 목록과 딥링크만 제공하는 `qualitative` 근거다(A-003: 신호는 대안 설명이 있는 관찰이다).
- 카탈로그는 열려 있다. 새 스킬은 요구 capability와 산출 `sourceKind`, 예시 질문을 명시해야 등록된다.

## 2. Source Adapter 계약

### 2.1 설계 원칙

- **Capability 선언이 라우팅의 근거다.** 어댑터는 무엇을 할 수 있는지 선언하고, harness는 스킬의 요구 capability와 교집합이 있는 어댑터에만 질문을 보낸다.
- **정규화가 계약이다.** 어떤 소스든 반환값은 수치 + provenance + 표본 + 기간 + 순서형 신뢰 한계로 정규화된다. Measure Loop는 소스별 개념을 알지 못한다.
- **부분 실패는 결과다.** 일부 단계·신호만 확보되면 결과를 반환하되 결손을 명시한다. 전부 실패할 때만 오류다.
- **읽기 전용이 기본.** 커넥터는 `read_only`다. 자체 SDK/ingest만 자기 데이터에 `read_write`다.

### 2.2 인터페이스 초안

```typescript
// 어댑터가 선언하는 능력. 스킬은 이 집합으로만 라우팅된다.
export type SourceCapability =
  | "funnel"       // 순차 단계 전환·이탈
  | "events"       // 이벤트 집계·시계열 (KPI 추적)
  | "paths"        // 단계 간 여정·경로 연속성
  | "interaction"  // rage/dead/error click 등 마찰 신호
  | "segments"     // 세그먼트 분해 차원
  | "sessions"     // 세션 목록·맥락 metadata
  | "recordings";  // 세션 녹화 딥링크 (수치화 불가, 정성 참조)

export type SourceAdapterMeta = {
  adapterId: string;   // "first-party" | "posthog" 등 안정 식별자
  displayName: string;
  kind: "first_party" | "connector";
  access: "read_write" | "read_only";
  region?: "us" | "eu" | string;
  capabilities: SourceCapability[];
};

export type TimeWindow = { from: string; to: string };   // ISO, 폐구간
export type SegmentFilter = { dimension: string; value: string };

// 질문 유형별 쿼리 계약. capability로 구분되는 discriminated union이다.
export type MeasurementQuery =
  | { capability: "funnel"; steps: string[]; window: TimeWindow; segment?: SegmentFilter }
  | { capability: "events"; event: string; window: TimeWindow; interval: "day" | "week"; segment?: SegmentFilter }
  | { capability: "paths"; startEvent: string; endEvent: string; window: TimeWindow }
  | { capability: "interaction"; target?: string; signals: ("rage" | "dead" | "error")[]; window: TimeWindow }
  | { capability: "segments"; steps: string[]; dimension: string; window: TimeWindow }
  | { capability: "sessions"; filter: string; window: TimeWindow; limit: number }
  | { capability: "recordings"; sessionIds: string[] };

export type MeasurementProvenance = {
  adapterId: string;
  capability: SourceCapability;
  source: string;      // 기존 Evidence.provenance.source와 정렬되는 소스 라벨
  observedAt: string;  // 측정 실행 시각 (ISO). 주입된 now를 사용
  period: string;      // 사람이 읽는 관찰 기간 라벨
  window: TimeWindow;  // 기계 판독·캐시용 구간
  segment: string;     // 기존 provenance.segment와 정렬, 기본 "전체 사용자"
  queryHash: string;   // 캐시·재현 키
};

// 순서형 신뢰 등급. p-value·확률이 아니다 (A-004, E-005 준수).
export type ConfidenceBand = {
  level: "low" | "medium" | "high";
  sampleSize: number;  // 관찰 표본 수 (사용자/세션/이벤트)
  basis: string;       // 등급 근거: 표본·기간·소스 신뢰도
  limits: string;      // 이 수치로 말할 수 없는 것
};

// 정규화된 측정 결과. Project에 저장되기 전 단계다.
export type NormalizedMeasurement = {
  metricLabel: string;
  observation: string;               // 사람이 읽는 관찰 문장. 인과 표현 금지
  sourceKind: SourceKind;            // 기존 enum 재사용
  direction: EvidenceDirection;      // supports | contradicts | context
  values: Record<string, number>;   // 예: { totalConversion: 24.6, largestDropOffPp: 47.0 }
  provenance: MeasurementProvenance;
  confidence: ConfidenceBand;
};

export type AdapterErrorCode =
  | "unsupported_capability"
  | "not_configured"      // 키·권한 미설정
  | "unauthorized"
  | "rate_limited"
  | "upstream_error"
  | "invalid_response"
  | "insufficient_sample" // 표본·기간 부족 → 수치 미생성
  | "timeout";

// 부분 실패: 확보한 결과는 반환하고 결손을 함께 알린다.
export type DegradedNote = {
  capability: SourceCapability;
  reason: AdapterErrorCode;
  detail: string;         // 예: "paths는 상위 3개 경로만 확보"
};

export type MeasurementOutcome =
  | { ok: true; measurements: NormalizedMeasurement[]; degraded: DegradedNote[] }
  | { ok: false; code: AdapterErrorCode; message: string; retryAfterMs?: number };

export type AdapterContext = {
  signal?: AbortSignal;
  now: string;            // 주입된 시각. 결정성·테스트 가능성 확보
  cache: MeasurementCache;
};

export interface SourceAdapter {
  meta(): SourceAdapterMeta;
  supports(capability: SourceCapability): boolean;
  measure(query: MeasurementQuery, ctx: AdapterContext): Promise<MeasurementOutcome>;
}
```

계약의 불변식:

- `measure`는 `ctx.now`와 `ctx.cache`만으로 결정적이어야 한다. 어댑터 내부에서 시계를 읽지 않는다(기존 `now` 주입 패턴과 정렬).
- `values`는 **원자료 정규화 값**만 담는다. Measure Loop가 소유한 파생 계산을 어댑터가 대신하지 않는다.
- `insufficient_sample`은 오류가 아닌 정상 결과일 수 있다(부분 실패 `DegradedNote`). 표본·기간이 부족하면 수치를 지어내지 않는다.

### 2.3 1호 구현 — 자체 SDK / ingest 어댑터

```typescript
const firstPartyMeta: SourceAdapterMeta = {
  adapterId: "first-party",
  displayName: "UX MeasureLab SDK",
  kind: "first_party",
  access: "read_write",
  region: "self",
  // 자체 수집이므로 원자료를 직접 정규화한다. recordings는 사전 동의·마스킹·짧은 보존이 출시 조건.
  capabilities: ["funnel", "events", "paths", "interaction", "sessions"],
};
```

- 스크립트 한 줄로 수집한 pageview·click·rage/dead click·scroll·session을 자체 ingest가 세션화한 뒤, 계약 스키마로 정규화한다.
- `recordings`는 사전 동의·기본 마스킹·짧은 보존이 갖춰지기 전까지 capability에서 제외한다(Consent-first collection 원칙).
- `access: "read_write"`이지만 harness 경로는 읽기만 사용한다. 쓰기는 수집 파이프라인 전용이다.

### 2.4 2호 구현 — PostHog 어댑터 (read-only)

```typescript
const posthogMeta: SourceAdapterMeta = {
  adapterId: "posthog",
  displayName: "PostHog (read-only)",
  kind: "connector",
  access: "read_only",
  region: "eu", // 프로젝트별 us | eu, 리전 base URL 분리
  // autocapture가 rage/dead click을 포함하고 Query API로 funnel·paths·events를 조회할 수 있다.
  capabilities: ["funnel", "events", "paths", "interaction", "segments", "sessions", "recordings"],
};
```

- 두 구현이 동일한 `MeasurementOutcome`을 반환하므로 Measure Loop는 소스를 구분하지 않는다. 이것이 계약의 검증 지점이다.
- PostHog는 세션 녹화 목록·딥링크·임베드 API가 있어 `recordings`를 선언한다. 단 harness는 딥링크만 저장하고 매체·raw PII는 저장하지 않는다(4장·5장).

## 3. 스킬 라우팅 흐름

```text
사용자 질문
  → 유형 판정 (AI 보조 가능, 최종 선택은 사용자 확인)
    → 요구 capability 결정 (카탈로그가 고정)
      → 어댑터 capability 매칭 (교집합이 있는 어댑터만)
        → 측정 실행 (결정적, TS 엔진이 파생 수치 계산)
          → NormalizedMeasurement 생성 (provenance·표본·신뢰 한계 포함)
            → 사용자 검토·명시적 적용
              → 기존 Diagnose 단계 진입 (Evidence·friction·hypothesis 초안)
```

각 지점의 AI 개입 가능/불가:

| 라우팅 지점 | AI 개입 | 근거 |
|---|---|---|
| 질문 → 유형 후보 제안 | **가능(보조)** | 자연어를 카탈로그 유형 후보로 좁힌다. 최종 선택은 사용자 확인. |
| 유형 최종 확정 | **불가** | 잘못된 유형은 잘못된 측정을 부른다. 사용자가 확정한다. |
| 요구 capability 결정 | **불가** | 카탈로그가 고정한 결정적 매핑이다. |
| 어댑터 선택·매칭 | **불가** | capability 교집합으로 코드가 결정한다. |
| 측정 실행·수치 계산 | **불가** | 전환율·delta·경로 도달률은 전부 TS가 계산한다. |
| provenance·표본·기간·신뢰 한계 | **불가** | 측정 실행이 사실로 채운다. 생성·추정 금지. |
| 관찰 문장 다듬기 | **가능(보조)** | 값을 바꾸지 않는 표현만. 인과 표현은 검증에서 폐기. |
| 원인 후보·가설 대안 | **가능(보조)** | 기존 Diagnose 경계와 동일. 기존 evidence ID만 참조. |
| `Evidence` 저장 | **불가** | 사용자가 명시 적용해야 저장된다. |

AI가 만드는 것은 **후보와 표현**뿐이고, 수치·provenance·저장은 전부 코드와 사람의 몫이다. 이는 기존 "Deterministic and AI boundary" 표를 harness 앞단으로 그대로 연장한 것이다.

## 4. 기존 모델과의 접합

### 4.1 최소 확장 (전부 가산·선택)

기존 `Evidence`·`Project`를 재정의하지 않는다. 선택 필드 하나만 더한다.

```typescript
// 측정 출처 참조. 없으면 CSV·sample 기반의 기존 Evidence와 동일하게 동작한다.
export type EvidenceSourceRef = {
  adapterId: string;
  capability: SourceCapability;
  queryHash: string;
  sampleSize: number;
  confidence: "low" | "medium" | "high";
};

export type Evidence = {
  // ...기존 필드 전부 동일 (id, sourceKind, direction, observation, detail, provenance)...
  sourceRef?: EvidenceSourceRef; // 신규·선택. harness 측정에서만 채워진다.
};
```

- `SourceKind` enum은 확장하지 않는다. `measured`·`calculated`·`qualitative`가 스킬 산출을 이미 덮는다.
- `provenance`의 `source`·`observedAt`·`period`·`segment`는 `MeasurementProvenance`가 그대로 채운다. 계약을 기존 provenance 필드에 정렬해 둔 이유다.
- `FunnelImport.source`는 `"csv" | "sample"`에 `"adapter"`를 가산한다(선택적 확장). 기존 두 값의 의미는 불변.

### 4.2 하위 호환과 마이그레이션

현재 규칙: 알 수 없는 미래 version은 자동 migration하지 않고 거부하며, schema 변경 시 이전 backup을 보존하는 명시적 migration을 먼저 설계한다.

```text
schema v1 → v2
- sourceRef, FunnelImport.source="adapter"는 전부 optional 가산 필드다.
- v1 데이터는 필드 부재로 그대로 유효하다 (읽기 시 undefined).
- migrateV1toV2: 값 변형 없이 schemaVersion만 1 → 2로 올린다.
- 마이그레이션 전 현재 workspace JSON을 자동 백업한다 (기존 restore 규칙 재사용).
- v2 → v1 하위 실행 시 v2 저장은 거부한다 (미래 version 거부 규칙 유지).
```

새 invariant(추가):

- `sourceRef`가 있으면 `sampleSize > 0`이고 `confidence`가 `ConfidenceBand.level`과 일치해야 한다.
- `sourceRef.capability`는 해당 `adapterId`가 선언한 capabilities에 포함돼야 한다.
- `sourceRef`가 있는 `Evidence`도 기존 evidence-ID 참조 invariant(friction·hypothesis가 같은 project의 ID만 참조)를 동일하게 따른다.

기존 로컬 데이터는 마이그레이션 없이도 읽히고, 마이그레이션은 값을 건드리지 않으므로 데이터 손실 경로가 없다.

## 5. PostHog 어댑터 상세 매핑

### 5.1 capability → 엔드포인트

| 계약 capability | PostHog 구현 | 비고 |
|---|---|---|
| `funnel` | Query API + HogQL의 funnel 질의 | 인접 단계 사용자 수만 정규화, 전환·이탈은 `analyzeFunnel`이 계산 |
| `events` | Query API + HogQL 집계·시계열 | KPI 추적. interval별 카운트만 반환 |
| `paths` | Query API의 path 질의 | 상위 경로만 확보되면 `DegradedNote`로 결손 명시 |
| `interaction` | autocapture rage/dead click 이벤트를 HogQL로 조회 | autocapture가 두 신호를 포함. 대상 영역 필터로 좁힘 |
| `segments` | HogQL group-by / breakdown | 세그먼트별 퍼널 분해 |
| `sessions` | 세션 목록 조회 API | 메타데이터만. 표본 목록 확보용 |
| `recordings` | 세션 녹화 목록 + 딥링크(임베드 API 존재) | 딥링크만 저장, 매체·raw PII 미저장 |

- 인증: personal API key. scope는 최소화(`query:read`, 녹화 사용 시 세션 녹화 read scope만) 한다. 키는 서버 경계에서만 읽고 브라우저·AI 요청에 포함하지 않는다(기존 URL·AI route 원칙 재사용).
- 리전: 프로젝트별 US/EU가 분리되므로 `region`으로 base URL을 고른다.
- 무료 한도(1M 이벤트, 5K 녹화/월)를 소진하지 않도록 녹화는 목록·딥링크만 당기고, 월 사용량을 예산 가드로 추적한다.
- 정확한 엔드포인트 경로·query 계약은 구현 시 공식 스키마로 endpoint별 재확인한다(기존 리서치 규율 유지).

### 5.2 rate limit 하 캐싱 전략

관측된 한도: 분석 엔드포인트 240/min·1200/hr, query 엔드포인트 2400/hr.

```text
캐시 키   = hash(region, projectId, capability, 정규화 query(window·segment 포함))
          = MeasurementProvenance.queryHash 와 동일
저장 위치 = 기존 local-first 저장 경계. 정규화 결과·provenance만 저장, 업스트림 raw row 미보관
TTL 정책  = 닫힌 과거 구간(window.to < 오늘): 사실상 불변 → 장기 TTL
            오늘을 포함하는 구간: 단기 TTL(예: 15~60분)
동시성    = 동일 queryHash in-flight 요청은 합치기(coalesce)
한도 준수 = 로컬 token-bucket으로 240/min·2400/hr(query) 선제어
            429 응답의 retry-after를 MeasurementOutcome.retryAfterMs로 전달하고 backoff
호출 절감 = 한 질문의 여러 capability를 가능하면 단일 HogQL로 묶어 query 호출 수를 줄임
녹화 예산 = 월 녹화 pull 카운트를 추적, 한도 근접 시 "목록만"으로 degrade
```

- 캐시가 provenance의 `queryHash`와 같은 키를 쓰므로, 같은 질문·기간·세그먼트는 재측정 없이 동일 `Evidence`를 재현한다(결정성·재현성).
- 닫힌 과거 구간은 값이 바뀌지 않아 대부분의 반복 질문이 캐시로 해결되고, query 2400/hr는 신규 구간에만 소비된다.
- rate limit·정족 미달은 오류가 아니라 `rate_limited`·`insufficient_sample` 결과로 사용자에게 표시하고, 부분 확보분은 `DegradedNote`로 함께 보여준다.

## 6. 열린 질문과 다음 검증

- **동의 게이팅(자체 SDK):** `recordings`·마찰 신호 수집의 사전 동의·마스킹·보존 기간을 출시 조건으로 별도 spec에서 확정한다.
- **신뢰 한계 의미론:** `ConfidenceBand`는 순서형이며 표본·기간을 근거로만 매긴다. 확률·통계적 유의성으로 확장하지 않는다(A-002·A-004).
- **후속 커넥터:** GA4는 Data API가 집계 전용이고 퍼널이 v1alpha, 원본 이벤트는 BigQuery export가 필요하므로 `events` 중심의 제약된 어댑터로 검토한다. Clarity는 export 한도(1일 10회·최근 1~3일·1,000행, 녹화·히트맵 API 접근 불가)로 지속 소스에 부적합하며 참고용으로만 남긴다.
- **검증 시나리오:** 동일 질문을 1호(자체 SDK)와 2호(PostHog)로 각각 측정해 `MeasurementOutcome` 스키마·provenance·신뢰 한계가 소스와 무관하게 정규화되는지 확인하는 계약 테스트를 첫 실행 검증으로 둔다.
