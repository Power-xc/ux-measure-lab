# Data Model

> **상태:** Personal Product runtime model · localStorage schema version 2 · 2026-07-15

이 문서는 브라우저 무결성 모델과 선택적 서버 증거 모델을 함께 설명한다. 두 모델은 수명과 신뢰 수준이 다르며 서로의 저장소를 공유하지 않는다.

## Integrity aggregate

```text
WorkspaceState
├─ schemaVersion: 2
├─ activeProjectId
└─ projects[]
   └─ Project
      ├─ context: ProjectContext
      ├─ metric: MetricDefinition | null
      ├─ funnelImport: FunnelImport | null
      ├─ evidence[]: Evidence
      │  └─ sourceRef?: EvidenceSourceRef
      ├─ frictionCandidate: FrictionCandidate | null
      ├─ hypothesis: Hypothesis | null
      ├─ experiment: ExperimentPlan | null
      ├─ experimentResult: ExperimentResult | null
      └─ decision: Decision | null
```

한 Project는 8단계 workflow의 현재 snapshot 하나를 가진다. 실험 history와 append-only audit log는 아직 없다.

## Main records

| Record | 책임 |
|---|---|
| `WorkspaceState` | active project와 독립된 개인 프로젝트 목록 |
| `ProjectContext` | 제품명, URL, 단계, 대상, 핵심 행동과 목표 |
| `MetricDefinition` | KPI 정의, formula, 기간, source kind와 확정 상태 |
| `FunnelImport` | CSV, sample 또는 adapter에서 온 정규화 퍼널 |
| `Evidence` | 관찰, 세부 값, 방향, provenance와 선택적 source reference |
| `FrictionCandidate` | 현상, 연결 근거, 가능한 원인과 추가 검증 |
| `Hypothesis` | 변경안, 예상 행동, metric, guardrail과 대안 설명 |
| `ExperimentPlan` | threshold, 표본, 기간, guardrail과 stop rule |
| `ExperimentResult` | 입력 snapshot과 재계산 가능한 evaluation |
| `Decision` | result verdict snapshot, 사람의 결정과 근거·다음 행동 |

## Enumerations

```text
ProductStage
idea | alpha | beta | live | growth

SourceKind
measured | calculated | benchmark | assumed | inferred | qualitative

SourceCapability
funnel | events | paths | interaction | segments | sessions | recordings

ConfidenceLevel
low | medium | high

ExperimentVerdict
support | partial_support | not_supported | insufficient_evidence

HumanDecision
adopt | iterate | stop | collect_more_data
```

ConfidenceLevel은 표본 크기에 따른 순서형 품질 표시다. 통계적 유의성이나 확률을 뜻하지 않는다.

## Evidence and source reference

모든 Evidence는 사람이 읽는 provenance를 가진다.

```text
source      source label
observedAt  ISO timestamp
period      measurement window label
segment     measured segment
```

Harness에서 적용한 Evidence에는 다음 참조가 추가된다.

```text
sourceRef
├─ adapterId
├─ capability
├─ queryHash
├─ sampleSize
└─ confidence
```

`sourceRef`는 optional이라 기존 CSV·sample Evidence를 그대로 읽는다. 값이 있으면 `sampleSize > 0`이어야 하고 capability와 confidence는 공통 enum에 속해야 한다. 측정 결과는 사용자가 적용하기 전까지 `NormalizedMeasurement`일 뿐 Project record가 아니다.

## Measurement contract

`MeasurementQuery`는 capability로 구분되는 union이다.

| capability | 필수 입력 | 현재 실행 경로 |
|---|---|---|
| `funnel` | steps, window, 선택적 segment | first-party(segment 제외), PostHog |
| `interaction` | signals, window, 선택적 target | first-party(rage/dead), PostHog(rage/dead/error) |
| `paths` | startEvent, endEvent, window | first-party, PostHog |
| `events` | event, interval, window, 선택적 segment | PostHog adapter 계약 |
| `segments` | steps, dimension, window | 카탈로그 후속 |
| `sessions` | filter, window, limit | 카탈로그 후속 |
| `recordings` | sessionIds | Session Replay 출시 전 비활성 |

성공한 `NormalizedMeasurement`는 metric label, 인과를 단정하지 않는 observation, source kind, direction, numeric values, provenance와 `ConfidenceBand`를 가진다. 오류 outcome은 수치를 포함하지 않는다. 표본 미달이나 0초 관찰 구간의 `insufficient_sample`도 같은 원칙을 따른다.

`queryHash`는 정규화 query를 안정된 키 순서로 직렬화한 뒤 SHA-256으로 만든다. 같은 capability·기간·segment·파라미터는 같은 hash를 만든다. cache 저장 키에는 adapter ID를 함께 사용해 서로 다른 소스의 동일 query가 섞이지 않게 한다.

