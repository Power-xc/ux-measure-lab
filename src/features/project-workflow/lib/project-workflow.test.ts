import assert from "node:assert/strict";
import test from "node:test";
import type { Decision } from "../../../entities/decision/model.ts";
import type { ExperimentPlan } from "../../../entities/experiment/model.ts";
import type { MetricDefinition, Project } from "../../../entities/project/model.ts";
import { createProject } from "../../../entities/project/model.ts";
import type { FleetPlan } from "../../../entities/fleet/model.ts";
import { buildDiagnosisFromFunnel } from "../../diagnosis/lib/build-diagnosis.ts";
import { evaluateExperiment } from "../../experiment/lib/evaluate-experiment.ts";
import { evaluateFleetWave } from "../../experiment-fleet/lib/evaluate-fleet-wave.ts";
import { parseFunnelCsv } from "../../funnel-import/lib/parse-funnel-csv.ts";
import { analyzeFunnel } from "../../measure-loop/lib/calculate-funnel.ts";
import { buildExperimentReport } from "../../report/lib/build-experiment-report.ts";
import { createEmptyWorkspace } from "../../../shared/lib/project-repository.ts";
import { getProjectProgress, validateExperimentPlan } from "./project-workflow.ts";
import {
  applyContext,
  applyExperiment,
  applyFunnel,
  applyHypothesis,
  applyMetric,
  applyResult,
} from "./project-updates.ts";

