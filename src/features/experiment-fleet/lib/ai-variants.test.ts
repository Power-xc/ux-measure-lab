import assert from "node:assert/strict";
import test from "node:test";
import type { Project } from "../../../entities/project/model.ts";
import {
  buildAiVariantRequest,
  buildDeterministicVariantCandidates,
  MAX_VARIANT_CANDIDATES,
  parseAiVariantRequest,
  parseAiVariantSuggestion,
  type AiVariantRequestV1,
} from "./ai-variants.ts";

function makeProject(): Project {
  return {
    id: "p1",
    name: "UX MeasureLab",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
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
    evidence: [{
      id: "e1",
      sourceKind: "calculated",
      direction: "supports",
      observation: "결제 진입 전 이탈이 관찰되었다.",
      detail: "퍼널 관찰",
      provenance: { source: "funnel.csv", observedAt: "2026-07-17T00:00:00.000Z", period: "30일", segment: "전체" },
    }],
    frictionCandidate: null,
    hypothesis: {
      id: "h1",
      observation: "결제 진입 전 이탈",
      change: "진입 문구를 행동 중심으로 바꾼다",
      expectedBehavior: "결제 진입이 늘어날 가능성",
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

function makeRequest(): AiVariantRequestV1 {
  const built = buildAiVariantRequest(makeProject(), 5);
  assert.ok(built);
  return built;
}

test("FLEET-AI-001 builds a bounded request only from a confirmed KPI and ready hypothesis", () => {
  const request = makeRequest();
  assert.equal(request.candidateCount, 5);
  assert.equal(parseAiVariantRequest(request).ok, true);

  assert.equal(buildAiVariantRequest({ ...makeProject(), metric: null }, 5), null);
  assert.equal(buildAiVariantRequest({ ...makeProject(), evidence: [] }, 5), null);
  assert.equal(buildAiVariantRequest(makeProject(), 0), null);
  assert.equal(buildAiVariantRequest(makeProject(), MAX_VARIANT_CANDIDATES + 1), null);

  const draftHypothesis = makeProject();
  assert.ok(draftHypothesis.hypothesis);
  draftHypothesis.hypothesis.status = "draft";
  assert.equal(buildAiVariantRequest(draftHypothesis, 5), null);
});

test("FLEET-AI-002 rejects candidates that smuggle numbers, verdicts or unknown evidence", () => {
  const allowed = ["e1"];
  const valid = { candidates: [{ name: "행동 문구", changeDescription: "진입 버튼 문구를 행동 중심으로 바꾼다", evidenceIds: ["e1"] }] };
  assert.equal(parseAiVariantSuggestion(valid, allowed, 5).ok, true);

  const numeric = { candidates: [{ name: "행동 문구", changeDescription: "전환율을 3pp 높이는 문구", evidenceIds: ["e1"] }] };
  assert.equal(parseAiVariantSuggestion(numeric, allowed, 5).ok, false);

  const verdict = { candidates: [{ name: "행동 문구", changeDescription: "이 변형을 채택하라", evidenceIds: ["e1"] }] };
  assert.equal(parseAiVariantSuggestion(verdict, allowed, 5).ok, false);

  const unknownEvidence = { candidates: [{ name: "행동 문구", changeDescription: "진입 문구 변경", evidenceIds: ["e9"] }] };
  assert.equal(parseAiVariantSuggestion(unknownEvidence, allowed, 5).ok, false);

  const duplicatedName = {
    candidates: [
      { name: "행동 문구", changeDescription: "진입 문구 변경", evidenceIds: ["e1"] },
      { name: "행동 문구", changeDescription: "배너 제거", evidenceIds: ["e1"] },
    ],
  };
  assert.equal(parseAiVariantSuggestion(duplicatedName, allowed, 5).ok, false);

  const overCount = { candidates: Array.from({ length: 6 }, (_, index) => ({ name: `후보 ${"가나다라마바".at(index)}`, changeDescription: "진입 문구 변경", evidenceIds: ["e1"] })) };
  assert.equal(parseAiVariantSuggestion(overCount, allowed, 5).ok, false);

  const unknownField = { candidates: [{ name: "행동 문구", changeDescription: "진입 문구 변경", evidenceIds: ["e1"], verdict: "support" }] };
  assert.equal(parseAiVariantSuggestion(unknownField, allowed, 5).ok, false);
});

test("FLEET-AI-003 deterministic fallback returns only the original hypothesis change", () => {
  const fallback = buildDeterministicVariantCandidates(makeRequest());
  assert.equal(fallback.candidates.length, 1);
  assert.equal(fallback.candidates[0].name, "가설 원안");
  assert.deepEqual(fallback.candidates[0].evidenceIds, ["e1"]);
  assert.equal(parseAiVariantSuggestion(fallback, ["e1"], 5).ok, true);
});