## Lifecycle and invariants

```text
ExperimentPlan.status
draft → ready → completed → decided
```

- confirmed KPI 없이 funnel을 저장할 수 없다.
- friction과 hypothesis가 참조하는 evidence ID는 같은 project에 존재해야 한다.
- harness Evidence의 source reference는 실제 양의 표본을 가져야 한다.
- experiment는 현재 hypothesis와 metric을 참조하고 사전 등록 검증을 통과해야 한다.
- result evaluation은 저장된 input을 TypeScript로 다시 계산한 값과 일치해야 한다.
- Decision verdict는 현재 result verdict와 같고 evidence ID는 현재 Evidence의 부분집합이어야 한다.
- 상위 단계 없이 하위 단계만 존재하는 state는 JSON import에서 거부한다.

상위 입력 또는 적용 Evidence가 바뀌면 더 이상 유효하지 않은 downstream snapshot을 제거한다. Harness 응답 수신은 lifecycle event가 아니며 명시적 Evidence 적용만 Project를 갱신한다.

## Experiment evaluation

입력은 baseline·variant의 `converted/total`, 사전 등록 threshold, 최소 표본, 계획·관찰 기간과 선택적 guardrail count다. 계산 결과는 다음 값만 저장한다.

```text
baselineRate
variantRate
absoluteDeltaPp
relativeDeltaPercent | null
guardrailDeltaPp | null
guardrailOutcome
verdict
```

표본이나 기간이 부족하면 `insufficient_evidence`다. p-value와 통계적 유의성은 계산하거나 저장하지 않는다.

## Browser persistence

- storage key: `ux-measure-lab.workspace.v1` (호환성을 위해 이름 유지)
- payload schema version: `2`
- migration: v1 원본을 `ux-measure-lab.workspace.backup`에 먼저 보존한 뒤 값 변형 없이 v2로 승격
- backup: 전체 `WorkspaceState` JSON
- import: JSON parse → version → record schema → cross-record invariant
- write: compare-before-write → schema validation → localStorage commit → React state update

미래 version은 자동 변환하지 않고 거부한다. v1의 `sourceRef` 부재는 정상이며 손실 없이 v2로 읽힌다.

## Evidence storage model

선택적 Supabase 모델은 행동 증거만 저장한다.

```text
sites
├─ id, project_ref, name
├─ key_hash, key_prefix
├─ allowed_origins[]
├─ retention_days
├─ is_bot_dropped
└─ disabled_at

events (received_at 주 단위 partition)
├─ site_id, event_id
├─ session_id, anon_id(hash)
├─ type, path, referrer_host, props
├─ ua_family, is_bot
└─ ts, client_ts, received_at

sessions
├─ site_id, server_session_id, anon_id
├─ started_at, ended_at, duration_ms
├─ event_count, pageview_count
├─ entry_path, exit_path
└─ is_bounce, is_bot
```

Raw site key, full referrer URL, raw user agent, input value, Project, experiment와 Decision은 이 모델에 저장하지 않는다. 사이트 키는 SHA-256 hash로 찾고 `anon_id`도 ingest에서 hash한 값만 저장한다.

## Aggregate read model

`0002_aggregates.sql`은 service-role 전용 RPC 3개를 정의한다.

- `funnel_counts`: 요청 단계별 도달 사용자 수
- `interaction_counts`: 신호별 건수와 익명 사용자 표본 수
- `path_reach`: 시작 사용자와 이후 목표 도달 사용자 수

`SupabaseAggregateReader`는 해당 RPC의 raw count를 읽는다. 전환율과 이탈률은 database가 아니라 measurement service가 계산한다. Supabase env 또는 `SUPABASE_SITE_ID`가 없으면 empty InMemory reader가 선택된다.

## Retention and deletion

`sites.retention_days` 기본값과 partition retention 기준은 90일이다. `jobs.sql`에는 주 partition 생성·만료, 30분 gap session rollup과 hash 기반 `delete_visitor` 함수가 있다.

이 SQL은 저장소에 있는 운영 자산이며 자동 적용되지 않는다. cron 등록은 주석 상태이고, 24시간 session 강제 분할과 사이트별 90일 미만 override delete는 아직 구현되지 않았다. 실제 보존 보장은 migration 적용과 cron 활성화·모니터링 이후에만 성립한다.

## Deferred model

현재 `User`, membership, organization, RLS, cloud sync와 replay payload 모델은 없다. 인증 없는 개인 단일 사용 범위다. 다중 사용자 읽기, Session Replay 또는 audit history를 추가할 때 actor, tenant authorization, encryption, retention, deletion과 migration을 별도 설계해야 한다.
