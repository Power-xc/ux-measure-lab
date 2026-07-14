import assert from "node:assert/strict";
import test from "node:test";
import { createProject, type MetricDefinition, type ProjectContext, type WorkspaceState } from "../../entities/project/model.ts";
import {
  createEmptyWorkspace,
  exportWorkspace,
  importWorkspace,
  loadWorkspace,
  WORKSPACE_BACKUP_KEY,
  WORKSPACE_STORAGE_KEY,
  type StorageLike,
} from "../../shared/lib/project-repository.ts";
import {
  parseNormalizedMeasurement,
  SOURCE_CAPABILITIES,
  type NormalizedMeasurement,
  type SourceAdapter,
  type SourceAdapterMeta,
} from "./contract.ts";

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

function baseWorkspace(): WorkspaceState {
  return createProject(createEmptyWorkspace(), { id: "p1", name: "First", now: "2026-07-14T00:00:00.000Z", context });
}

function workspaceWithSourceRef(): WorkspaceState {
  const workspace = baseWorkspace();
  const metric: MetricDefinition = {
    id: "m1",
    name: "마찰 신호율",
    definition: "연동 선택 화면의 rage click 비율",
    formula: "rage click 세션 / 화면 진입 세션 × 100",
    window: "최근 7일",
    sourceKind: "measured",
    status: "confirmed",
  };
  workspace.projects[0] = {
    ...workspace.projects[0],
    metric,
    funnelImport: {
      fileName: "harness-measurement",
      source: "adapter",
      importedAt: "2026-07-14T00:00:00.000Z",
      steps: [{ id: "enter", label: "화면 진입", users: 200 }, { id: "select", label: "연동 선택", users: 120 }],
    },
    evidence: [{
      id: "e1",
      sourceKind: "measured",
      direction: "supports",
      observation: "연동 선택 화면에서 rage click 표본이 관찰됐다.",
      detail: "harness interaction 측정",
      provenance: { source: "first-party", observedAt: "2026-07-14T00:00:00.000Z", period: "최근 7일", segment: "전체 사용자" },
      sourceRef: { adapterId: "first-party", capability: "interaction", queryHash: "qh-interaction-1", sampleSize: 42, confidence: "medium" },
    }],
    frictionCandidate: {
      phenomenon: "연동 선택 화면 마찰",
      relatedEvidenceIds: ["e1"],
      possibleCauses: ["선택지 라벨 모호"],
      strength: "medium",
      strengthRationale: "정량 신호 1개",
      missingEvidence: "세션 맥락",
      recommendedValidation: "세션 표본 관찰",
    },
  };
  return workspace;
}

const validMeasurement: NormalizedMeasurement = {
  metricLabel: "가입 퍼널 전환",
  observation: "랜딩에서 가입까지 24.6%가 전환했다.",
  sourceKind: "calculated",
  direction: "supports",
  values: { totalConversion: 24.6, largestDropOffPp: 47 },
  provenance: {
    adapterId: "first-party",
    capability: "funnel",
    source: "first-party",
    observedAt: "2026-07-14T00:00:00.000Z",
    period: "최근 7일",
    window: { from: "2026-07-07T00:00:00.000Z", to: "2026-07-14T00:00:00.000Z" },
    segment: "전체 사용자",
    queryHash: "qh-funnel-1",
  },
  confidence: { level: "medium", sampleSize: 1280, basis: "7일·1,280세션", limits: "인과 아님, 관찰 구간 한정" },
};

test("HAC-01 migrates a v1 workspace losslessly and backs up the original", () => {
  const storage = new MemoryStorage();
  const base = baseWorkspace();
  const v1raw = JSON.stringify({ ...base, schemaVersion: 1 });
  storage.values.set(WORKSPACE_STORAGE_KEY, v1raw);

  const loaded = loadWorkspace(storage);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.workspace.schemaVersion, 2);
  assert.deepEqual(loaded.workspace, base);

  assert.equal(storage.getItem(WORKSPACE_BACKUP_KEY), v1raw);
  const persisted = storage.getItem(WORKSPACE_STORAGE_KEY);
  assert.ok(persisted);
  assert.equal(JSON.parse(persisted).schemaVersion, 2);
});

