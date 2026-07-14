import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedMeasurement } from "../contract.ts";
import { getHarnessSessionCache } from "./harness-session-cache.ts";

const measurement: NormalizedMeasurement = {
  metricLabel: "세션 캐시 확인",
  observation: "세션 캐시 재사용이 관찰되었습니다.",
  sourceKind: "measured",
  direction: "context",
  values: { sampleSize: 30 },
  provenance: {
    adapterId: "first-party",
    capability: "interaction",
    source: "UX MeasureLab Events",
    observedAt: "2026-07-15T00:00:00.000Z",
    period: "2026-07-01 ~ 2026-07-08",
    window: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
    segment: "전체 사용자",
    queryHash: "session-cache-test",
  },
  confidence: { level: "low", sampleSize: 30, basis: "관찰 표본 30개", limits: "인과관계를 나타내지 않습니다." },
};

test("HAC-08 harness cache survives consumers requesting it again in one session", () => {
  const first = getHarnessSessionCache();
  first.set("harness-session-cache:test", [measurement]);
  const second = getHarnessSessionCache();

  assert.equal(second, first);
  assert.deepEqual(second.get("harness-session-cache:test"), [measurement]);
});
