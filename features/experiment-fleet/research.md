# Experiment Fleet — 리서치

> **작성일:** 2026-07-16 · **작성자:** Power-xc
> **질문:** AX 시대에 실험의 단위가 A/B 쌍에서 수백~수천 변형의 "함대"로 이동하고 있다면, UX MeasureLab은 무엇을 채택하고 무엇을 거부해야 하는가?

## 1. 발단 — 업계 세션 소개문 (미검증 신호)

한 국내 CRM 세미나의 세션 소개문이 출발점이다.

> "대부분의 CRM 팀은 캠페인당 두세 개의 크리에이티브로 A/B 테스트를 합니다. KFC는 앞으로 5개월간 2,000개를 실험합니다. 글로벌에서도 앞선, 국내 최초의 Braze AI Decisioning Studio 도입 사례…"

이 소개문 자체는 공개 소스로 검증되지 않았다. "국내 최초"와 "5개월 2,000개" 모두 세션 홍보문 외의 근거를 찾지 못했다([claim-audit](../../research/claim-audit.md) 원칙에 따라 A-008로 등록). 그러나 이 문장이 가리키는 방향 — 실험 단위의 대량화 — 은 아래와 같이 독립적으로 검증된다.

## 2. 검증된 산업 신호 — 실험의 단위가 바뀌고 있다

### 벤더 보고 수치 (방향성 신뢰, 독립 검증 없음)

