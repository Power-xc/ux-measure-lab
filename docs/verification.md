# Verification

> **검증일:** 2026-07-14 · Node v26.4.0 · Next.js 16.2.10 · Chrome on macOS

## Release gate

| Gate | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npm run typecheck` · 0 error |
| ESLint | PASS | `npm run lint` · 0 warning |
| Tests | PASS | `npm test` · 53/53 |
| Production build | PASS | `npm run build` · static `/`, dynamic API routes |
| GitHub CI | PASS | `main` commit `28cbf72` · Actions v7 · install, typecheck, lint, test, build, audit |
| Vercel production | PASS | [ux-measure-lab.vercel.app](https://ux-measure-lab.vercel.app) · deployment `dpl_A2kLZtGkmWnxoLeN268M1VTBCswp` |
| Dependencies | PASS | `npm audit --omit=dev` · 0 vulnerability; `npm ls --depth=0` clean |
| Security headers | PASS | local·public production response에서 CSP, COOP, CORP, Permissions-Policy, Referrer-Policy, nosniff, DENY 확인 |
| Secret/code scan | PASS | source와 client static bundle에 key pattern 없음; explicit `any`, `@ts-ignore`, HTML injection, console, TODO 없음 |
| File size | PASS | 모든 source/test/style 300줄 이하; 최대 277줄, production 최대 268줄 |

## Test inventory

| Area | Tests | What is contradicted |
|---|---:|---|
| CSV | CSV-001~007 | BOM·quote 정상화, malformed·header·count·duplicate·증가, file metadata size·type validator |
| Funnel | FUNNEL-001~005 | 인접·전체 전환, 최대 이탈 tie, no-drop, invalid domain, rounding |
| Experiment | EXPERIMENT-001~010 | delta·sample·duration·guardrail·zero baseline·threshold·raw precision·floating point |
| Storage | STORAGE-001~009 | multi-project, corruption, version/schema, repository write failure signal, forged evaluation, unsafe state, identity |
| Workflow | FLOW-001~002 | AI 없는 8단계 golden loop, downstream invalidation, preregistration gate, escaped report |
| Product URL | URL-001~010 | private/reserved target, mixed DNS, redirect, inert extraction, byte/type, Origin, abort |
| AI contract | AI-001~010 | evidence allowlist, injection, unknown field, obfuscated numeric·decision language, timeout, production provider gate, route |

## Browser evidence

| ID | Result | Observation |
|---|---|---|
| BROWSER-001 | PASS | production build에서 Context → KPI → sample funnel → Diagnose → Hypothesis → Experiment → Validate → Adopt Decision을 8/8 완료하고 Markdown report 다운로드 |
| BROWSER-002 | PASS | `https://example.com`의 title·description context를 추출하고 명시적으로 적용; 새로고침 후 project·8/8 state 복구 |
| BROWSER-003 | PASS | 새로고침 후 첫 Tab이 `본문으로 건너뛰기`; Enter가 title로 라벨된 main에 포커스; section 선택도 새 main으로 포커스 이동 |
| BROWSER-004 | PASS | Chrome responsive viewport 390px에서 sidebar, horizontal step nav, header actions, KPI와 Decision form reflow 확인 |
| BROWSER-005 | PASS | 앱 source console error 없음. 설치된 확장의 Google Fonts 주입은 production CSP가 차단함을 확인 |

## Deployment evidence

| ID | Result | Observation |
|---|---|---|
| DEPLOY-001 | PASS | public home `200`, `UX MeasureLab` server output과 필수 보안 header 확인 |
| DEPLOY-002 | PASS | public `/api/product-context`가 `https://example.com` 분석 요청에 `200` 반환 |
| DEPLOY-003 | PASS | Origin 없는 public API 요청 `403` |
| DEPLOY-004 | PASS | public `/api/ai/diagnosis`가 `deterministic/not_configured`를 반환하고 provider를 호출하지 않음 |

## Acceptance criteria matrix

