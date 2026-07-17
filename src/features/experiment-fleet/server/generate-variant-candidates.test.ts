import assert from "node:assert/strict";
import test from "node:test";
import type { AiVariantRequestV1 } from "../lib/ai-variants.ts";
import { generateVariantCandidates } from "./generate-variant-candidates.ts";

function makeRequest(): AiVariantRequestV1 {
  return {
    schemaVersion: 1,
    task: "fleet_variants",
    context: { productName: "UX MeasureLab", audience: "빌더", valueAction: "리포트 생성", goal: "완료율 개선" },
    metric: { id: "m1", name: "완료율", definition: "시작 대비 완료 비율" },
    hypothesis: { change: "진입 문구를 행동 중심으로 바꾼다", expectedBehavior: "결제 진입이 늘어날 가능성", guardrailMetric: "환불 요청률" },
    evidence: [{ id: "e1", sourceKind: "calculated", direction: "supports", observation: "결제 진입 전 이탈이 관찰되었다." }],
    candidateCount: 3,
  };
}

function modelResponse(payload: unknown): Response {
  return Response.json({ output_text: JSON.stringify(payload) });
}

test("FLEET-AI-004 falls back deterministically when no provider key is configured", async () => {
  const result = await generateVariantCandidates(makeRequest(), {});
  assert.equal(result.source, "deterministic");
  assert.equal(result.fallbackReason, "not_configured");
  assert.equal(result.suggestion.candidates.length, 1);
});

test("FLEET-AI-005 returns validated model candidates and never trusts raw provider output", async () => {
  const good = await generateVariantCandidates(makeRequest(), {
    apiKey: "key",
    request: async () => modelResponse({
      candidates: [
        { name: "행동 문구", changeDescription: "진입 버튼 문구를 행동 중심으로 바꾼다", evidenceIds: ["e1"] },
        { name: "배너 정리", changeDescription: "진입 화면의 배너를 줄인다", evidenceIds: ["e1"] },
      ],
    }),
  });
  assert.equal(good.source, "model");
  assert.equal(good.suggestion.candidates.length, 2);

  const forgedNumbers = await generateVariantCandidates(makeRequest(), {
    apiKey: "key",
    request: async () => modelResponse({
      candidates: [{ name: "행동 문구", changeDescription: "전환율 3pp 상승 문구", evidenceIds: ["e1"] }],
    }),
  });
  assert.equal(forgedNumbers.source, "deterministic");
  assert.equal(forgedNumbers.fallbackReason, "invalid_output");

  const providerDown = await generateVariantCandidates(makeRequest(), {
    apiKey: "key",
    request: async () => new Response(null, { status: 500 }),
  });
  assert.equal(providerDown.source, "deterministic");
  assert.equal(providerDown.fallbackReason, "provider_error");
});
