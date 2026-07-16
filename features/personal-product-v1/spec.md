# UX MeasureLab Personal Product v1 명세

> **작성일:** 2026-07-14
> **상태:** Personal Product v1 구현·검증 완료
> **근거:** 사용자 요청, `features/product-foundation/spec.md`, 현재 실행형 prototype 감사

## 1. 목적과 목표

UX MeasureLab을 고정 fixture 데모가 아니라 개인 프로젝트에서 반복 사용할 수 있는 local-first 제품으로 완성한다. 제품 맥락과 행동 데이터를 KPI, UX 마찰 후보, 검증 가능한 가설, 실험, 결과 판정, 사람의 최종 결정으로 연결한다.

## 2. 단일 완료 시나리오

```text
새 프로젝트
→ 제품 URL·목표·사용자 맥락 확정
→ KPI 정의
→ 5단계 퍼널 CSV import
→ 전환·이탈 계산과 최대 이탈 관찰
→ 근거 기반 UX 마찰 후보
→ 편집 가능한 가설
→ 실험 사전 등록
→ Before/After 결과 입력
→ 결정적 verdict
→ AI 권고와 분리된 사람의 Decision
→ 리포트·JSON 백업
```

## 3. 사용자

- 1차: Power-xc 개인 AI Builder · Tech/AI Product Designer.
- 2차: 데이터 분석가가 없는 Product Designer, PM, 소규모 제품팀.
- 회사용 다중 사용자·권한은 서버 DB와 인증 승인 뒤 별도 버전에서 다룬다.

## 4. 제품 원칙

- Evidence before opinion.
- Hypothesis, not conclusion.
- 계산 가능한 수치는 TypeScript가 소유한다.
- AI는 구조화·대안 제시·요약을 지원하고 최종 결정을 내리지 않는다.
- 측정값, 계산값, 관찰, 가정, AI 추론을 구분한다.
- 근거가 부족하면 `insufficient_evidence`를 반환한다.
- 결과는 다음 실험과 Decision Log로 이어진다.

## 5. Personal v1 범위

### 포함

- 여러 개인 프로젝트 생성·전환·삭제.
- 브라우저 local persistence와 versioned JSON export/import.
- 제품명, 공개 URL, 단계, 대상 사용자, 핵심 가치 행동, 목표 입력.
- 공개 URL metadata/heading 기반 제한적 context extraction과 수동 fallback.
- KPI 이름, 정의, formula 설명, 기간, source kind 확정.
- CSV template, import, preview, 오류 행, provenance.
- 퍼널 전환율·이탈률·전체 전환·최대 이탈 계산.
- 관찰과 가능한 원인을 분리한 Friction Candidate.
- 근거, 대안 설명, 누락 근거가 있는 Hypothesis 편집.
- Primary metric, success/failure, guardrail, 기간, 종료 규칙 사전 등록.
- Before/After 결과와 practical threshold·guardrail 판정.
- `support | partial_support | not_supported | insufficient_evidence` verdict.
- AI recommendation과 human Decision 분리.
- 재열람 가능한 report와 다음 실험 연결.
- AI provider가 없거나 실패해도 template fallback으로 전체 흐름 완료.

### 제외

- 자체 event SDK, heatmap, replay, feature flag, traffic allocation.
- 실시간 PostHog·Clarity·GA4·Stripe 동기화.
- 로그인, 조직, 초대, RLS, 서버 DB.
- 원격 URL의 전체 사이트 크롤링이나 자동 UX 합격/불합격 판정.
- 관찰 데이터로 인과관계 확정.
- 교정되지 않은 confidence 백분율과 p-value 변환.

## 6. 신뢰 경계

- CSV·JSON·URL·HTML·AI output은 외부 입력으로 검증한다.
- URL fetch는 HTTP(S) 공개 주소만 허용하고 private/loopback/link-local IP와 redirect를 차단한다.
- HTML은 실행하지 않고 허용된 text metadata만 추출한다.
- AI key는 server environment에만 존재하며 client 응답·로그에 포함하지 않는다.
- 저장 데이터에는 raw replay, credential, 민감 form payload를 넣지 않는다.

## 7. 수용 기준

- [x] AC-01 여러 프로젝트가 새로고침 후 복구되고 JSON으로 백업·복원된다.
- [x] AC-02 제품 context를 입력·수정하고 URL 실패 시 수동 입력으로 계속할 수 있다.
- [x] AC-03 KPI가 definition, formula, window, source kind 없이 확정되지 않는다.
- [x] AC-04 유효한 5단계 CSV가 실제 화면 계산값으로 반영된다.
- [x] AC-05 malformed, 빈 값, 음수, 중복 단계, 증가 count, 0 denominator가 명확히 거부된다.
- [x] AC-06 최대 이탈은 원인이 아닌 관찰로 표시되고 provenance가 남는다.
- [x] AC-07 가설은 observation, change, expected behavior, metric, alternative, missing evidence를 가진다.
- [x] AC-08 실험은 success, failure, guardrail, duration, stop rule 없이 시작할 수 없다.
- [x] AC-09 결과 delta와 verdict는 코드가 계산하고 AI가 덮어쓰지 못한다.
- [x] AC-10 AI unavailable 상태에서도 Decision과 report까지 완료된다.
- [x] AC-11 system recommendation과 human Decision·rationale이 별도 저장된다.
- [x] AC-12 keyboard, desktop, Chrome 390px mobile에서 핵심 시나리오가 실행된다.
- [x] AC-13 typecheck, lint, test, build, security audit가 zero warning으로 통과한다.
- [x] AC-14 README의 구현 상태가 실제 검증 증거와 일치한다.

## 8. 완료 정의

체크박스나 코드 존재만으로 완료하지 않는다. 각 AC에 실행 명령, 테스트 또는 브라우저 관찰 증거가 있고 필수 항목에 `FAIL`, `BLOCKED`, `NOT_CHECKED`가 없어야 Personal Product v1을 완료로 판정한다.
