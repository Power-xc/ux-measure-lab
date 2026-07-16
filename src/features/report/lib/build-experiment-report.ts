import type { FleetState } from "../../../entities/fleet/model.ts";
import type { Project } from "../../../entities/project/model.ts";
import { isProjectStateConsistent } from "../../../shared/lib/project-invariants.ts";

export type ReportResult =
  | { ok: true; markdown: string }
  | { ok: false; missing: string[] };

function missingSections(project: Project): string[] {
  const missing: string[] = [];
  if (!project.metric) missing.push("metric");
  if (!project.funnelImport) missing.push("funnel");
  if (!project.hypothesis) missing.push("hypothesis");
  if (!project.experiment) missing.push("experiment");
  if (!project.experimentResult) missing.push("result");
  if (!project.decision) missing.push("decision");
  return missing;
}

function markdownText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const inlineSafe = normalized.replace(/[\\`*_[\]{}<>|!]/g, "\\$&");
  if (/^\d{1,9}[.)]/.test(normalized)) {
    return inlineSafe.replace(/^(\d{1,9})([.)])/, "$1\\$2");
  }
  if (/^(?:#{1,6}|>|[-+]|~{3,}|=+)/.test(normalized)) {
    return `\\${inlineSafe}`;
  }
  return inlineSafe;
}

// 웨이브가 없는 함대는 리포트에 결론이 없으므로 싣지 않는다.
function fleetSection(fleet: FleetState | undefined): string[] {
  if (!fleet || fleet.waves.length === 0) return [];
  const policy = fleet.plan.policy;
  const names = new Map(fleet.plan.variants.map((variant) => [variant.id, variant.name]));
  const waves = fleet.waves.map((record) => {
    const candidate = record.result.promotionCandidateId;
    const candidateLabel = candidate ? markdownText(names.get(candidate) ?? candidate) : "없음";
    return `- Wave ${record.input.wave}: 승급 ${record.result.advanced.length} · 컷 ${record.result.culled.length} · 재수집 ${record.result.needsSample.length} · 승격 후보 ${candidateLabel} · 잔여 예산 ${record.result.sampleBudgetRemaining.toLocaleString("ko-KR")}`;
  });
  return [
    "## Experiment fleet",
    `- Variants: ${fleet.plan.variants.length} · Success: +${policy.successThresholdPp}pp · Keep share: ${policy.keepShare} · Max active: ${policy.maxActiveVariants} · Budget: ${policy.sampleBudget.toLocaleString("ko-KR")}`,
    `- Guardrail: ${markdownText(policy.guardrailMetricName)} +${policy.maxGuardrailIncreasePp}pp 이하`,
    ...waves,
    "- 주의: 웨이브 판정은 보정 없는 다중 비교이며, 개별 변형의 기준 충족은 후보 선별 신호입니다.",
    "",
  ];
}

export function buildExperimentReport(project: Project): ReportResult {
  if (!isProjectStateConsistent(project)) return { ok: false, missing: ["inconsistent_state"] };
  const missing = missingSections(project);
  if (missing.length > 0) return { ok: false, missing };
  const metric = project.metric;
  const funnel = project.funnelImport;
  const hypothesis = project.hypothesis;
  const experiment = project.experiment;
  const result = project.experimentResult;
  const decision = project.decision;
  if (!metric || !funnel || !hypothesis || !experiment || !result || !decision) return { ok: false, missing: missingSections(project) };

  const evidence = project.evidence.map((item) => `- [${item.sourceKind}] ${markdownText(item.observation)} — ${markdownText(item.provenance.source)}`).join("\n");
  const funnelRows = funnel.steps.map((step) => `| ${markdownText(step.label)} | ${step.users.toLocaleString("ko-KR")} |`).join("\n");
  const evaluation = result.evaluation;
  const markdown = [
    `# ${markdownText(project.name)} — Experiment Report`,
    "",
    `- Product: ${markdownText(project.context.productName)}`,
    `- Goal: ${markdownText(project.context.goal)}`,
    `- Data source: ${markdownText(funnel.fileName)}`,
    `- Recorded: ${result.recordedAt}`,
    "",
    "## KPI",
    `${markdownText(metric.name)} — ${markdownText(metric.definition)}`,
    "",
    "## Funnel",
    "| Step | Users |",
    "|---|---:|",
    funnelRows,
    "",
    "## Evidence",
    evidence,
    "",
    "## Hypothesis",
    `- Observation: ${markdownText(hypothesis.observation)}`,
    `- Change: ${markdownText(hypothesis.change)}`,
    `- Expected behavior: ${markdownText(hypothesis.expectedBehavior)}`,
    `- Alternative explanation: ${markdownText(hypothesis.alternativeExplanation)}`,
    `- Missing evidence: ${markdownText(hypothesis.missingEvidence)}`,
    "",
    "## Preregistered criteria",
    `- Success: +${experiment.successThresholdPp}pp`,
    `- Failure: ${experiment.failureThresholdPp}pp 이하`,
    `- Guardrail: ${markdownText(experiment.guardrailMetricName)} +${experiment.maxGuardrailIncreasePp}pp 이하`,
    `- Stop rule: ${markdownText(experiment.stopRule)}`,
    "",
    "## Result",
    `- Baseline: ${evaluation.baselineRate}%`,
    `- Variant: ${evaluation.variantRate}%`,
    `- Absolute delta: ${evaluation.absoluteDeltaPp}pp`,
    `- Guardrail: ${evaluation.guardrailOutcome}`,
    `- Deterministic verdict: ${evaluation.verdict}`,
    "",
    ...fleetSection(project.fleet),
    "## Decision",
    `- System recommendation: ${markdownText(decision.aiRecommendation)}`,
    `- Human decision: ${decision.humanDecision}`,
    `- Rationale: ${markdownText(decision.rationale)}`,
    `- Next action: ${markdownText(decision.nextAction)}`,
    "",
  ].join("\n");
  return { ok: true, markdown };
}
