# UX MeasureLab Dogfood Record

> 이 문서를 복사해 실제 Power-xc 제품 하나의 Measure Loop를 기록한다. 측정값과 가정을 섞지 않는다.

## 1. Project context

| Field | Value |
|---|---|
| Project |  |
| Product URL |  |
| Stage |  |
| Audience |  |
| Core value action |  |
| Product goal |  |
| Review date |  |

URL snapshot에서 실제로 적용한 정보와 수동으로 수정한 내용을 기록한다.

## 2. KPI contract

| Field | Value |
|---|---|
| KPI name |  |
| Definition |  |
| Formula |  |
| Window |  |
| Source kind | measured / calculated / benchmark / assumed / inferred / qualitative |
| Why this KPI |  |

## 3. Funnel source

```csv
step_id,step_name,users
```

| Field | Value |
|---|---|
| Source file/tool |  |
| Export period |  |
| Segment |  |
| Import time |  |
| Exclusions or caveats |  |

## 4. Observed signal

| Field | Value |
|---|---|
| Largest drop-off |  |
| Conversion/drop-off |  |
| Evidence ID |  |
| Provenance |  |
| What is observed |  |
| What is not yet known |  |

## 5. Friction candidate

- Phenomenon:
- Possible causes, stated as possibilities:
- Evidence supporting each candidate:
- Alternative explanation:
- Missing evidence:
- Recommended validation:
- AI advisory used: yes / no
- If used, what the human changed before applying:

## 6. Testable hypothesis

```text
If we change [design/product element],
then [user behavior] will change,
measured by [primary KPI],
while [guardrail] remains within [limit].
```

- Observation:
- Change:
- Expected behavior:
- Primary metric:
- Guardrail:
- Alternative explanation:
- Missing evidence:

## 7. Preregistration

| Field | Value |
|---|---|
| Success threshold |  pp |
| Failure threshold |  pp |
| Minimum sample per group |  |
| Planned duration |  days |
| Guardrail metric |  |
| Maximum guardrail increase |  pp |
| Stop rule |  |
| Registered at |  |

변경 전에는 이 섹션을 확정하고 이후 수정 사유를 별도로 남긴다.

## 8. Result

| Metric | Baseline | Variant | Delta |
|---|---:|---:|---:|
| Primary KPI |  /  |  /  |  pp |
| Guardrail |  /  |  /  |  pp |

- Observed duration:
- Code verdict: support / partial_support / not_supported / insufficient_evidence
- Segment or data caveat not represented in the app:
- Unexpected side effect:

## 9. Human decision

- Decision: adopt / iterate / stop / collect_more_data
- Rationale:
- Why this may differ from the system recommendation:
- Next action:
- Decision owner:
- Decision date:

## 10. Next loop

- New evidence needed:
- Next smallest experiment:
- Metric or guardrail to retain:
- What should not be generalized from this result:

## 11. Artifacts

- UX MeasureLab Markdown report:
- Workspace JSON backup:
- Source analytics export:
- Design before/after:
- Related issue or case study:
