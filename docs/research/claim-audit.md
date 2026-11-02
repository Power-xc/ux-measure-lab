# Initial Research Claim Audit

> **대상:** `research/source/deep-research-summary.pdf`
> **감사일:** 2026-07-14

## 판정 기준

```text
ADOPT    제품 원칙으로 바로 사용
REFERENCE 방향성 참고, 구현 기준으로는 추가 근거 필요
VERIFY   공식 원문과 조건 재검증 필요
REJECT   현재 형태로 제품 규칙에 사용하지 않음
```

## Adopt

| Claim | Product rule |
|---|---|
| North Star는 수동 활동보다 전달된 사용자 가치와 연결해야 한다. | Metric마다 value action과 연결 이유를 요구한다. |
| Activation 후보는 이후 Retention과 연결되는지 검증해야 한다. | Activation을 영구 정의가 아닌 candidate로 관리한다. |
| Behavioral signal에는 여러 원인이 가능하다. | Observation, alternative explanation, missing evidence를 분리한다. |
| AI 판단은 Evidence를 보여줘야 한다. | AI output은 존재하는 Evidence ID만 참조한다. |
| 개인·프로젝트·회사 데이터 경계가 필요하다. | Workspace를 authorization과 memory 경계로 사용한다. |

## Reference

| Claim | Limitation | Use |
|---|---|---|
| 저트래픽 제품은 정성과 정량 방법을 함께 사용해야 한다. | 제품 위험과 데이터 종류에 따라 방법이 달라진다. | Experiment recommendation의 방향성. |
| Analytics와 research 도구 사이에 workflow gap이 있다. | 사용자 인터뷰 근거가 아직 없다. | Product hypothesis로만 사용. |
| Claim/Evidence/Alternative/Confidence 구조가 유용하다. | confidence 산정 계약이 없다. | Confidence를 ordinal rationale로 대체. |

## Verify

| Claim | Why |
|---|---|
| 행동 신호마다 30~100 session이 필요하다. | universal threshold의 출처와 조건이 없다. |
| Bayesian posterior 90%면 긍정 판정할 수 있다. | prior, effect, loss, stopping policy가 빠졌다. |
| 적은 traffic이면 `p < 0.1`을 사용할 수 있다. | false positive와 의사결정 비용을 함께 평가해야 한다. |
| 특정 replay vendor의 consent·region behavior. | 정책과 제품 기능이 변경될 수 있고 법률 판단이 필요하다. |
| 도구별 API·가격·retention. | 구현 직전 최신 공식 문서를 다시 확인해야 한다. |

## Reject

| Claim | Reason |
|---|---|
| p-value로 AI Confidence 68%를 표현한다. | 통계적 의미가 다른 값을 직접 변환할 수 없다. |
| RAG가 hallucination을 방지한다. | grounding을 개선할 수 있지만 correctness를 보장하지 않는다. |
| 로그에 Causal AI를 적용하면 원인을 도출할 수 있다. | 관찰 데이터만으로 인과를 확정할 수 없다. |
| 최소 session 미만 데이터는 무시한다. | 작은 데이터도 bug·안전 신호 또는 정성 근거가 될 수 있다. |

## Missing source problem

PDF의 인용이 `【42†L12-L20】` 형태로 남아 있지만 사람이 확인할 수 있는 bibliography가 없다. 따라서 해당 token은 출처로 인정하지 않는다. 후속 research는 URL, source type, 접근일, 갱신일, 직접 뒷받침하는 claim을 함께 기록한다.

## Next research

1. 저트래픽 experiment decision matrix의 1차 연구 확보.
2. KPI와 Activation/Retention 관계의 원문 확보.
3. PostHog connector 구현 직전 공식 auth·query·rate-limit 확인.
4. Clarity connector 구현 직전 API 기간·quota·consent 재확인.
5. 사용자 5명의 실제 마지막 제품 결정 workflow 인터뷰.
