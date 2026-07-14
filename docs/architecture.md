# Architecture

> **상태:** Personal Product · Measurement Harness 구현 기준 · 2026-07-15

## System role

UX MeasureLab은 행동 데이터를 수집하는 증거 계층과 제품 결정을 보존하는 무결성 계층을 분리한 evidence-to-decision workspace다.

```text
질문
  → 측정 스킬 선택
    → capability가 맞는 Source Adapter
      → 결정적 집계와 정규화
        → 사용자 검토·Evidence 적용
          → Diagnose → Hypothesis → Experiment → Validate → Decision
```

Measurement Harness는 기존 8단계 Measure Loop의 새 단계가 아니다. Diagnosis 안에서 행동 데이터 근거를 추가하는 입력 경로다. 전환율·이탈률·도달률·실험 delta·verdict는 TypeScript가 계산하며, 측정 응답만으로 Project를 변경하지 않는다.

## Two data layers

| 계층 | 데이터 | 저장 | 신뢰 특성 |
|---|---|---|---|
| 무결성 계층 | Project, KPI, Evidence, 가설, 실험, verdict, 사람의 Decision | browser `localStorage` schema v2 + JSON backup | schema·invariant·재계산으로 보호 |
| 증거 계층 | pageview, click, rage/dead, scroll, route, session event와 집계 | 선택적 Supabase `events`·`sessions`; 기본 90일 정책 | 손실 허용, 표본·기간·한계 명시 |

무결성 데이터는 `/api/ingest`를 통과하지 않는다. 행동 스트림은 과부하·브라우저 종료·한도 초과에서 일부 손실될 수 있으므로 Decision의 system of record로 사용하지 않는다.

## Runtime boundaries

```text
측정 대상 제품의 Browser
└─ packages/collector
   └─ POST /api/ingest                       cross-origin write boundary
      ├─ SiteStore
      ├─ EventStore
      └─ DurableRateLimiter
         ├─ Supabase REST + Upstash REST     env가 완전할 때
         └─ InMemory safe defaults           env가 없을 때

Workspace Browser
├─ React UI + WorkspaceState
├─ localStorage schema v2 + JSON backup
└─ POST /api/harness/measure                 same-origin read boundary
   └─ AdapterRegistry
      ├─ first-party → AggregateReader
      │  ├─ Supabase aggregate RPC           Supabase env + site ID가 있을 때
      │  └─ empty InMemory reader             그렇지 않을 때
      └─ PostHog read-only adapter            server env가 있을 때
```

수집은 다른 제품 도메인에서 들어오는 것이 정상이라 same-origin guard를 사용하지 않는다. 사이트 키 해시, 사이트별 Origin allowlist, 사이트·IP별 rate limit과 반사 CORS가 경계를 만든다. 반대로 harness와 기존 workspace API는 제품 UI만 호출하므로 `Origin`과 `Sec-Fetch-Site`를 확인하는 same-origin 경계를 사용한다.

## Collector and ingest

Collector는 `pv | click | rage | dead | scroll | route | s_start | s_end`만 전송한다. envelope는 `{ k, sent_at, sid, aid, events[] }`이며 이벤트 시각은 epoch milliseconds다.

- `requireConsent: true`, GPC/DNT 존중이 기본이다.
- 동의 전에는 이벤트를 큐잉하거나 전송하지 않는다.
- input, textarea, select, password, contenteditable과 결제 관련 필드는 설정과 무관하게 수집하지 않는다.
- query string은 기본 제외하고 식별자로 보이는 path segment를 마스킹한다.
- 20개 또는 5초마다 배치하고, 종료 시 `sendBeacon`을 사용한다.
- ingest는 최대 50개 이벤트를 받아 개별 무효 이벤트만 드롭하고 `202`로 accepted/dropped를 반환한다.

Supabase가 설정되면 site lookup과 event batch insert를 REST로 수행한다. Upstash가 설정되면 REST pipeline의 `INCR`·`PEXPIRE`·`PTTL`로 공유 제한을 적용한다. Upstash 장애 시 무제한 허용하지 않고 프로세스별 in-memory 제한으로 강등한다.

## Measurement Harness

카탈로그에는 7개 스킬이 있으며 현재 실행 가능한 것은 `funnel`, `interaction`, `paths` 3종이다. 사용자가 질문 유형과 파라미터를 확정하고, UI는 해당 capability를 선언한 어댑터만 제시한다.

`SourceAdapter`의 공통 계약은 다음을 강제한다.