- KFC의 모회사 Yum! Brands는 BrazeAI Decisioning Studio로 연 2억 건 이상의 상호작용을 AI가 결정하게 했고, 고객당 거래 기준 최대 2.6배 증분 효과를 보고했다. — [Braze crawl/walk/run](https://www.braze.com/resources/articles/ai-decisioning-walk-crawl-run), [Marketing Dive](https://www.marketingdive.com/news/how-yums-ai-factory-supercharges-marketing-taco-bell-beyond/760161/)
- Kayo Sports는 Decisioning Studio로 잠재 액션 조합을 300개에서 120만 개로 확장했다. — [Braze 제품 페이지](https://www.braze.com/product/brazeai-decisioning-studio)
- Optimizely는 AI 어시스턴트(Opal) 사용자가 실험을 78.7% 더 많이 실행한다고 보고했다. — [2025 Opal 벤치마크](https://www.optimizely.com/insights/the-2025-optimizely-opal-ai-benchmark-report/)

### 독립적으로 관찰되는 규모

- Booking.com은 상시 1,000개 이상의 동시 실험을 운영한다. — [Silicon Canals](https://siliconcanals.com/), [Kameleoon](https://www.kameleoon.com/blog/concurrent-testing)
- Microsoft ExP는 연간 약 10만 건의 실험을 실행한다. — [Microsoft Research](https://www.microsoft.com/en-us/research/publication/the-anatomy-of-a-large-scale-experimentation-platform/)
- Meta Advantage+는 캠페인당 최대 150개 크리에이티브 조합을, Google Performance Max는 2026년 1월부터 전 캠페인에서 asset A/B 테스트를 자동 구성한다. — [ppc.land](https://ppc.land/google-quietly-expands-asset-a-b-testing-to-all-performance-max-campaigns/)

### 도구 시장의 이동 (2025–2026)

| 제품 | 이동 | 판정 방식 |
|---|---|---|
| Statsig (2025년 OpenAI가 인수) | Autotune: Thompson Sampling 밴딧으로 고정 종료일 없는 연속 재배분 | 확률적 배분, 통계 판정 아님 |
| Amplitude AI Agents | 상시 가동 에이전트가 실험을 만들고 실행 ("self-improving product") | AI 제안 + 사람 승인 게이트 |
| Optimizely Opal | 가설·변형 제안, 실험 리뷰 에이전트 | 전통적 통계 판정 유지 |
| PostHog | MCP로 AI 코딩 에이전트가 실험 생성 (2025년 말 신규 실험의 18%) | Bayesian/Frequentist 통계 판정 유지 |
| Eppo (Datadog 인수) · GrowthBook | warehouse-native, API 기반 프로그래매틱 실험 | 통계 판정 유지 |

출처: [Statsig](https://www.statsig.com/blog/openai-acquisition), [Amplitude](https://amplitude.com/press/ai-agents), [Optimizely](https://support.optimizely.com/hc/en-us/articles/23727985454861-Optimizely-Opal-and-AI-features), [PostHog](https://posthog.com/blog/ai-is-killing-no-code-experiments), [Datadog](https://www.datadoghq.com/blog/datadog-acquires-eppo/), [GrowthBook 4.4](https://www.growthbook.io/blog/growthbook-4-4)

### 왜 지금인가

LLM이 변형 생성 비용을 0에 수렴시켰다. 수백 개의 카피·이미지 변형을 몇 시간에 만들 수 있게 되면서 병목은 **생성**에서 **트래픽(표본 예산)과 판정(사람의 판단)**으로 이동했다. 이것이 "AX 시대의 실험 대량화"의 실체다. — [State of LLMs 2026](https://futureagi.com/blog/state-of-llms-app-layer-2026/)

## 3. 대량화의 통계적 위험 — 그냥 늘리면 오탐 공장이 된다

- **다중 비교 / FDR**: 보정 없이 5% 유의수준으로 대량 실험을 돌리면 오류 비율이 25%까지 관찰된다. Benjamini-Hochberg류 FDR 통제가 표준 완화책이다. — [Bell Statistics](https://www.bellstatistics.com/post/correct-me-if-im-wrong-navigating-multiple-comparison-corrections-in-a-b-testing), [Optimizely FDR](https://support.optimizely.com/hc/en-us/articles/4410283967245-False-discovery-rate-control)
- **승자의 저주**: 선택과 추정을 같은 데이터로 하면 당선 변형의 효과가 상향 편향된다. 선택용/추정용 데이터 분리가 완화책이다. — [arXiv MUSE](https://arxiv.org/pdf/2510.04489)
- **novelty effect**: 새로움 자체가 만드는 일시적 상승. UI 변경은 2–4주기에 걸쳐 감쇠한다. — [Analytics Toolkit](https://www.analytics-toolkit.com/glossary/novelty-effect/)
- **표본 파편화**: 유한한 트래픽이 많은 팔에 쪼개지면 개별 실험의 검정력이 무너진다. — [arXiv 실험 다수 체제](https://arxiv.org/pdf/2603.17031)
- 완화책의 공통 구조: **guardrail 지표, holdout, 최소 표본 규율, 예산 배분** — 전부 사전 등록 가능한 정책이다. — [Spotify Confidence](https://confidence.spotify.com/blog/better-decisions-with-guardrails)

## 4. 사람의 역할 이동 — 변형 선택자에서 정책 설계자로

- Braze의 공식 입장: "전문가 지원과 적절한 guardrail 없이는 AI가 브랜드 마진을 훼손하는 방식으로 목표를 달성할 수 있다." 사람은 성공 지표·행동 공간·guardrail·빈도 상한을 정의하고, 에이전트가 그 경계 안에서 최적화한다. — [Braze agentic workflows](https://www.braze.com/resources/articles/agentic-workflows)
- Adobe는 사전 승인(human-in-the-loop)과 경계 내 자율(human-on-the-loop)을 구분해 이중 감독 모델을 운영한다. — [MarTech](https://martech.org/adobe-rebrands-experience-cloud-as-cx-enterprise-goes-all-in-on-ai-agents/)
- EU AI Act는 고위험 AI 결정에 입력 데이터·모델 버전·타임스탬프·검토자 신원을 포함한 감사 추적을 요구한다(2026년 중반 본격 집행). 실험 대량화는 감사 가능성 요구와 함께 온다. — [Velt](https://velt.dev/blog/audit-trails-ai-decisions-regulators-require/)
- 국내에서도 같은 프레임이 관찰된다: 마케터의 역할이 실행자에서 "실험 인프라를 설계하는 아키텍트"로 이동한다는 정리. — [MOBIINSIDE 2026](https://www.mobiinside.co.kr/2026/03/31/2026-marketing-job-evolution/), [AB180](https://blog.ab180.co/posts/ai-crm-grow-with-braze-seoul-2026-part1)
- 회의적 근거도 기록한다: 기업 GenAI 프로젝트의 95%가 기대에 미달하고, 2024년 AI 환각으로 인한 손실은 674억 달러로 추산된다. 속도가 아니라 거버넌스 성숙도가 승부처라는 반론이다. — [MIT/Capgemini](https://www.capgemini.com/insights/research-library/from-pilots-to-real-impact-how-enterprises-actually-scale-agentic-ai/), [AdAge](https://adage.com/events-awards/aa-5-ai-brand-fails-and-lessons-for-marketers/)

## 5. UX MeasureLab에 주는 함의

### 채택한다

1. **실험의 단위를 함대로 확장** — 하나의 가설 공간에 N개 변형을 사전 등록하고, 웨이브 단위로 컷·승급하는 구조. successive halving은 결정적 알고리즘이라 본 제품의 "코드가 계산한다" 원칙과 정합한다. — [arXiv batch sequential halving](https://arxiv.org/html/2406.00424v1)
2. **정책 사전 등록** — 성공/실패 threshold, 변형별 최소 표본, 표본 예산, 동시 상한, 생존 비율, guardrail, 종료 규칙을 함대 단위로 한 번에 등록. 사람의 역할 이동(변형 선택 → 정책 설계)을 제품 구조로 만든다.
3. **guardrail 우선 컷과 예산 투명성** — 업계 완화책 중 사전 등록 가능한 것만 채택한다.

### 거부한다

1. **블랙박스 밴딧 판정** — Thompson Sampling류 확률 배분은 재현 불가능하고 감사가 어렵다. 본 제품의 차별점은 결정적·감사 가능한 판정이다(경쟁 조사 결과 이 조합을 제공하는 상용 도구는 없다).
2. **AI가 승자를 선언** — AI는 변형 후보만 제안하고(기존 AI trust boundary 규칙 그대로), 승격 후보 산출은 결정적 코드, 최종 결정은 사람이 기록한다.
3. **p-value 흉내** — 기존 원칙 유지. practical threshold + 표본·기간 규율로 판정하고, 통계적 유의성을 자동 판정하지 않는다.

### 미해결 (후속 리서치)

- 다중 비교 위험을 practical threshold 체계 안에서 어떻게 표시할지 (FDR을 계산하지 않으면서 "N개 중 K개가 기준을 넘음"의 한계를 정직하게 병기하는 방법).
- holdout 변형의 사전 등록 지원 여부.
- novelty 감쇠를 웨이브 기간 규칙으로 흡수할 수 있는지.
