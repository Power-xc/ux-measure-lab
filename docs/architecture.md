# Architecture

> **상태:** Personal Product v1 구현 기준 · 2026-07-14

## System role

UX MeasureLab은 raw analytics 수집기가 아니라 제품 맥락과 분석 export를 실험 결정으로 연결하는 evidence-to-decision layer다.

```text
Product context + Funnel CSV
  → runtime validation
    → deterministic metrics
      → Evidence + friction candidate
        → editable hypothesis
          → preregistered experiment
            → deterministic verdict
              → human Decision + report
```

AI는 `Diagnose → Hypothesis` 구간의 선택적 advisory다. AI가 없어도 같은 workflow를 끝까지 완료할 수 있다.

## Runtime boundary

```text
Browser
├─ Next.js/React workspace UI
├─ Project aggregate in memory
├─ localStorage repository (schema v1)
├─ JSON backup/restore
├─ CSV·backup JSON input validation
└─ deterministic CSV, funnel and experiment engines

Same-origin Node routes
├─ POST /api/product-context
│  └─ safe public HTML fetch + inert text extraction
└─ POST /api/ai/diagnosis
   └─ validated provider request or deterministic fallback

External
├─ public product page
└─ OpenAI Responses API (explicit opt-in only)
```

서버 DB, 인증, background worker와 자체 event collector는 없다. 브라우저 프로젝트 데이터는 AI route나 URL route로 자동 전송되지 않는다.

## Source layout

```text
src/app/                              routes, metadata, global security-facing config
src/widgets/measure-workspace/        workspace shell and eight workflow panels
src/features/project-workflow/        transitions, progress and local controller
src/features/funnel-import/            CSV parser and validation
src/features/measure-loop/             deterministic funnel calculations
src/features/diagnosis/                deterministic evidence/friction draft
src/features/experiment/               deterministic result evaluator
src/features/product-context/          URL contract, SSRF policy, fetch and extraction
src/features/ai-diagnosis/             AI contract, provider adapter and fallback
src/features/report/                   Markdown report builder
src/entities/                          Project, experiment, decision types
src/shared/lib/                        schema, invariants, repository, input policy
design-system/                         generated token artifacts
```

UI의 의존 방향은 `app → widgets → features → entities/shared`다. 파서와 계산 함수는 React·Next.js·provider를 알지 않는다.

## State and persistence

`WorkspaceState`가 source of truth이며 여러 `Project` aggregate를 가진다. `useWorkspace`가 다음 순서로 변경을 commit한다.

1. 현재 `localStorage` raw 값과 마지막으로 읽은 값을 비교한다.
2. 차이가 있으면 multi-tab conflict로 변경을 거부한다.
3. transition을 적용하고 전체 schema와 invariant를 검증한다.
4. 검증된 다음 상태를 `localStorage`에 저장한다.
5. 성공하면 persisted raw 기준과 in-memory state를 함께 갱신한다.

저장 key는 `ux-measure-lab.workspace.v1`이다. 읽기·쓰기·quota·충돌 오류는 UI에 표시되며, 손상된 raw JSON은 사용자가 내려받은 뒤 빈 workspace로 복구할 수 있다. JSON restore는 현재 workspace를 자동 다운로드한 뒤 전체 상태를 교체한다.

`storage_write_failed`에서는 검증된 다음 상태를 React state와 retry용 in-memory ref에 유지하지만 persisted raw 기준은 갱신하지 않는다. 따라서 사용자는 변경 내용을 화면과 JSON backup에서 보존한 채 **다시 저장**으로 동일한 상태를 재시도할 수 있다. 다른 탭의 raw 값이 달라졌으면 재시도도 충돌로 중단한다.

상위 입력을 바꾸면 의미가 무효화되는 하위 결과를 함께 제거한다.

```text
Context change    → Metric through Decision reset
Metric change     → Diagnosis through Decision reset; Funnel retained
Funnel change     → Diagnosis through Decision reset
Hypothesis change → Experiment through Decision reset
Experiment change → Result and Decision reset
Result change     → Decision reset
```