- capability 선언과 read-only/read-write metadata
- discriminated `MeasurementQuery`
- `MeasurementOutcome`과 strict runtime validation
- provenance: adapter, capability, 기간, segment, `queryHash`
- 표본 수 기반 순서형 `ConfidenceBand`
- 표본 미달 또는 0초 관찰 구간의 `insufficient_sample`에서 수치 미생성

First-party 어댑터는 `AggregateReader`에서 raw count를 읽고 기존 퍼널 엔진과 결정적 계산을 재사용한다. Interaction 표본은 hash된 익명 사용자, PostHog는 person 단위로 집계한다. 현재 자체 수집은 세그먼트 퍼널과 `error` interaction 신호를 지원하지 않으며 명시적 `unsupported_capability`로 닫는다. PostHog 어댑터는 서버에서만 personal API key를 읽고 Query API의 raw count를 동일 계약으로 정규화한다. cache는 adapter ID로 namespace한 `queryHash`를 사용하며, 종료된 과거 기간만 세션 간 재사용해 현재일 지연 유입을 고정하지 않는다.

## Source layout

```text
src/app/api/ingest/                     cross-origin event ingest
src/app/api/harness/measure/            same-origin measurement dispatch
src/features/ingest/server/             validation and storage interfaces
src/features/ingest/server/backends/    Supabase·Upstash REST implementations
src/features/harness/                   catalog, contract, adapters, measurement service
src/features/project-workflow/          transitions, invalidation, local controller
src/widgets/measure-workspace/          eight-step workspace UI
packages/collector/                     first-party browser collector
supabase/migrations/                    ingest schema and aggregate RPCs
supabase/jobs.sql                       partition retention, session rollup, visitor deletion
```

UI 의존 방향은 `app → widgets → features → entities/shared`다. 계산 함수와 runtime validator는 React, storage backend와 외부 provider를 알지 않는다.

## State and invalidation

`WorkspaceState`가 무결성 계층의 source of truth다. `useWorkspace`는 compare-before-write, 전체 schema/invariant 검증, `localStorage` commit 순서로 상태를 바꾼다. 저장 key 이름은 호환성을 위해 `ux-measure-lab.workspace.v1`을 유지하지만 현재 payload schema는 v2다.

상위 입력이 바뀌면 의미가 무효화된 하위 결과를 제거한다. Harness 결과도 사용자가 **Evidence로 적용**한 시점에만 이 업데이트 경로를 사용하며, 새 근거가 기존 진단을 바꾸면 friction부터 Decision까지 다시 검토하게 한다.

## API boundaries

| Route | 호출 경계 | 주요 방어 | 기본 실패 동작 |
|---|---|---|---|
| `/api/ingest` | cross-origin | 사이트 키 해시, Origin allowlist, bounded body, event validator, dual rate limit | env 없음: 빈 site store로 `401` |
| `/api/harness/measure` | same-origin | Origin·Fetch Metadata, bounded body, strict query/outcome parser, adapter capability | 집계 env 없음: `insufficient_sample` |
| `/api/product-context` | same-origin | SSRF 방어, redirect·DNS·byte·time limit | 수동 입력 유지 |
| `/api/ai/diagnosis` | same-origin | strict request/output, bounded rate, explicit local opt-in | 결정적 초안 |

Server secret은 env에서만 읽으며 client module로 전달하지 않는다. 외부 응답은 server에서 받았더라도 신뢰하지 않고 정규화 경계에서 다시 검증한다.

## Persistence backends and status

`readServerEnv`가 완전한 설정 묶음만 활성화한다.

- Supabase: site/event REST backend. `SUPABASE_SITE_ID`가 추가되면 aggregate RPC reader도 활성화한다.
- Upstash: ingest의 durable rate-limit backend.
- PostHog: read-only measurement adapter.
- 미설정: 기존 InMemory 구현을 사용한다. 수집은 허용된 site가 없어 닫히고, 측정은 빈 표본으로 끝난다.

`0001_ingest.sql`, `0002_aggregates.sql`, `jobs.sql`과 site provision script는 저장소에 있다. 실제 Supabase project 적용, cron 활성화와 dogfood site 연결은 운영자가 수행해야 하며 저장소만으로 완료된 상태가 아니다.

## Deployment shape

```text
Web/runtime : Next.js 16 App Router + React 19 + TypeScript
Workspace   : localStorage schema v2 + JSON backup
Collection  : dependency-free browser collector + Node ingest route
Optional DB : Supabase Postgres via REST/RPC
Optional quota: Upstash Redis via REST
Connector   : PostHog Query API, read-only
```

현재 프로덕션 데모와 자동 배포는 동결되어 있다. 인증·RLS·조직·cloud sync는 구현하지 않았으므로 현재 구조를 public multi-tenant 제품으로 운영하지 않는다.
