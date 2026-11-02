// 네트워크 없이 harness 측정 성공 응답을 흉내 낸다 (e2e/harness.spec.ts와 같은 방식).
// 서버 코드의 해시 함수를 그대로 가져와 클라이언트의 provenance 검증을 통과시킨다.
const SRC = "../../src/features/harness";
const { parseMeasurementRequest } = await import(`${SRC}/lib/measurement-query.ts`);
const { createQueryHash, createConfidenceBand } = await import(`${SRC}/server/measure-service.ts`);

const ENTERED = 4200;
const COMPLETED = 430;
const SEGMENT_COUNTS = [
  { value: "baseline", entered: 1000, completed: 100 },
  { value: "v-1", entered: 400, completed: 56 },
  { value: "v-2", entered: 400, completed: 42 },
];
const reject = (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, code: "invalid_response", message: "invalid fixture" }) });

function provenance(parsed, capability, query, queryHash, segment) {
  return {
    adapterId: parsed.value.adapterId, capability, source: "UX MeasureLab Events", observedAt: "2026-07-15T00:00:00.000Z",
    period: `${query.window.from} ~ ${query.window.to}`, window: query.window, segment, queryHash,
  };
}

async function funnelOutcome(parsed, query) {
  const queryHash = await createQueryHash(query);
  return {
    ok: true, degraded: [],
    measurements: [{
      metricLabel: "퍼널 전환 및 이탈",
      observation: "첫 책 등록에서 첫 노트 작성 사이의 이탈률은 63.9%로 가장 크게 관찰되었습니다.",
      sourceKind: "calculated", direction: "context",
      values: { enteredUsers: ENTERED, completedUsers: COMPLETED, totalConversion: 10.2, largestDropOffRate: 63.9 },
      provenance: provenance(parsed, "funnel", query, queryHash, "전체 사용자"),
      confidence: createConfidenceBand(ENTERED),
    }],
  };
}

async function segmentsOutcome(parsed, query) {
  const queryHash = await createQueryHash(query);
  return {
    ok: true, degraded: [],
    measurements: SEGMENT_COUNTS.map(({ value, entered, completed }) => ({
      metricLabel: `변형 전환 · ${value}`,
      observation: `${query.dimension}=${value} 표본 ${entered}명 중 ${completed}명이 마지막 단계에 도달했습니다.`,
      sourceKind: "calculated", direction: "context",
      values: { enteredUsers: entered, completedUsers: completed, conversionRate: Math.round((completed / entered) * 1000) / 10 },
      provenance: provenance(parsed, "segments", query, queryHash, `${query.dimension}=${value}`),
      confidence: createConfidenceBand(entered),
    })),
  };
}

export async function mockHarness(page) {
  await page.route("**/api/harness/measure", async (route) => {
    const parsed = parseMeasurementRequest(route.request().postDataJSON());
    if (!parsed.ok) return reject(route);
    const { query } = parsed.value;
    const outcome = query.capability === "funnel" ? await funnelOutcome(parsed, query)
      : query.capability === "segments" ? await segmentsOutcome(parsed, query) : null;
    if (!outcome) return reject(route);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(outcome) });
  });
}