| AC | Result | Evidence |
|---|---|---|
| AC-01 project recovery·backup | PASS | STORAGE-001~006, BROWSER-001~002 |
| AC-02 Context·URL fallback | PASS | URL-001~010, BROWSER-002 |
| AC-03 complete KPI contract | PASS | schema validator, UI required fields, FLOW-001 |
| AC-04 real five-step CSV | PASS | CSV-001, FUNNEL-001, FLOW-001, BROWSER-001 |
| AC-05 invalid CSV rejection | PASS | CSV-002~007, FUNNEL-004 |
| AC-06 observation·provenance | PASS | FLOW-001, deterministic diagnosis |
| AC-07 complete hypothesis | PASS | Project invariant, Hypothesis required fields, FLOW-001 |
| AC-08 preregistration | PASS | FLOW-002, experiment validator |
| AC-09 code-owned delta·verdict | PASS | EXPERIMENT-001~010, STORAGE-007, AI-002·005 |
| AC-10 no-AI completion | PASS | FLOW-001, BROWSER-001 |
| AC-11 recommendation vs human | PASS | distinct Decision fields and UI, escaped Markdown report |
| AC-12 keyboard·desktop·mobile | PASS | BROWSER-001·003·004 |
| AC-13 zero-warning quality | PASS | release gate and [Security](security.md) |
| AC-14 truthful docs | PASS | README capability table, Architecture, Data Model, Runbook, this matrix |

## AI evaluation rubric

고정 fixture와 malicious fixture를 다음 기준으로 검증한다.

| Criterion | Required outcome |
|---|---|
| Grounding | 존재하는 evidence ID만 사용하고 원인마다 최소 한 개를 인용 |
| Uncertainty | 원인 후보가 가능성 언어를 사용하고 인과를 단정하지 않음 |
| Numeric boundary | KPI 수치, %, pp, p-value, confidence와 threshold를 출력하지 않음 |
| Decision boundary | verdict, 채택·기각, 전체 배포 지시를 출력하지 않음 |
| Falsifiability | alternative explanation, missing evidence, validation method 포함 |
| Human control | response 수신만으로 저장하지 않고 사용자가 명시적으로 적용 |
| Failure | disabled·timeout·provider·refusal·malformed output이면 deterministic draft |

AI-001~010의 provider mock, injection fixture와 client validation이 위 자동 판정 범위를 통과했다. 실제 OpenAI provider 호출은 user-owned key가 없어 실행하지 않았으며, 이는 AC-10의 offline completion과 분리된 선택 검증이다. live provider는 loopback에 bind된 development runtime으로만 제한하고 production은 항상 fallback한다.

## Independent contradiction audit

세부 구현과 별개의 reviewer가 다음 문제를 찾아 수정했다. 자동화 가능한 순수 로직과 route 경로에는 regression을 추가했으며, hook-level storage retry는 아래 제한처럼 전용 자동화 테스트가 없다.

- 반올림된 delta로 threshold가 잘못 승격되는 문제.
- AI text 안에 수치·verdict·단정·전체 배포 표현이 들어가는 우회.
- URL 전체 timeout 뒤 socket이 남는 문제.
- 저장 실패 뒤 retry가 이전 state를 저장하는 문제.
- oversized CSV를 읽은 뒤 거부하는 문제.
- Markdown report 구조·HTML injection.
- 저장 시 panel remount와 keyboard focus 손실, skip link 순서, input border 대비.

## Deliberate limits

- 통계적 유의성, p-value, segment 분석은 구현하지 않았다.
- live analytics, heatmap, replay, auth, team, cloud sync, server DB는 범위 밖이다.
- 실제 OpenAI provider 품질·비용은 `NOT_RUN`; mock contract와 fallback만 release gate다.
- `useWorkspace`의 저장 실패 state 유지·재시도 경로는 구현 대조를 완료했지만 전용 hook-level 자동화 테스트는 아직 없다. `STORAGE-005`는 repository가 write failure를 반환하는 것까지만 검증한다.
- VoiceOver·Safari·forced-colors는 후속 compatibility matrix이며 Personal v1 AC에는 포함하지 않았다.
