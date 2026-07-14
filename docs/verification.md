# Verification

> **검증일:** 2026-07-15 · Node v26.4.0 · Next.js 16.2.10 · Chrome on macOS · 기준 commit `050e3af`

## Release gate

| Gate | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npm run typecheck` · 0 error |
| ESLint | PASS | `npm run lint` · 0 warning |
| Unit tests (root) | PASS | `npm test` · 165/165 |
| Unit tests (SDK) | PASS | `npm run test:sdk` · 69/69 (packages/collector, jsdom) |
| Playwright E2E | PASS | `npm run test:e2e` · 8/8 chromium · production build를 loopback에서 기동해 검증 |
| Production build | PASS | `npm run build` · static `/`, dynamic `/api/ai/diagnosis`·`/api/product-context`·`/api/ingest`·`/api/harness/measure` |
| GitHub CI | PASS | `main`의 verify(typecheck·lint·test·sdk·build·audit) + e2e job green |
| Dependencies | PASS | `npm audit --omit=dev` · 0 vulnerability · 런타임 의존성은 Next/React뿐(Supabase·Upstash·PostHog 전부 fetch 직호출) |
| Security headers | PASS | production build 로컬 응답에서 CSP, COOP, CORP, Permissions-Policy, Referrer-Policy, nosniff, DENY 확인 |
| Secret/code scan | PASS | pre-commit secret-scan 게이트 + source에 explicit `any`, `@ts-ignore`, HTML injection, console, TODO 없음 |
| File size | PASS | 모든 source/test/style 300줄 이하 |

공개 배포는 의도적으로 내려간 상태다(개발 완료 릴리스에서 재공개). 아래 Deployment evidence는 마지막 공개 빌드 기준의 기록이며 재공개 시 재검증한다.

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
| Harness 계약 | contract·invariants·updates | unknown field·수치 위조 거부, sourceRef invariant, v1→v2 무손실 마이그레이션·백업, harness evidence 적용 규칙 |
| Harness 측정 | catalog·measure-service·registry·route | 스킬-capability 매핑, 결정적 파생 계산 재사용, insufficient_sample, queryHash 재현성, same-origin 거부, 어댑터 디스패치 |
| PostHog 어댑터 | query·adapter·http-client | fixture 정규화가 계약 검증 통과, 오류 매핑(401·429·5xx), token-bucket 산술, 교차 어댑터 스키마 동형(HAC-09) |
| Ingest 백엔드 | backends | PostgREST 요청 형태·헤더, Upstash 고정창 산술·장애 시 in-memory degrade, env 미설정 시 안전기본값 유지 |
| Collector SDK | 69 tests | consent 게이트, 입력값 비수집, rage/dead/scroll 결정적 검출, 세션 산술, 배칭·beacon, 경로 마스킹, SPA 라우팅 |

## Browser evidence

BROWSER-001~004는 Playwright E2E로 자동화되어 CI에서 반복 검증된다. BROWSER-005와 URL 분석 적용 흐름(BROWSER-002 전반부)은 수동 검증으로 유지한다.

| ID | Result | Coverage |
|---|---|---|
| BROWSER-001 | PASS · 자동화 | `e2e/golden-loop.spec.ts` — 8단계 완주와 Markdown report 다운로드 단언 |
| BROWSER-002 | PASS · 부분 자동화 | `e2e/persistence.spec.ts` — 새로고침 후 project·funnel state 복구; URL context 적용은 수동 검증 유지 |
| BROWSER-003 | PASS · 자동화 | `e2e/accessibility.spec.ts` — 첫 Tab이 `본문으로 건너뛰기`에 포커스, Enter가 main으로 포커스 이동 |
| BROWSER-004 | PASS · 자동화 | `e2e/mobile.spec.ts` — viewport 390px에서 horizontal overflow 0 단언과 핵심 UI 표시 |
| BROWSER-005 | PASS · 수동 | 앱 source console error 없음. 설치된 확장의 Google Fonts 주입은 production CSP가 차단함을 확인 |
| BROWSER-006 | PASS · 자동화 | `e2e/harness.spec.ts` — 빈 aggregate에서 측정 실행 시 수치 없이 `insufficient_sample` 카드 표시 (HAC-11의 UI 계약) |
| BROWSER-007 | PASS · 자동화 | `e2e/harness.spec.ts` — mock 응답으로 측정 성공 시 draft 유지·세션 캐시 재사용·명시적 적용 후에만 저장 (HAC-08·HAC-10) |

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

## Harness acceptance criteria (measurement-harness spec)

| AC | Result | Evidence |
|---|---|---|
| HAC-01 v1 무손실 마이그레이션·백업 | PASS | project-repository 마이그레이션 테스트 — 값 무변형·백업 슬롯 보존·미래 version 거부 |
| HAC-02 동의 전 큐잉 금지 | PASS | collector consent 테스트 — granted 전 큐잉·전송 0 |
| HAC-03 입력값 수집 불가 | PASS | collector mask 테스트 — 설정으로도 input·password·결제 필드 수집 불가 |
| HAC-04 rage 결정적 검출 | PASS | 30px·1s·3연속 고정 타임스탬프 테스트 |
| HAC-05 ingest 거부 계약 | PASS | 미등록 키 401·정지 403·불허 Origin 403·한도 429+Retry-After |
| HAC-06 부분 드롭 수용 | PASS | 무효 이벤트 드롭 + 202 accepted/dropped |
| HAC-07 보존 정책 | 코드 검증 | 파티션 DETACH·DROP 잡 SQL 작성·검토 완료 — 실행 증거는 Supabase 프로비저닝 후 |
| HAC-08 queryHash 재현성 | PASS | measure-service 결정성 테스트 + BROWSER-007 세션 캐시 재사용 |
| HAC-09 교차 어댑터 동형 | PASS | first-party·PostHog 동일 질의 → 동일 스키마 정규화 (fixture) |
| HAC-10 명시 적용 전 불변 | PASS | applyHarnessEvidence 테스트 + BROWSER-007 draft 유지 |
| HAC-11 insufficient_sample | PASS | measure-service 미달 테스트 + BROWSER-006 UI 표시 |
| HAC-12 기존 게이트 무회귀 | PASS | 기존 스위트 전부 포함 165/165·69/69·E2E 8/8 |

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

- 통계적 유의성, p-value, segment 자동 판정은 구현하지 않았다.
- 실서비스 연결은 `NOT_RUN`: Supabase·Upstash·PostHog 실계정 호출은 프로비저닝 전이다. env 미설정 시 안전기본값(빈 스토어 → 수집 0, not_configured 폴백)이 게이트로 검증되어 있고, 실연결 후 dogfood 실측이 다음 검증 단계다.
- PostHog 질의 빌더는 순수 함수로 분리되어 있으나 실제 엔드포인트 계약은 첫 실호출 전 공식 스키마로 재확인해야 한다(`NOT_CHECKED` 주석 기준).
- session replay는 [spec](../features/session-replay/spec.md)만 존재하며 구현하지 않았다. 사전 동의·기본 마스킹·짧은 보존이 선행 조건이다.
- 실제 OpenAI provider 품질·비용은 `NOT_RUN`; mock contract와 fallback만 release gate다.
- `useWorkspace`의 저장 실패 state 유지·재시도 경로는 전용 hook-level 자동화 테스트가 아직 없다.
- VoiceOver·Safari·forced-colors는 후속 compatibility matrix이며 AC에 포함하지 않았다.
- 인증·팀 workspace는 범위 밖이다. 다중 사용자 전 RLS 도입이 전제다.
