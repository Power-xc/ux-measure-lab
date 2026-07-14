# UX MeasureLab 제품 기반 계획

> **보존 상태:** 이 문서는 초기 Wave 계획 기록이다. 현재 실행 계획과 완료 증거는 [`../personal-product-v1/plan.md`](../personal-product-v1/plan.md)가 대체한다.

> **작성일:** 2026-07-14
> **상태:** Wave 1 완료 · Wave 2 구현 완료 / visual QA 대기
> **선택 모드 권장:** 유지 - Measure Loop MVP

## 1. 계획 요약

UX MeasureLab을 `CSV 기반 KPI→신호→가설→실험→결정` 제품으로 구축한다. 실시간 외부 연동과 자체 분석 인프라는 MVP 이후로 미룬다.

## 2. 사용자 검토가 필요한 결정

### D-001 MVP 제품 범위

- 권장: Measure Loop.
- 대안: URL Audit으로 축소하거나 실시간 통합까지 확대.

### D-002 기술 스택

- 권장: Next.js App Router + TypeScript + Tailwind CSS.
- 이유: 사용자 공개 프로필의 실제 스택과 일치하고 Web MVP·Vercel 배포에 적합하다.
- 미결: Supabase Auth·DB를 1차에 포함할지, local fixtures로 UX 흐름을 먼저 검증할지.

### D-003 첫 AI 경계

- 권장: provider adapter와 schema만 만들고 provider 선택은 구현 직전 공식 문서·비용 확인 후 확정.
- 계산은 전부 TypeScript, AI는 구조화·제안·요약만 담당.

### D-004 디자인 방향

- 권장: 분석 대시보드보다 `Evidence notebook + experiment workspace`를 중심으로 설계.
- 이유: 기존 analytics 제품과 시각적·기능적으로 구분된다.

## 3. 작업 Wave

### Wave 1 - 저장소 기반과 문서

영향 파일:

```text
README.md
docs/product-brief.md
docs/architecture.md
docs/data-model.md
research/source/deep-research-summary.pdf
research/evidence-registry.md
features/product-foundation/*
```

체크리스트:

- [x] 프로젝트 전용 정의·스택·보안·금지사항 문서 작성.
- [x] 제품 README와 문서 인덱스 작성.
- [x] PDF 원본 보존과 claim audit 작성.
- [x] 주요 결정 ADR 작성.

검증:

- 문서 링크와 경로 확인.

### Wave 2 - 실행 가능한 UX prototype

영향 파일 후보:

```text
package.json
src/app/*
src/features/project-onboarding/*
src/features/metric-plan/*
src/features/funnel-import/*
src/features/hypothesis/*
src/features/experiment/*
src/entities/*
src/shared/*
```

체크리스트:

- [x] 승인된 Next.js scaffold 생성.
- [x] 디자인 토큰과 responsive shell 정의.
- [x] 고정 fixture로 전체 Measure Loop 구현.
- [x] empty, loading, validation error, success 상태 구현.
- [ ] desktop·mobile 핵심 task 검증. 인앱 브라우저 runtime 초기화 충돌로 대기.

검증:

- lint, typecheck, build.
- 진입→결정 기록 flow를 점검한다.
- 토큰·상태·반응형을 점검한다.

### Wave 3 - 결정적 데이터 처리

체크리스트:

- [ ] CSV schema와 runtime validation.
- [ ] 인접 단계 conversion·drop-off 계산.
- [ ] largest drop-off 탐지.
- [ ] threshold·guardrail 판정.
- [ ] invalid input과 edge case 테스트.

검증:

- 단위 테스트 RED→GREEN.
- 빈 퍼널, 증가하는 count, 0 denominator, duplicate step, malformed row를 검증한다.

### Wave 4 - AI experiment

체크리스트:

- [ ] AI input/output contract.
- [ ] evidence ID grounding.
- [ ] alternative explanation·missing evidence 생성.
- [ ] timeout·provider failure·invalid output fallback.
- [ ] fixed eval fixtures와 human rubric.

검증:

- provider 없이 template fallback이 전체 task를 완료.
- hallucinated evidence ID가 validation에서 거부됨.
- AI 보안과 비용을 점검한다.

### Wave 5 - persistence and integration

이 Wave는 별도 DB·credential 승인을 받은 뒤 진행한다.

체크리스트 후보:

- [ ] Supabase schema와 RLS.
- [ ] personal workspace.
- [ ] encrypted integration credentials.
- [ ] PostHog read-only integration.
- [ ] Clarity summary evidence integration.

검증:

- 데이터 경계·자격 증명·보안을 점검한다.
- workspace cross-access denial test.

## 4. 테스트 전략

- 결정적 도메인 계산은 테스트 우선으로 구현한다.
- UI prototype은 상태 fixture와 브라우저 task를 우선하고, 계산 로직이 추가될 때 단위 테스트를 붙인다.
- AI는 고정 fixture에서 필수 필드, evidence grounding, causal-language violation, abstention을 평가한다.
- 배포 전 실제 Power-xc 제품 하나를 dogfood project로 등록한다.

## 5. 범위 이탈 방지

- UI prototype 이전에 DB schema를 확정하지 않는다.
- PostHog·Clarity credential 연결은 MVP UX 검증 뒤 별도 spec으로 분리한다.
- 자체 heatmap, replay, feature flag 구현은 만들지 않는다.
- 숫자 confidence는 calibrated dataset이 생기기 전 만들지 않는다.

## 6. 승인 후 첫 실행 단위

승인 직후 Wave 1만 구현한다. Wave 1 검증 후 Wave 2의 scaffold와 디자인 방향을 다시 확인한다. DB·외부 API는 별도 고영향 승인 없이는 시작하지 않는다.

## 7. 검토 선택지

- **확대:** Wave 1~4를 한 번에 승인.
- **선택 확대:** Wave 1과 Wave 2만 승인.
- **유지:** Wave 1만 승인하고 결과 확인 후 다음 Wave 검토. 권장.
- **축소:** 문서와 리서치만 보존하고 구현은 보류.
