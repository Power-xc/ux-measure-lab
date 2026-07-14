# UX MeasureLab 제품 기반 리서치

> **보존 상태:** 구현 전 리서치 기록이다. 현재 구현 delta는 [`../personal-product-v1/research.md`](../personal-product-v1/research.md)를 따른다.

> **조사일:** 2026-07-14
> **결정 질문:** MVP가 행동 데이터 수집 엔진을 직접 만들지, 기존 분석 도구 위의 의사결정 레이어로 시작할지 결정한다.

## 1. 제공 리서치 검토

### 채택

- North Star를 단순 활동보다 전달된 사용자 가치에 연결한다.
- Activation 후보는 장기 Retention과의 관계를 이후 데이터로 검증한다.
- 행동 신호를 원인이 아닌 관찰로 취급한다.
- Claim, Evidence, Alternative, Missing Evidence 구조를 AI 판단의 기본으로 사용한다.
- 개인·회사·프로젝트 데이터를 Workspace 경계로 분리한다.

### 참고

- 저트래픽 환경에서 정성 테스트, 프로토타입, Fake Door, 전후 비교, Bayesian·Sequential 방법을 상황에 맞게 선택한다.
- 분석·행동·실험·리서치 도구 사이에 의사결정 워크플로 공백이 있다는 제품 가설을 인터뷰로 검증한다.

### 제외 또는 재검증

- 행동 신호별 고정 최소 세션 30~100개.
- 적은 트래픽을 이유로 한 기본 `p < 0.1` 권고.
- Bayesian posterior 90%를 보편 성공 기준으로 사용.
- p-value에서 AI confidence 백분율을 변환.
- RAG가 hallucination을 방지한다는 단정.
- 로그만으로 인과관계를 도출한다는 표현.
- 원문 참고문헌 없이 `【42†L12-L20】` 형태의 인용을 구현 근거로 사용.

## 2. 외부 제품 조사

### 조사 범위

```text
지역: 글로벌 공식 Cloud 문서
플랫폼: Web
평가 시점: 2026-07-14
결정 기준: 기존 데이터 활용 가능성, MVP 중복 개발, API 제한, 보안 책임
```

### Source table

| Source | Type | 접근일 | 확인한 사실 | 제한 |
|---|---|---:|---|---|
| https://posthog.com/ | 공식 제품 페이지 | 2026-07-14 | Product Analytics, Session Replay, Feature Flags, Warehouse, API·Webhook을 한 제품군으로 제공 | 공급자 설명이며 UX 성과는 증명하지 않음 |
| https://eu.posthog.com/api/schema/swagger-ui/ | 공식 API schema | 2026-07-14 | 프로젝트·환경 단위 API와 analytics 관련 endpoint가 존재 | 실제 권한·query 계약은 구현 전 endpoint별 재확인 필요 |
| https://learn.microsoft.com/en-us/clarity/heatmaps/heatmaps-overview | 공식 문서 | 2026-07-14 | 클릭·스크롤·영역·전환·Attention map과 rage/dead/error click 유형 제공 | heatmap 생성 가능과 통계적 신뢰성은 별개 |
| https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api | 공식 문서 | 2026-07-14 | Export API가 rage/dead click, excessive scroll, quickback, script error 등을 제공 | 하루 10회, 최근 1~3일, 1,000행, pagination 없음 |

### Findings

#### F-001 Existing collection products already cover the expensive base layer

- `fact`: PostHog는 analytics, replay, feature flags, warehouse와 API를 제공한다.
- `inference`: UX MeasureLab이 같은 수집·실험 인프라를 재구축하면 핵심 의사결정 UX 검증보다 범위가 커진다.
- `applicability`: 채택.

#### F-002 Clarity is useful as a behavioral-signal source, not the MVP system of record

- `fact`: Clarity Export API는 행동 신호를 제공하지만 기간·호출·행 제한이 크다.
- `inference`: later evidence connector로는 유용하지만 장기 KPI와 실험 결과의 단일 저장소로 사용하기 어렵다.
- `applicability`: 참고 후 2차 연동.

#### F-003 Heatmap availability does not validate a UX cause

- `fact`: Clarity는 최소 트래픽 제한 없이 heatmap 생성을 지원한다고 문서화한다.
- `inference`: 생성 가능 여부는 패턴의 의사결정 신뢰도를 보장하지 않는다.
- `applicability`: 행동 신호 UI에 표본·기간·대안 설명을 함께 표시한다.

## 3. 제품 범위 판정

| 옵션 | 사용자 가치 | 검증 비용 | 핵심 가설 검증 | 판정 |
|---|---|---:|---|---|
| URL 기반 UX Audit | 빠른 첫 결과 | 낮음 | 정량 결과 가치는 검증 불가 | 제외 |
| CSV 기반 Measure Loop | 완결된 KPI→가설→실험→결정 | 중간 | 가능 | 채택 |
| 실시간 통합 플랫폼 | 높은 자동화 | 높음 | 통합 개발이 선행 | 후속 |

## 4. AI 기능 적합성 판정

### Verdict: EXPERIMENT

규칙과 코드로 처리할 수 있는 항목:

- 퍼널 전환·이탈 계산.
- metric delta와 threshold 비교.
- CSV validation.
- 실험 판정 상태 제약.

AI를 실험할 항목:

- 제품 맥락에서 KPI 후보 생성.
- 행동 관찰에 대한 대안 설명 생성.
- 가설을 정해진 구조로 변환.
- 실험 방법 후보와 누락 근거 제안.
- 결과 근거 요약.

### AI 평가 기준 초안

- 필수 필드 누락률.
- 존재하지 않는 evidence ID 인용률.
- 관찰을 인과로 표현한 비율.
- 전문가가 수용한 가설 초안 비율.
- 템플릿 수동 작성 대비 완료 시간.

정확도 목표와 비용·latency 수치는 provider와 고정 eval dataset이 결정되기 전 `NOT_CHECKED`다.

## 5. 주요 위험

- 제품의 핵심 가치가 아직 사용자 인터뷰로 검증되지 않았다.
- KPI 추천이 일반론으로 흐르면 반복 사용 이유가 약하다.
- CSV 입력 마찰이 첫 가치 도달을 막을 수 있다.
- 적은 표본에서 AI 판정이 과도한 확신을 만들 수 있다.
- 회사 데이터 연결 시 credential과 workspace 격리가 필수다.
- 현재 저장소에는 실제 UI 패턴이 없어 code-architect가 기존 구조를 근거로 scaffold할 수 없다.

## 6. 결론

MVP는 수집 도구가 아니라 CSV 기반 의사결정 레이어로 시작한다. 첫 제품 가설은 “KPI 추천” 자체가 아니라 “근거에서 사전 등록된 실험과 최종 결정까지 한 흐름으로 완료할 수 있다”이다.

다음 검증은 제품 기반 계획 검토 후 하나의 실제 Power-xc 제품 데이터를 이용한 dogfood scenario다.
