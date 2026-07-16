import assert from "node:assert/strict";
import test from "node:test";
import type { FleetPlan, FleetWaveRecord } from "../../../entities/fleet/model.ts";
import type { Project } from "../../../entities/project/model.ts";
import { evaluateFleetWave } from "../../experiment-fleet/lib/evaluate-fleet-wave.ts";
import { applyFleetPlan, applyFleetWave, fleetPlanChanged } from "./project-updates.ts";

function makeProject(): Project {
  return {
    id: "p1",
    name: "UX MeasureLab",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    context: {
      productName: "UX MeasureLab",
      productUrl: "https://example.com",
      productStage: "beta",
      audience: "빌더",
      valueAction: "리포트 생성",
      goal: "완료율 개선",
    },
    metric: {
      id: "m1",
      name: "완료율",
      definition: "시작 대비 완료 비율",
      formula: "완료 / 시작 × 100",
      window: "최근 30일",
      sourceKind: "calculated",
      status: "confirmed",
    },
    funnelImport: null,
    evidence: [],
    frictionCandidate: null,
    hypothesis: {
      id: "h1",
      observation: "완료 전 이탈",
      change: "진입 문구 개선",
      expectedBehavior: "완료율 증가",
      primaryMetricId: "m1",
      guardrailMetric: "환불 요청률",
      alternativeExplanation: "유입 의도 차이",
      missingEvidence: "행동 관찰",
      evidenceIds: ["e1"],
      status: "ready",
    },
    experiment: null,
    experimentResult: null,
    decision: null,
  };
}

function makePlan(): FleetPlan {
  return {
    id: "fleet-1",
    name: "진입 문구 함대",
    primaryMetricId: "m1",
    policy: {
      successThresholdPp: 2,
      failureThresholdPp: 0,
      minimumSampleSizePerVariant: 200,
      plannedDaysPerWave: 7,
      maxActiveVariants: 4,
      keepShare: 0.5,
      sampleBudget: 10000,
      guardrailMetricName: "환불 요청률",
      maxGuardrailIncreasePp: 0.5,
      stopRule: "웨이브 3회 완료 또는 예산 소진 시 종료",
    },
    variants: ["v-a", "v-b"].map((id) => ({
      id,
      name: `변형 ${id}`,
      changeDescription: "진입 문구 변경",
      origin: "ai_candidate" as const,
      relatedEvidenceIds: [],
      status: "active" as const,
    })),
    status: "running",
  };
}

function makeWaveRecord(plan: FleetPlan, wave: number, sampleUsedBefore: number): FleetWaveRecord {
  const input = {
    wave,
    baseline: { converted: 100, total: 1000 },
    observations: [
      { variantId: "v-a", variant: { converted: 56, total: 400 }, observedDays: 7 },
      { variantId: "v-b", variant: { converted: 52, total: 400 }, observedDays: 7 },
    ],
    sampleUsedBefore,
  };
  return { recordedAt: "2026-07-16T01:00:00.000Z", input, result: evaluateFleetWave({ ...input, plan }) };
}

const NOW = "2026-07-16T02:00:00.000Z";

test("FLEET-UPDATE-001 preregisters a plan and resets waves only when the plan actually changes", () => {
  const plan = makePlan();
  const withPlan = applyFleetPlan(makeProject(), plan, NOW);
  assert.deepEqual(withPlan.fleet, { plan, waves: [] });

  const withWave = applyFleetWave(withPlan, makeWaveRecord(plan, 1, 0), NOW);
  const samePlan = applyFleetPlan(withWave, makePlan(), NOW);
  assert.equal(samePlan.fleet?.waves.length, 1);

  const changed = makePlan();
  changed.policy.keepShare = 0.3;
  assert.equal(fleetPlanChanged(plan, changed), true);
  const reset = applyFleetPlan(withWave, changed, NOW);
  assert.equal(reset.fleet?.waves.length, 0);
});

test("FLEET-UPDATE-002 refuses preregistration without a confirmed KPI and ready hypothesis", () => {
  const noMetric = { ...makeProject(), metric: null };
  assert.throws(() => applyFleetPlan(noMetric, makePlan(), NOW), RangeError);

  const draftHypothesis = makeProject();
  assert.ok(draftHypothesis.hypothesis);
  draftHypothesis.hypothesis.status = "draft";
  assert.throws(() => applyFleetPlan(draftHypothesis, makePlan(), NOW), RangeError);

  const wrongMetric = makePlan();
  wrongMetric.primaryMetricId = "m2";
  assert.throws(() => applyFleetPlan(makeProject(), wrongMetric, NOW), RangeError);
});

test("FLEET-UPDATE-003 appends waves only when the number and sample chain continue", () => {
  const plan = makePlan();
  const project = applyFleetPlan(makeProject(), plan, NOW);
  assert.throws(() => applyFleetWave(makeProject(), makeWaveRecord(plan, 1, 0), NOW), RangeError);

  const first = makeWaveRecord(plan, 1, 0);
  const withWave = applyFleetWave(project, first, NOW);
  assert.equal(withWave.fleet?.waves.length, 1);

  assert.throws(() => applyFleetWave(withWave, makeWaveRecord(plan, 3, first.result.sampleUsed), NOW), RangeError);
  assert.throws(() => applyFleetWave(withWave, makeWaveRecord(plan, 2, 0), NOW), RangeError);

  const second = applyFleetWave(withWave, makeWaveRecord(plan, 2, first.result.sampleUsed), NOW);
  assert.equal(second.fleet?.waves.length, 2);
});
