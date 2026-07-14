# Data Model

> **상태:** Personal Product v1 runtime model · localStorage schema version 1

이 문서는 현재 TypeScript 모델과 JSON backup 계약을 설명한다. database schema나 multi-tenant authorization 모델이 아니다.

## Aggregate map

```text
WorkspaceState
├─ schemaVersion: 1
├─ activeProjectId
└─ projects[]
   └─ Project
      ├─ context: ProjectContext
      ├─ metric: MetricDefinition | null
      ├─ funnelImport: FunnelImport | null
      │  └─ steps[]: FunnelStep
      ├─ evidence[]: Evidence
      ├─ frictionCandidate: FrictionCandidate | null
      ├─ hypothesis: Hypothesis | null
      ├─ experiment: ExperimentPlan | null
      ├─ experimentResult: ExperimentResult | null
      └─ decision: Decision | null
```

한 Project는 각 workflow 단계의 현재 snapshot 하나를 가진다. 실험 history나 append-only audit log는 아직 없다.

## Main records

| Record | 책임 |
|---|---|
| `WorkspaceState` | active project와 독립된 여러 개인 프로젝트 |
| `ProjectContext` | 제품명, 선택적 공개 URL, 단계, 대상, 핵심 행동, 목표 |
| `MetricDefinition` | KPI 이름, 정의, formula 설명, 기간, source kind, 확정 상태 |
| `FunnelImport` | 파일명, CSV/sample 출처, import 시점, 정규화된 단계 |
| `Evidence` | 관찰, 세부 값, 방향, source kind와 provenance |
| `FrictionCandidate` | 현상, 연결 근거, 가능한 원인, 강도 근거, 추가 확인과 검증 방법 |
| `Hypothesis` | 관찰, 변경안, 예상 행동, KPI, guardrail, 대안 설명과 누락 근거 |
| `ExperimentPlan` | success/failure threshold, 표본, 기간, guardrail과 stop rule |
| `ExperimentResult` | 입력 snapshot과 코드가 재계산 가능한 evaluation |
| `Decision` | result verdict snapshot, system recommendation, 사람 결정과 근거·다음 행동 |

## Enumerations

```text
ProductStage
idea | alpha | beta | live | growth

SourceKind
measured | calculated | benchmark | assumed | inferred | qualitative

EvidenceDirection
supports | contradicts | context

ExperimentVerdict
support | partial_support | not_supported | insufficient_evidence

HumanDecision
adopt | iterate | stop | collect_more_data
```

## Lifecycle

```text
ExperimentPlan.status
draft → ready → completed → decided
```

- hypothesis가 `ready`이고 모든 사전 등록 필드가 유효해야 experiment가 `ready`가 된다.
- 결과를 저장하면 experiment는 `completed`가 된다.
- 사람의 결정을 저장하면 experiment는 `decided`가 된다.
- 앞 단계의 의미 있는 변경은 더 이상 유효하지 않은 downstream snapshot을 제거한다.

`running`과 `cancelled` 상태, 실험 배정, 트래픽 제어는 현재 모델에 없다.

## Domain invariants

- `activeProjectId`는 존재하는 project ID이거나, project가 없을 때 `null`이다.
- project ID는 workspace 안에서 유일하며 수정할 수 없다.
- context의 제품 URL은 비어 있거나 유효한 HTTP(S) URL이어야 한다.
- KPI는 필수 정의·formula·window·source kind 없이 `confirmed`가 될 수 없다.
- funnel은 2~100개의 고유 단계이고 첫 사용자 수는 0보다 크며 뒤 단계가 증가할 수 없다.
- friction과 hypothesis가 참조하는 evidence ID는 같은 project에 존재해야 한다.
- hypothesis의 primary metric은 project의 확정 KPI를 참조해야 한다.
- experiment는 현재 hypothesis와 metric ID를 참조하고 threshold·표본·기간·guardrail·stop rule 검증을 통과해야 한다.
- result의 evaluation은 저장된 input으로 TypeScript가 다시 계산한 값과 정확히 일치해야 한다.
- Decision verdict는 현재 result verdict와 같고 evidence ID는 현재 evidence의 부분집합이어야 한다.
- 상위 단계 없이 하위 단계만 존재하는 impossible state는 JSON import에서 거부한다.

## Evidence provenance

각 Evidence는 다음 provenance를 가진다.

```text
source      CSV file name or source label
observedAt  ISO timestamp
period      measurement window
segment     measured segment
```

최대 이탈 evidence는 `sourceKind: calculated`로 저장한다. 가능한 원인과 AI 제안은 새 측정 evidence를 만들지 않고 기존 ID만 참조한다.

## Experiment evaluation

입력은 baseline·variant의 `converted/total`, 사전 등록 threshold, 최소 표본, 계획·관찰 기간과 선택적 guardrail count를 가진다. 계산 결과는 다음 값만 저장한다.

```text
baselineRate
variantRate
absoluteDeltaPp
relativeDeltaPercent | null
guardrailDeltaPp | null
guardrailOutcome
verdict
```

rate와 delta는 소수 첫째 자리로 반올림한다. baseline 또는 variant 표본이 부족하거나 관찰 기간이 짧으면 `insufficient_evidence`다. 이 모델은 p-value나 통계적 유의성을 계산하지 않는다.

## Persistence contract

- storage key: `ux-measure-lab.workspace.v1`
- schema version: `1`
- backup: 전체 `WorkspaceState` JSON
- import: JSON parse → version 확인 → record validation → cross-record invariant 확인 → save
- write: compare-before-write → schema validation → localStorage commit → React state update

알 수 없는 미래 version은 자동 migration하지 않고 거부한다. schema 변경 시 이전 backup을 보존하는 명시적 migration을 먼저 설계해야 한다.

## Deferred server model

현재 모델에는 `User`, `WorkspaceMember`, organization, permission, RLS가 없다. 로그인·팀 협업·cloud sync를 추가할 때는 actor, tenant boundary, retention, deletion, audit와 migration을 별도 설계한다.
