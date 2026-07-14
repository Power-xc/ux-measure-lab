import assert from "node:assert/strict";
import test from "node:test";
import type { Decision } from "../../entities/decision/model.ts";
import type { ExperimentPlan } from "../../entities/experiment/model.ts";
import { createProject, deleteProject, replaceProject, type MetricDefinition, type ProjectContext } from "../../entities/project/model.ts";
import { evaluateExperiment } from "../../features/experiment/lib/evaluate-experiment.ts";
import {
  createEmptyWorkspace,
  exportWorkspace,
  importWorkspace,
  loadWorkspace,
  saveWorkspace,
  WORKSPACE_STORAGE_KEY,
  type StorageLike,
} from "./project-repository.ts";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota");
    this.values.set(key, value);
  }
}

const context: ProjectContext = {
  productName: "UX MeasureLab",
  productUrl: "https://example.com",
  productStage: "beta",
  audience: "Product designers",
  valueAction: "첫 분석 리포트 생성",
  goal: "첫 리포트 생성률 개선",
};

function workspaceWithResult() {
  const workspace = createProject(createEmptyWorkspace(), { id: "p1", name: "First", now: "2026-07-14T00:00:00.000Z", context });
  const metric: MetricDefinition = {
    id: "m1",
    name: "완료율",
    definition: "시작 사용자 중 완료 사용자 비율",
    formula: "완료 / 시작 × 100",
    window: "최근 30일",
    sourceKind: "calculated",
    status: "confirmed",
  };
  const experiment: ExperimentPlan = {
    id: "x1",
    hypothesisId: "h1",
    primaryMetricId: metric.id,
    successThresholdPp: 3,
    failureThresholdPp: 0,
    minimumSampleSize: 100,
    plannedDays: 14,
    guardrailMetricName: "오류율",
    maxGuardrailIncreasePp: 1,
    stopRule: "14일과 각 variant 100명을 모두 충족",
    status: "decided",
  };
  const input = {
    baseline: { converted: 20, total: 100 },
    variant: { converted: 25, total: 100 },
    successThresholdPp: 3,
    failureThresholdPp: 0,
    minimumSampleSize: 100,
    plannedDays: 14,
    observedDays: 14,
    guardrail: {
      baseline: { converted: 2, total: 100 },
      variant: { converted: 2, total: 100 },
      maxIncreasePp: 1,
    },
  };
  const evaluation = evaluateExperiment(input);
  const decision: Decision = {
    id: "d1",
    verdict: evaluation.verdict,
    aiRecommendation: "기준을 충족했습니다.",
    humanDecision: "adopt",
    rationale: "사전 기준과 guardrail을 충족했습니다.",
    nextAction: "점진적으로 적용합니다.",
    evidenceIds: ["e1"],
    decidedAt: "2026-07-14T00:00:00.000Z",
  };
  workspace.projects[0] = {
    ...workspace.projects[0],
    metric,
    funnelImport: {
      fileName: "funnel.csv",
      source: "csv",
      importedAt: "2026-07-14T00:00:00.000Z",
      steps: [{ id: "start", label: "시작", users: 100 }, { id: "done", label: "완료", users: 70 }],
    },
    evidence: [{
      id: "e1",
      sourceKind: "calculated",
      direction: "supports",
      observation: "완료 전 30명이 이탈했다.",
      detail: "퍼널 관찰",
      provenance: { source: "funnel.csv", observedAt: "2026-07-14T00:00:00.000Z", period: "30일", segment: "전체" },
    }],
    frictionCandidate: {
      phenomenon: "완료 전 이탈",
      relatedEvidenceIds: ["e1"],
      possibleCauses: ["정보 부담"],
      strength: "medium",
      strengthRationale: "정량 신호 1개",
      missingEvidence: "행동 관찰",
      recommendedValidation: "사용성 테스트",
    },
    hypothesis: {
      id: "h1",
      observation: "완료 전 이탈",
      change: "입력 항목 축소",
      expectedBehavior: "완료율 증가",
      primaryMetricId: metric.id,
      guardrailMetric: "오류율",
      alternativeExplanation: "유입 의도 차이",
      missingEvidence: "행동 관찰",
      evidenceIds: ["e1"],
      status: "ready",
    },
    experiment,
    experimentResult: { input, evaluation, recordedAt: "2026-07-14T00:00:00.000Z" },
    decision,
  };
  return workspace;
}

test("STORAGE-001 creates, persists and reloads multiple projects", () => {
  const storage = new MemoryStorage();
  const empty = createEmptyWorkspace();
  const first = createProject(empty, { id: "p1", name: "First", now: "2026-07-14T00:00:00.000Z", context });
  const second = createProject(first, { id: "p2", name: "Second", now: "2026-07-14T01:00:00.000Z", context: { ...context, productName: "Second" } });

  assert.equal(saveWorkspace(storage, second).ok, true);
  const loaded = loadWorkspace(storage);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.workspace.projects.length, 2);
  assert.equal(loaded.workspace.activeProjectId, "p2");
});

test("STORAGE-002 reports corrupted storage without overwriting it", () => {
  const storage = new MemoryStorage();
  storage.values.set(WORKSPACE_STORAGE_KEY, "{broken");

  const result = loadWorkspace(storage);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_json");
  assert.equal(result.workspace.projects.length, 0);
  assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), "{broken");
});