test("HAC-01 keeps rejecting future schema versions without touching storage", () => {
  const storage = new MemoryStorage();
  storage.values.set(WORKSPACE_STORAGE_KEY, '{"schemaVersion":3,"activeProjectId":null,"projects":[]}');

  const loaded = loadWorkspace(storage);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.error.code, "unsupported_version");
  assert.equal(storage.getItem(WORKSPACE_BACKUP_KEY), null);
});

test("CONTRACT round-trips a v2 workspace carrying a sourceRef evidence", () => {
  const workspace = workspaceWithSourceRef();
  const round = importWorkspace(exportWorkspace(workspace));
  assert.equal(round.ok, true);
  assert.deepEqual(round.workspace, workspace);
});

test("CONTRACT rejects a sourceRef with a non-positive sample size", () => {
  const forged = structuredClone(workspaceWithSourceRef());
  const ref = forged.projects[0].evidence[0].sourceRef;
  assert.ok(ref);
  ref.sampleSize = 0;
  assert.equal(importWorkspace(JSON.stringify(forged)).ok, false);
});

test("CONTRACT rejects a sourceRef with an unknown capability", () => {
  const forged = structuredClone(workspaceWithSourceRef());
  const evidence = forged.projects[0].evidence[0] as { sourceRef: { capability: string } };
  evidence.sourceRef.capability = "heatmap";
  assert.equal(importWorkspace(JSON.stringify(forged)).ok, false);
});

test("CONTRACT parseNormalizedMeasurement accepts a fully valid measurement", () => {
  const parsed = parseNormalizedMeasurement(validMeasurement);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok ? parsed.value : null, validMeasurement);
});

test("CONTRACT parseNormalizedMeasurement rejects unknown and missing fields", () => {
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, hacked: true }).ok, false);
  const { metricLabel, observation, sourceKind, direction, values, provenance } = validMeasurement;
  assert.equal(parseNormalizedMeasurement({ metricLabel, observation, sourceKind, direction, values, provenance }).ok, false);
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, provenance: { ...validMeasurement.provenance, extra: 1 } }).ok, false);
});

test("CONTRACT parseNormalizedMeasurement rejects forged numeric values", () => {
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, values: { totalConversion: "24.6" } }).ok, false);
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, values: { totalConversion: Number.NaN } }).ok, false);
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, values: { totalConversion: Number.POSITIVE_INFINITY } }).ok, false);
});

test("CONTRACT parseNormalizedMeasurement rejects invalid enums and timestamps", () => {
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, sourceKind: "bogus" }).ok, false);
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, direction: "causes" }).ok, false);
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, confidence: { ...validMeasurement.confidence, level: "certain" } }).ok, false);
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, provenance: { ...validMeasurement.provenance, observedAt: "2026-07-14" } }).ok, false);
  assert.equal(parseNormalizedMeasurement({ ...validMeasurement, provenance: { ...validMeasurement.provenance, window: { from: "2026-07-07T00:00:00.000Z" } } }).ok, false);
});

test("CONTRACT SourceAdapter routes only on declared capabilities", () => {
  const meta: SourceAdapterMeta = {
    adapterId: "first-party",
    displayName: "UX MeasureLab SDK",
    kind: "first_party",
    access: "read_write",
    region: "self",
    capabilities: ["funnel", "events", "paths", "interaction", "sessions"],
  };
  assert.equal(meta.capabilities.every((capability) => SOURCE_CAPABILITIES.includes(capability)), true);

  const adapter: SourceAdapter = {
    meta: () => meta,
    supports: (capability) => meta.capabilities.includes(capability),
    measure: () => Promise.resolve({ ok: false, code: "not_configured", message: "stub" }),
  };
  assert.equal(adapter.supports("interaction"), true);
  assert.equal(adapter.supports("recordings"), false);
});
