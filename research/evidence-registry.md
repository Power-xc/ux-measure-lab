# Evidence registry

## Evidence status

| ID | Claim | Status | Product implication | Required follow-up |
|---|---|---|---|---|
| E-001 | A North Star Metric should represent delivered customer value rather than passive activity. | Supported directionally | KPI suggestions require a stated value action. | Register a primary framework source. |
| E-002 | Activation candidates should be tested for association with later retention. | Supported directionally | Activation remains a candidate until cohort analysis confirms it. | Define the validation query and minimum observation window. |
| E-003 | Behavioral signals such as rage clicks are observations with multiple explanations. | Supported directionally | Signal cards must include alternatives and corroborating evidence. | Verify vendor detection definitions. |
| E-004 | Small-traffic products often cannot rely on conventional fixed-horizon A/B tests. | Supported directionally | Recommend qualitative and pretotype methods before A/B testing. | Register experimentation literature and decision thresholds. |
| E-005 | AI confidence is commonly miscalibrated. | Supported directionally | Avoid direct self-reported probability in the MVP. | Register calibration papers and evaluation methods. |
| E-006 | Product analytics, replay, experimentation, and research tools leave workflow gaps between observation and decision. | Product hypothesis | Position UX MeasureLab as a decision layer. | Validate through user interviews and workflow tests. |
| E-007 | Personal and company project memories require separate boundaries. | Strong design requirement | Use workspace-scoped storage and authorization. | Validate retention and deletion requirements. |

## Claims not safe to operationalize yet

| ID | Research-summary claim | Risk | Current decision |
|---|---|---|---|
| A-001 | Behavioral signals require a universal 30-100 session minimum. | Threshold varies by base rate, event, segment, and decision risk. | Do not hard-code a minimum. Show counts and evidence quality. |
| A-002 | Bayesian probability above 90% is enough for a positive decision. | Loss, prior, effect size, and stopping rules are missing. | Require an explicit decision policy per experiment. |
| A-003 | Low traffic justifies relaxing significance to p < 0.1. | Raises false-positive risk and does not solve low information. | Do not recommend by default. |
| A-004 | Confidence 68% can be derived from p < 0.05. | p-values do not map to claim confidence that way. | Use ordinal confidence with rationale. |
| A-005 | RAG prevents hallucination. | Retrieval improves grounding but does not guarantee correctness. | Validate citations and calculations independently. |
| A-006 | Causal AI can infer causes from logs. | Observational data alone does not establish causality. | Use causal language only with an appropriate design. |
| A-007 | Session-replay consent behavior is consistent across named vendors and regions. | Vendor capabilities and law change. | Verify current official docs and regulator sources before implementation. |

## Immediate research backlog

1. Retrieve the missing bibliography for the initial research summary.
2. Verify current PostHog read APIs, auth model, rate limits, and export capabilities.
3. Verify current Clarity export and consent behavior.
4. Build an experiment-method decision matrix for low-traffic products.
5. Define a source-quality rubric and evidence freshness policy.
6. Interview five individual builders about their last real product decision.
