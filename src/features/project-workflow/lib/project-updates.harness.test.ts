import assert from "node:assert/strict";
import test from "node:test";
import type { Evidence, Project } from "../../../entities/project/model.ts";
import { isProjectStateConsistent } from "../../../shared/lib/project-invariants.ts";
import { applyHarnessEvidence } from "./project-updates.ts";

function project(): Project {
  const now = "2026-07-15T00:00:00.000Z";
  return {
    id: "p1",
    name: "Harness",
    createdAt: now,
    updatedAt: now,
    context: {
      productName: "Harness",
      productUrl: "https://example.com",
      productStage: "beta",
      audience: "제품 팀",
      valueAction: "리포트 생성",
      goal: "활성화 개선",
    },
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

function evidence(): Evidence {
  return {
    id: "e1",
    sourceKind: "calculated",
    direction: "context",
    observation: "가입 사용자의 활성화 도달률은 50%입니다.",
    detail: "여정 도달률 · reachedUsers=50, startedUsers=100 · 인과관계를 나타내지 않습니다.",
    provenance: {
      source: "UX MeasureLab Events",
      observedAt: "2026-07-15T00:00:00.000Z",
      period: "2026-07-01 ~ 2026-07-08",
      segment: "전체 사용자",
    },
    sourceRef: {
      adapterId: "first-party",
      capability: "paths",
      queryHash: "query-hash",
      sampleSize: 100,
      confidence: "medium",
    },
  };
}

test("HAC-10 applies harness Evidence explicitly and invalidates descendants", () => {
  const current = project();
  const derived: Evidence = { ...evidence(), id: "derived" };
  delete derived.sourceRef;
  const applied = applyHarnessEvidence({
    ...current,
    evidence: [derived],
    frictionCandidate: {
      phenomenon: "가입 중 이탈",
      relatedEvidenceIds: [derived.id],
      possibleCauses: ["입력 부담"],
      strength: "low",
      strengthRationale: "퍼널 관찰 1건",
      missingEvidence: "상호작용 신호",
      recommendedValidation: "추가 측정",
    },
  }, [evidence()], "2026-07-15T01:00:00.000Z");
  assert.equal(current.evidence.length, 0);
  assert.equal(applied.evidence.length, 1);
  assert.equal(applied.evidence.some((item) => item.id === derived.id), false);
  assert.equal(applied.evidence[0].sourceRef?.queryHash, "query-hash");
  assert.equal(applied.frictionCandidate, null);
  assert.equal(isProjectStateConsistent(applied), true);
});

test("harness Evidence rejects zero samples and deduplicates the same result", () => {
  const item = evidence();
  const once = applyHarnessEvidence(project(), [item, { ...item }], "2026-07-15T01:00:00.000Z");
  assert.equal(once.evidence.length, 1);
  assert.equal(applyHarnessEvidence(once, [{
    ...item,
    observation: "가입 사용자의 활성화 도달률은 60%입니다.",
    detail: "여정 도달률 · reachedUsers=60, startedUsers=100 · 인과관계를 나타내지 않습니다.",
  }], "2026-07-15T02:00:00.000Z"), once);
  const multiple = applyHarnessEvidence(once, [{ ...item, id: "e3", detail: "오류 클릭 · sampleSize=100, signalCount=2 · 인과관계를 나타내지 않습니다." }], "2026-07-15T02:00:00.000Z");
  assert.equal(multiple.evidence.length, 2);
  assert.throws(() => applyHarnessEvidence(project(), [{
    ...item,
    sourceRef: { ...item.sourceRef!, sampleSize: 0 },
  }], "2026-07-15T02:00:00.000Z"), /실제 표본/);
  assert.throws(
    () => applyHarnessEvidence({ ...project(), metric: null, funnelImport: null }, [item], "2026-07-15T02:00:00.000Z"),
    /KPI와 퍼널/,
  );
});