test("STORAGE-003 validates exported JSON before import", () => {
  const workspace = createProject(createEmptyWorkspace(), {
    id: "p1",
    name: "First",
    now: "2026-07-14T00:00:00.000Z",
    context,
  });
  const roundTrip = importWorkspace(exportWorkspace(workspace));
  assert.equal(roundTrip.ok, true);
  assert.deepEqual(roundTrip.workspace, workspace);

  const wrongVersion = importWorkspace('{"schemaVersion":2,"activeProjectId":null,"projects":[]}');
  assert.equal(wrongVersion.ok, false);
  assert.equal(wrongVersion.error.code, "unsupported_version");

  const invalidContext = importWorkspace(JSON.stringify({
    ...workspace,
    projects: [{ ...workspace.projects[0], context: { ...context, goal: 42 } }],
  }));
  assert.equal(invalidContext.ok, false);
  assert.equal(invalidContext.error.code, "invalid_schema");
});

test("STORAGE-004 rejects duplicate projects and an invalid active project", () => {
  const workspace = createProject(createEmptyWorkspace(), {
    id: "p1",
    name: "First",
    now: "2026-07-14T00:00:00.000Z",
    context,
  });
  const duplicate = importWorkspace(JSON.stringify({ ...workspace, projects: [workspace.projects[0], workspace.projects[0]] }));
  assert.equal(duplicate.ok, false);

  const missingActive = importWorkspace(JSON.stringify({ ...workspace, activeProjectId: "missing" }));
  assert.equal(missingActive.ok, false);
});

test("STORAGE-005 surfaces storage write failures", () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  const result = saveWorkspace(storage, createEmptyWorkspace());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_write_failed");
});

test("STORAGE-006 selects a valid project after deleting the active one", () => {
  const first = createProject(createEmptyWorkspace(), { id: "p1", name: "First", now: "2026-07-14T00:00:00.000Z", context });
  const second = createProject(first, { id: "p2", name: "Second", now: "2026-07-14T01:00:00.000Z", context });
  const remaining = deleteProject(second, "p2");

  assert.equal(remaining.projects.length, 1);
  assert.equal(remaining.activeProjectId, "p1");
});

test("STORAGE-007 rejects impossible counts and a forged evaluation", () => {
  const workspace = workspaceWithResult();
  assert.equal(importWorkspace(JSON.stringify(workspace)).ok, true);

  const impossible = structuredClone(workspace);
  const result = impossible.projects[0].experimentResult;
  assert.ok(result);
  result.input.baseline.converted = 101;
  assert.equal(importWorkspace(JSON.stringify(impossible)).ok, false);

  const forged = structuredClone(workspace);
  const forgedResult = forged.projects[0].experimentResult;
  assert.ok(forgedResult);
  forgedResult.evaluation.verdict = "not_supported";
  assert.equal(importWorkspace(JSON.stringify(forged)).ok, false);
});

test("STORAGE-008 rejects unsafe URLs, invalid funnels and broken workflow references", () => {
  const workspace = workspaceWithResult();
  const unsafeUrl = structuredClone(workspace);
  unsafeUrl.projects[0].context.productUrl = "javascript:alert(1)";
  assert.equal(importWorkspace(JSON.stringify(unsafeUrl)).ok, false);

  const invalidFunnel = structuredClone(workspace);
  const funnel = invalidFunnel.projects[0].funnelImport;
  assert.ok(funnel);
  funnel.steps[1].users = 120;
  assert.equal(importWorkspace(JSON.stringify(invalidFunnel)).ok, false);

  const brokenReference = structuredClone(workspace);
  const experiment = brokenReference.projects[0].experiment;
  assert.ok(experiment);
  experiment.primaryMetricId = "missing";
  assert.equal(importWorkspace(JSON.stringify(brokenReference)).ok, false);

  const mismatchedDecision = structuredClone(workspace);
  const decision = mismatchedDecision.projects[0].decision;
  assert.ok(decision);
  decision.verdict = "not_supported";
  assert.equal(importWorkspace(JSON.stringify(mismatchedDecision)).ok, false);

  const draftMetric = structuredClone(workspace);
  const metric = draftMetric.projects[0].metric;
  assert.ok(metric);
  metric.status = "draft";
  assert.equal(importWorkspace(JSON.stringify(draftMetric)).ok, false);

  const evidenceFree = structuredClone(workspace);
  evidenceFree.projects[0].evidence = [];
  const friction = evidenceFree.projects[0].frictionCandidate;
  const hypothesis = evidenceFree.projects[0].hypothesis;
  const evidenceFreeDecision = evidenceFree.projects[0].decision;
  assert.ok(friction && hypothesis && evidenceFreeDecision);
  friction.relatedEvidenceIds = [];
  hypothesis.evidenceIds = [];
  evidenceFreeDecision.evidenceIds = [];
  assert.equal(importWorkspace(JSON.stringify(evidenceFree)).ok, false);
});

test("STORAGE-009 preserves project identity during replacement", () => {
  const workspace = createProject(createEmptyWorkspace(), { id: "p1", name: "First", now: "2026-07-14T00:00:00.000Z", context });
  assert.throws(() => replaceProject(workspace, "p1", { ...workspace.projects[0], id: "p2" }), /ID/);
  const updated = replaceProject(workspace, "p1", { ...workspace.projects[0], name: "Updated" });
  assert.equal(updated.projects[0].id, "p1");
  assert.equal(updated.projects[0].name, "Updated");
});