하위 데이터가 있으면 UI가 삭제 영향을 먼저 확인한다.

## Deterministic and AI boundary

| 책임 | TypeScript | AI | Human |
|---|---:|---:|---:|
| CSV·JSON·URL·AI output 검증 | O | X |  |
| 전환율·이탈률·최대 이탈 계산 | O | X |  |
| metric delta·guardrail·verdict | O | X |  |
| evidence provenance 보존 | O | 참조만 | 검토 |
| 원인 후보·가설 대안 | 기본 초안 | 선택적 제안 | 편집·확정 |
| 실험 threshold·표본·기간 | 검증 | X | 입력·사전 등록 |
| 최종 Decision | 일관성 검증 | X | O |

AI 응답 계약에는 KPI 수치, threshold, verdict와 decision 필드가 없다. 기존 evidence ID allowlist 밖의 참조, 단정적 인과 표현, unknown field가 있으면 응답 전체를 폐기하고 결정적 초안으로 복구한다. 응답 수신만으로 Project는 바뀌지 않으며 사용자가 **가설 초안에 적용**해야 한다.

## Product URL path

```text
URL input
→ HTTP(S), credential, port, host validation
→ DNS all-answer public-address validation
→ resolved IP pinning + original Host/TLS SNI
→ redirect마다 동일 검증
→ status/content-type/encoding/byte/time limit
→ script/style/template/noscript/svg removal
→ bounded title, description, headings and navigation text
→ untrusted snapshot
→ user explicitly applies selected fields
```

요청당 5초, 전체 10초, 최대 3회 redirect, HTML 512KB 제한을 사용한다. URL 분석 실패는 수동 입력을 막지 않는다.

## API contracts

두 POST route는 JSON body 크기 제한, same-origin 확인, `Sec-Fetch-Site` 확인, bounded in-memory rate limit, `Cache-Control: no-store`를 사용한다.

- `/api/product-context`: 4KB request, 분당 key당 8회.
- `/api/ai/diagnosis`: 32KB request, 분당 key당 6회.

두 route 모두 브라우저 `Origin` header가 없거나 현재 host와 다르면 거부한다. AI provider는 `development` runtime에서 명시적으로 활성화한 경우에만 호출되며, 기본 dev 명령은 server를 `127.0.0.1`에 bind한다. production runtime은 항상 fallback이다. 현재 rate limit은 단일 프로세스 메모리 기반이므로 다중 instance의 전역 quota가 아니다. public multi-tenant AI 출시 전 인증과 배포 환경의 durable user quota가 필요하다.

CSV 파일 metadata와 content, JSON backup은 client browser의 파일 입력 경계에서 검증한다. URL 요청과 두 route의 API payload, 외부 HTML과 AI structured output은 same-origin server 경계에서 별도로 검증한다.

## Reliability and fallback

- URL 실패: 사용자가 수동 brief로 계속한다.
- CSV 실패: browser에서 파일 metadata를 content read 전에 확인하고, content는 행·열 단위로 검증하며 기존 유효 데이터는 유지한다.
- storage 실패: UI 경고, 재시도, JSON backup과 corruption recovery를 제공한다.
- AI disabled·timeout·provider·invalid output: 결정적 초안을 반환한다.
- 표본 또는 기간 부족: `insufficient_evidence`를 반환한다.
- 변경 중 stale AI response: project ID와 `updatedAt`이 달라지면 폐기한다.

## Deployment shape

```text
Web/runtime: Next.js 16 App Router + React 19 + TypeScript
Styling: CSS Modules + generated design tokens + Tailwind CSS 4 import
Persistence: localStorage schema v1 + JSON files
Server: Next.js Node route handlers
AI: optional loopback-development OpenAI Responses API adapter; production fallback
Hosting: Vercel production at https://ux-measure-lab.vercel.app; GitHub main auto-deploy
```

서버 DB나 조직 기능을 추가할 때는 별도 spec과 migration·authorization 설계가 필요하다. Personal v1 모델을 그대로 multi-tenant schema로 간주하지 않는다.
