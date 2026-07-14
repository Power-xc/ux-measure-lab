# Product Brief

## Product

```text
Name: UX MeasureLab
Category: AI UX Measurement & Experimentation
Promise: Test experiences. Measure impact.
```

## 사용자 문제

개인 AI Builder와 Tech·AI Product Designer는 제품을 직접 만들 수 있지만 전담 analyst 없이 다음 작업을 반복한다.

1. 제품별 핵심 KPI를 정의한다.
2. 분석 도구에서 퍼널과 행동 데이터를 찾는다.
3. 이탈 신호의 원인을 추정한다.
4. UX 가설과 실험 기준을 작성한다.
5. 결과가 애매할 때 다음 결정을 설명한다.

데이터는 존재해도 결정의 근거가 여러 도구와 문서에 흩어지며, 관찰과 원인 가설이 쉽게 혼동된다.

## 첫 사용자

- 실제 웹 제품을 운영하는 개인 AI Builder.
- 데이터 분석 전문가는 아니지만 CSV export와 제품 맥락을 제공할 수 있다.
- 트래픽이 적어 대규모 A/B test만으로 의사결정하기 어렵다.
- 빠른 결과보다 근거를 추적할 수 있는 결정을 원한다.

## Job to be done

제품 경험을 출시하거나 변경했을 때, 성공 기준을 정의하고 가장 중요한 행동 신호와 위험한 설명을 찾아 다음 테스트와 결정을 근거와 함께 기록하고 싶다.

## Value proposition

```text
Raw product context and behavior data
→ measurable KPI
→ prioritized signal
→ evidence-backed hypothesis
→ pre-registered experiment
→ constrained verdict
→ human decision
```

## 차별화 가설

기존 analytics, replay, experimentation 제품을 대체하지 않는다. 이들의 결과를 UX 가설과 실험 결정으로 변환하는 workflow에 집중한다.

이 차별화는 아직 사용자 인터뷰와 dogfood 결과로 검증되지 않은 제품 가설이다.

## MVP 성공 정의

- 첫 사용자가 15분 안에 제품과 KPI 계획을 확정한다.
- 사용자가 퍼널 데이터에서 하나의 신호를 선택한다.
- 실험 시작 전에 Primary, success, failure, Guardrail 기준을 기록한다.
- AI가 존재하지 않는 Evidence를 인용하지 않는다.
- 사람의 최종 Decision이 AI 권고와 별도로 남는다.
- 두 번째 결정 기록률을 측정한다. 목표값은 파일럿 전에 확정한다.

## 주요 위험

- KPI 제안이 일반론에 그칠 수 있다.
- CSV 입력 마찰이 첫 가치 도달을 늦출 수 있다.
- 적은 표본에서 과도한 결론을 만들 수 있다.
- AI 없는 template workflow가 이미 충분할 수 있다.
- 회사 데이터 연결 시 credential과 workspace 격리가 복잡해진다.
