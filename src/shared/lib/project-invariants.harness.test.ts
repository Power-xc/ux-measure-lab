import assert from "node:assert/strict";
import test from "node:test";
import type { Evidence, Project, WorkspaceState } from "../../entities/project/model.ts";
import { applyHarnessEvidence } from "../../features/project-workflow/lib/project-updates.ts";
import { isProjectStateConsistent } from "./project-invariants.ts";
import { saveWorkspace, type StorageLike } from "./project-repository.ts";

class MemoryStorage implements StorageLike {
  value: string | null = null;
  getItem(): string | null { return this.value; }
  setItem(_key: string, value: string): void { this.value = value; }
}

function emptyProject(): Project {
  const now = "2026-07-15T00:00:00.000Z";
  return {
    id: "harness-project",
    name: "Harness",
    createdAt: now,
    updatedAt: now,
    context: { productName: "Harness", productUrl: "", productStage: "beta", audience: "제품 팀", valueAction: "분석 완료", goal: "활성화 개선" },
    metric: { id: "m1", name: "활성화율", definition: "시작 사용자 중 완료 사용자 비율", formula: "완료 / 시작 × 100", window: "최근 7일", sourceKind: "calculated", status: "confirmed" },
    funnelImport: {
      fileName: "sample.csv",
      source: "sample",
      importedAt: now,
      steps: [{ id: "signup", label: "가입", users: 100 }, { id: "activate", label: "활성화", users: 50 }],
    },
    evidence: [],
    frictionCandidate: null,
    hypothesis: null,
    experiment: null,
    experimentResult: null,
    decision: null,
  };
}

function harnessEvidence(): Evidence {
  return {
    id: "harness-first-party-hash-0",
    sourceKind: "measured",
    direction: "context",
    observation: "가입 표본 100명이 관찰되었습니다.",
    detail: "가입 사용자 · sampleSize=100 · 인과관계를 나타내지 않습니다.",
    provenance: { source: "UX MeasureLab Events", observedAt: "2026-07-15T00:00:00.000Z", period: "7일", segment: "전체 사용자" },
    sourceRef: { adapterId: "first-party", capability: "interaction", queryHash: "hash", sampleSize: 100, confidence: "medium" },
  };
}

test("HAC-10 standalone harness Evidence remains consistent and persists", () => {
  const project = applyHarnessEvidence(emptyProject(), [harnessEvidence()], "2026-07-15T01:00:00.000Z");
  const workspace: WorkspaceState = { schemaVersion: 2, activeProjectId: project.id, projects: [project] };
  const storage = new MemoryStorage();

  assert.equal(isProjectStateConsistent(project), true);
  assert.equal(saveWorkspace(storage, workspace).ok, true);
  assert.match(storage.value ?? "", /harness-first-party-hash-0/);
});

test("standalone Evidence without a harness source remains inconsistent", () => {
  assert.equal(isProjectStateConsistent({ ...emptyProject(), evidence: [{ ...harnessEvidence(), sourceRef: undefined }] }), false);
  assert.equal(isProjectStateConsistent({ ...emptyProject(), metric: null, funnelImport: null, evidence: [harnessEvidence()] }), false);
});
