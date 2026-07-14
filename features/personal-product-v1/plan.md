# Personal Product v1 전체 실행 체크리스트

> **작성일:** 2026-07-14
> **상태:** 구현·검증 완료
> **완료 규칙:** 실행 증거가 없는 항목은 `[x]`로 바꾸지 않는다. 증거는 [`../../docs/verification.md`](../../docs/verification.md)에 연결한다.

## Gate 0 — 기준선과 구조

- [x] P-001 사용자 제품 설명과 기존 spec에서 완료 시나리오 확정.
- [x] P-002 현재 code·docs·test gap audit.
- [x] P-003 Personal v1 범위와 비범위 확정.
- [x] P-004 local-first single-user architecture 선택.
- [x] P-005 프로젝트 stack과 architecture 문서를 실제 상태로 동기화.
- [x] P-006 production source를 책임별 파일 300줄 이하로 유지.

## Gate 1 — Domain core와 테스트

- [x] D-001 Project aggregate와 versioned schema.
- [x] D-002 ProjectContext·Metric·Evidence·Hypothesis·Experiment·Result·Decision type.
- [x] D-003 external input runtime validator와 typed error.
- [x] D-004 CSV template와 RFC4180 subset parser.
- [x] D-005 file name/type/size/header/row validation.
- [x] D-006 empty·malformed·duplicate·negative·increasing·zero input rejection.
- [x] D-007 adjacent conversion·drop-off·total conversion 계산.
- [x] D-008 deterministic largest drop-off tie policy.
- [x] D-009 before/after absolute·relative delta 계산.
- [x] D-010 unrounded threshold·guardrail 비교와 limited verdict 판정.
- [x] D-011 parser·metric·verdict unit regression tests.
- [x] D-012 5-step golden scenario integration test.

## Gate 2 — Local-first personal workspace

- [x] L-001 versioned browser repository와 hydration state.
- [x] L-002 project create·switch·delete와 Context 제품명을 통한 rename.
- [x] L-003 compare-before-write commit, 저장 실패 상태 보존과 재시도.
- [x] L-004 JSON export·runtime validated import.
- [x] L-005 sample funnel과 CSV template download.
- [x] L-006 새로고침 복구, corrupted storage fallback과 multi-tab conflict.

## Gate 3 — 실제 Measure Loop UI

- [x] U-001 Context: name·URL·stage·audience·value action·goal form.
- [x] U-002 KPI: definition·formula·window·source kind form과 confirm gate.
- [x] U-003 Measure: CSV import·preview·row error·retry.
- [x] U-004 Diagnose: metrics와 largest drop-off observation.
- [x] U-005 Friction: phenomenon·data·possible causes·strength rationale·next check.
- [x] U-006 Hypothesize: editable change·expected behavior·alternative·missing evidence.
- [x] U-007 Experiment: success·failure·guardrail·duration·stop rule preregistration.
- [x] U-008 Validate: before/after input·delta·guardrail·verdict.
- [x] U-009 Decide: deterministic system recommendation·human decision·rationale·next action 분리.
- [x] U-010 Report: evidence snapshot·result·decision·next action·Markdown export.
- [x] U-011 navigation이 실제 section과 completion state를 전환.
- [x] U-012 loading·empty·invalid·insufficient·success·storage error states.
- [x] U-013 fixture debug controls를 production UI에서 제거.

## Gate 4 — Product URL context

- [x] W-001 URL input validation과 manual fallback.
- [x] W-002 public HTTP(S) only·DNS all-answer·private IP·redirect 방어.
- [x] W-003 실제 transport abort, timeout·HTML content type·response byte limit.
- [x] W-004 title·description·heading·navigation text extraction.
- [x] W-005 외부 HTML 비실행·text sanitization.
- [x] W-006 route unit/integration test와 failure UI.

## Gate 5 — Evidence-grounded AI

- [x] A-001 server-only local provider adapter와 explicit opt-in env contract.
- [x] A-002 structured input/output runtime validation.
- [x] A-003 evidence ID grounding, causal·quantitative·decision language guard.
- [x] A-004 Diagnose→Hypothesis friction·가설 advisory만 제공; KPI·실험 수치 제외.
- [x] A-005 timeout·provider·refusal·invalid output fallback.
- [x] A-006 AI unavailable 상태 end-to-end completion.
- [x] A-007 fixed evaluation fixtures와 human review rubric.
- [x] A-008 metric·threshold·verdict·Decision이 AI output에 의해 변경되지 않음.

## Gate 6 — UX·접근성·보안

- [x] Q-001 generated design token으로 색·간격·radius 구성.
- [x] Q-002 desktop과 Chrome 390px responsive 핵심 화면 검증.
- [x] Q-003 keyboard 첫 skip link, section focus와 visible focus 검증.
- [x] Q-004 label·required·heading·status·error announcement.
- [x] Q-005 reduced motion·loading·disabled state.
- [x] Q-006 CSV/JSON/URL/AI trust boundary tests.
- [x] Q-007 secret scan·client bundle secret absence.
- [x] Q-008 dependency audit zero vulnerability.
- [x] Q-009 OWASP Top 10·LLM risk mapping.

## Gate 7 — 검증·문서·출시 준비

- [x] V-001 `npm run typecheck` zero warning.
- [x] V-002 `npm run lint` zero warning.
- [x] V-003 `npm test` 51/51 pass.
- [x] V-004 `npm run build` pass.
- [x] V-005 14 acceptance criteria evidence matrix.
- [x] V-006 독립 reviewer가 계산·storage·UI·trust boundary를 반증하고 발견 사항 수정.
- [x] V-007 README를 제품 설명·실제 capability table·사용법으로 개편.
- [x] V-008 architecture·data model·security·runbook 동기화.
- [x] V-009 실제 Power-xc 프로젝트 dogfood 기록 template.
- [x] V-010 metadata·repository hygiene·release gate.
- [x] V-011 원자적 commit 범위 준비. Commit·push·deploy는 사용자 명시 승인 후 수행.