test("FLOW-001 completes the five-step golden scenario without AI", () => {
  const now = "2026-07-14T00:00:00.000Z";
  const workspace = createProject(createEmptyWorkspace(), {
    id: "dogfood",
    name: "UX MeasureLab Dogfood",
    now,
    context: {
      productName: "UX MeasureLab",
      productUrl: "https://example.com",
      productStage: "beta",
      audience: "Product designers",
      valueAction: "첫 분석 리포트 생성",
      goal: "첫 리포트 생성률 개선",
    },
  });
  const metric: MetricDefinition = {
    id: "first-report-rate",
    name: "첫 리포트 생성률",
    definition: "랜딩 방문자 중 첫 리포트를 생성한 사용자 비율",
    formula: "첫 리포트 생성 사용자 / 랜딩 방문 사용자 × 100",
    window: "최근 30일",
    sourceKind: "calculated",
    status: "confirmed",
  };
  const csv = "step_id,step_name,users\nlanding,랜딩 방문,2480\nsignup,가입 시작,1590\nconnect,데이터 연결,842\nreport,첫 리포트,611\nretain,7일 재방문,421";
  const parsed = parseFunnelCsv({ fileName: "dogfood.csv", mediaType: "text/csv", size: Buffer.byteLength(csv), text: csv });
  assert.equal(parsed.ok, true);
  const analysis = analyzeFunnel(parsed.steps);
  const diagnosis = buildDiagnosisFromFunnel({
    analysis,
    evidenceId: "e1",
    hypothesisId: "h1",
    primaryMetricId: metric.id,
    sourceName: "dogfood.csv",
    observedAt: now,
  });
  const experiment: ExperimentPlan = {
    id: "x1",
    hypothesisId: "h1",
    primaryMetricId: metric.id,
    successThresholdPp: 3,
    failureThresholdPp: 0,
    minimumSampleSize: 500,
    plannedDays: 14,
    guardrailMetricName: "연동 오류율",
    maxGuardrailIncreasePp: 1,
    stopRule: "14일 또는 각 variant 500명 도달 후 종료",
    status: "decided",
  };
  const evaluationInput = {
    baseline: { converted: 200, total: 1000 },
    variant: { converted: 240, total: 1000 },
    successThresholdPp: experiment.successThresholdPp,
    failureThresholdPp: experiment.failureThresholdPp,
    minimumSampleSize: experiment.minimumSampleSize,
    plannedDays: experiment.plannedDays,
    observedDays: 14,
    guardrail: {
      baseline: { converted: 20, total: 1000 },
      variant: { converted: 25, total: 1000 },
      maxIncreasePp: experiment.maxGuardrailIncreasePp,
    },
  };
  const evaluation = evaluateExperiment(evaluationInput);
  const decision: Decision = {
    id: "d1",
    verdict: evaluation.verdict,
    aiRecommendation: "실험 결과 요약을 참고해 제한적으로 적용을 검토하세요.",
    humanDecision: "adopt",
    rationale: "Primary metric이 사전 기준을 충족했고 guardrail도 통과했다.",
    nextAction: "신규 사용자 50%에 적용하고 7일 재방문을 관찰한다.",
    evidenceIds: ["e1"],
    decidedAt: now,
  };
  const project: Project = {
    ...workspace.projects[0],
    metric,
    funnelImport: { fileName: "dogfood.csv", source: "csv", importedAt: now, steps: parsed.steps },
    evidence: diagnosis.evidence,
    frictionCandidate: diagnosis.frictionCandidate,
    hypothesis: { ...diagnosis.hypothesis, status: "ready" },
    experiment,
    experimentResult: { input: evaluationInput, evaluation, recordedAt: now },
    decision,
  };

  assert.equal(analysis.largestDropOff?.id, "connect");
  assert.equal(diagnosis.evidence[0].sourceKind, "calculated");
  assert.equal(diagnosis.frictionCandidate.strength, "medium");
  assert.equal(getProjectProgress(project).completed, 8);
  const report = buildExperimentReport(project);
  assert.equal(report.ok, true);
  assert.match(report.markdown, /System recommendation/);
  assert.match(report.markdown, /Human decision/);
  assert.match(report.markdown, /dogfood\.csv/);
  assert.doesNotMatch(report.markdown, /Experiment fleet/);

  const fleetPlan: FleetPlan = {
    id: "fleet-1",
    name: "Dogfood 함대",
    primaryMetricId: metric.id,
    policy: {
      successThresholdPp: 2,
      failureThresholdPp: 0,
      minimumSampleSizePerVariant: 200,
      plannedDaysPerWave: 7,
      maxActiveVariants: 4,
      keepShare: 0.5,
      sampleBudget: 10000,
      guardrailMetricName: "연동 오류율",
      maxGuardrailIncreasePp: 1,
      stopRule: "웨이브 3회 완료 또는 예산 소진 시 종료",
    },
    variants: ["v-a", "v-b"].map((id) => ({
      id,
      name: `변형 ${id}`,
      changeDescription: "가입 진입 문구 변경",
      origin: "human" as const,
      relatedEvidenceIds: [],
      status: "active" as const,
    })),
    status: "running",
  };
  const waveInput = {
    wave: 1,
    baseline: { converted: 200, total: 1000 },
    observations: [
      { variantId: "v-a", variant: { converted: 96, total: 400 }, observedDays: 7 },
      { variantId: "v-b", variant: { converted: 88, total: 400 }, observedDays: 7 },
    ],
    sampleUsedBefore: 0,
  };
  const fleetProject: Project = {
    ...project,
    fleet: { plan: fleetPlan, waves: [{ recordedAt: now, input: waveInput, result: evaluateFleetWave({ ...waveInput, plan: fleetPlan }) }] },
  };
  const fleetReport = buildExperimentReport(fleetProject);
  assert.equal(fleetReport.ok, true);
  assert.match(fleetReport.markdown, /## Experiment fleet/);
  assert.match(fleetReport.markdown, /Wave 1: 승급 1 · 컷 1 · 재수집 0 · 승격 후보 변형 v-a/);
  assert.match(fleetReport.markdown, /보정 없는 다중 비교/);

  const hostileReport = buildExperimentReport({
    ...project,
    name: "Dogfood\n# Forged heading",
    context: { ...project.context, goal: ">Forged quote | <script>alert(1)</script>" },
    metric: { ...metric, name: "# Forged KPI" },
    funnelImport: {
      ...project.funnelImport!,
      steps: project.funnelImport!.steps.map((step, index) => index === 0 ? { ...step, label: "Landing | fake" } : step),
    },
    hypothesis: {
      ...project.hypothesis!,
      change: "- Forged list",
      expectedBehavior: "1. Forged ordered list",
      alternativeExplanation: "```forged fence",
      missingEvidence: "~~~forged fence",
    },
    decision: { ...decision, rationale: "[click](javascript:alert(1))\n# Forged decision heading" },
  });
  assert.equal(hostileReport.ok, true);
  assert.doesNotMatch(hostileReport.markdown, /^# Forged heading$/m);
  assert.doesNotMatch(hostileReport.markdown, /^# Forged KPI/m);
  assert.doesNotMatch(hostileReport.markdown, /^>Forged quote/m);
  assert.doesNotMatch(hostileReport.markdown, /^- Forged list/m);
  assert.doesNotMatch(hostileReport.markdown, /^1\. Forged ordered list/m);
  assert.doesNotMatch(hostileReport.markdown, /^```forged fence/m);
  assert.doesNotMatch(hostileReport.markdown, /^~~~forged fence/m);
  assert.ok(hostileReport.markdown.includes("\\# Forged KPI"));
  assert.ok(hostileReport.markdown.includes("\\>Forged quote"));
  assert.ok(hostileReport.markdown.includes("\\- Forged list"));
  assert.ok(hostileReport.markdown.includes("1\\. Forged ordered list"));
  assert.ok(hostileReport.markdown.includes("\\`\\`\\`forged fence"));
  assert.ok(hostileReport.markdown.includes("\\~~~forged fence"));
  assert.doesNotMatch(hostileReport.markdown, /<script>/);
  assert.doesNotMatch(hostileReport.markdown, /\[click\]\(javascript:/);
  assert.doesNotMatch(hostileReport.markdown, /\| Landing \| fake \|/);

  const later = "2026-07-15T00:00:00.000Z";
  assert.equal(applyMetric(project, { ...metric }, later).decision, decision);
  assert.equal(applyHypothesis(project, { ...project.hypothesis! }, later).decision, decision);
  assert.equal(applyExperiment(project, { ...experiment, status: "ready" }, later).decision, decision);
  assert.equal(applyResult(project, { ...project.experimentResult!, recordedAt: later }, later).decision, decision);

  const changedContext = applyContext(project, { ...project.context, goal: "다른 목표" }, later);
  assert.equal(changedContext.metric, null);
  assert.equal(changedContext.funnelImport, null);
  assert.equal(changedContext.decision, null);

  const changedMetric = applyMetric(project, { ...metric, definition: "새 정의" }, later);
  assert.equal(changedMetric.funnelImport, project.funnelImport);
  assert.equal(changedMetric.evidence.length, 0);
  assert.equal(changedMetric.decision, null);

  const changedFunnel = applyFunnel(project, { ...project.funnelImport!, fileName: "new.csv" }, later);
  assert.equal(changedFunnel.metric, metric);
  assert.equal(changedFunnel.hypothesis, null);

  const changedHypothesis = applyHypothesis(project, { ...project.hypothesis!, change: "다른 변경" }, later);
  assert.equal(changedHypothesis.experiment, null);
  assert.equal(changedHypothesis.decision, null);

  const changedExperiment = applyExperiment(project, { ...experiment, plannedDays: 21 }, later);
  assert.equal(changedExperiment.experimentResult, null);
  assert.equal(changedExperiment.decision, null);

  const changedInput = { ...evaluationInput, variant: { converted: 230, total: 1000 } };
  const changedResult = applyResult(project, { input: changedInput, evaluation: evaluateExperiment(changedInput), recordedAt: later }, later);
  assert.equal(changedResult.decision, null);
  assert.equal(changedResult.experiment?.status, "completed");
});

test("FLOW-002 blocks experiment registration when a required criterion is missing", () => {
  const result = validateExperimentPlan({
    id: "x1",
    hypothesisId: "h1",
    primaryMetricId: "m1",
    successThresholdPp: 3,
    failureThresholdPp: 0,
    minimumSampleSize: 500,
    plannedDays: 14,
    guardrailMetricName: "오류율",
    maxGuardrailIncreasePp: 1,
    stopRule: "",
    status: "ready",
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("종료 규칙을 입력하세요."));
});
