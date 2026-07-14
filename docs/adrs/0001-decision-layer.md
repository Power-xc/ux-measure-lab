# ADR-0001: 기존 분석 도구 위의 Decision Layer로 시작한다

> **상태:** Accepted
> **날짜:** 2026-07-14

## Context

UX MeasureLab의 핵심 가치는 행동 데이터를 수집하는 것보다 KPI, UX 가설, 실험 기준, 정량 결과, 최종 결정을 추적 가능한 흐름으로 연결하는 데 있다.

PostHog와 Microsoft Clarity 같은 기존 제품은 product analytics, replay, heatmap, behavioral signal을 이미 제공한다. 자체 수집·재생 인프라를 먼저 만들면 제품의 차별화 가설을 검증하기 전에 범위와 보안 책임이 크게 증가한다.

## Decision

MVP는 CSV 기반 Measure Loop를 구현한다.

- 기존 분석 제품의 export를 입력으로 사용한다.
- 전환, 이탈, delta, threshold는 결정적 코드로 계산한다.
- AI는 KPI 후보, 대안 설명, 가설 구조화, 근거 요약을 실험적으로 지원한다.
- 사용자 Decision을 최종 권한으로 둔다.
- PostHog와 Clarity는 MVP workflow가 검증된 뒤 read-only connector로 추가한다.

## Alternatives

### URL 기반 AI UX Audit

구현은 빠르지만 정량적 결과와 실험 판정을 검증하지 못한다. 핵심 제품에서 제외한다.

### 자체 Analytics Platform

통제력은 높지만 event SDK, ingestion, query, replay, privacy, experiment allocation까지 범위가 확대된다. 초기 제품 가설 검증에 부적합하다.

### 처음부터 실시간 vendor integration

사용 경험은 편하지만 OAuth, credential, provider schema, rate limit가 핵심 workflow 검증을 선행한다. 후속 feature로 분리한다.

## Consequences

### Positive

- 핵심 decision workflow를 더 빨리 검증한다.
- AI가 없어도 deterministic fallback을 유지할 수 있다.
- vendor lock-in을 줄이는 normalized domain model을 먼저 설계할 수 있다.

### Negative

- CSV upload가 사용자 마찰이 될 수 있다.
- 실시간 monitoring과 자동 refresh가 없다.
- provider별 세부 행동 정보가 누락될 수 있다.

## Revisit conditions

- 파일럿 사용자가 CSV 마찰 때문에 첫 Decision을 완료하지 못한다.
- 두 개 이상의 실제 프로젝트가 같은 provider integration을 반복 요청한다.
- Measure Loop가 반복 사용되며 자동 refresh가 주요 병목으로 확인된다.
