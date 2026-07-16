import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFunnel } from "../../measure-loop/lib/calculate-funnel.ts";
import { parseNormalizedMeasurement, type MeasurementCache, type MeasurementQuery, type NormalizedMeasurement, type SourceAdapterMeta } from "../contract.ts";
import { InMemoryAggregateReader } from "./aggregate-reader.ts";
import {
  CONFIDENCE_HIGH_MINIMUM,
  CONFIDENCE_MEDIUM_MINIMUM,
  MINIMUM_SAMPLE_SIZE,
  createConfidenceBand,
  createMeasureService,
  createQueryHash,
  measurementMatchesQuery,
} from "./measure-service.ts";

const WINDOW = { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" };
const NOW = "2026-07-15T00:00:00.000Z";
const META: SourceAdapterMeta = {
  adapterId: "first-party",
  displayName: "UX MeasureLab SDK",
  kind: "first_party",
  access: "read_write",
  capabilities: ["funnel", "interaction", "paths"],
};

class TestCache implements MeasurementCache {
  private readonly values = new Map<string, readonly NormalizedMeasurement[]>();

  get(queryHash: string) {
    return this.values.get(queryHash);
  }

  set(queryHash: string, measurements: readonly NormalizedMeasurement[]) {
    this.values.set(queryHash, measurements);
  }
}

test("HAC-08 createQueryHash is deterministic for normalized query field and signal order", async () => {
  const first: MeasurementQuery = {
    capability: "interaction",
    target: " pricing ",
    signals: ["rage", "dead"],
    window: WINDOW,
  };
  const second: MeasurementQuery = {
    window: { to: WINDOW.to, from: WINDOW.from },
    signals: ["dead", "rage"],
    target: "pricing",
    capability: "interaction",
  };

  const firstHash = await createQueryHash(first);
  assert.match(firstHash, /^[a-f0-9]{64}$/);
  assert.equal(firstHash, await createQueryHash(second));
  assert.notEqual(firstHash, await createQueryHash({ ...second, target: "checkout" }));
});

test("funnel measurement reuses analyzeFunnel calculations and writes deterministic provenance", async () => {
  const query: MeasurementQuery = {
    capability: "funnel",
    steps: ["visit", "signup", "activate"],
    window: WINDOW,
  };
  const counts = [1_200, 600, 240];
  const reader = new InMemoryAggregateReader({ funnels: [{ input: query, counts }] });
  const expected = analyzeFunnel(query.steps.map((label, index) => ({ id: `step-${index + 1}`, label, users: counts[index] })));
  const outcome = await createMeasureService(reader, META).measure(query, { now: NOW, cache: new TestCache() });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.measurements.length, 1);
  assert.deepEqual(outcome.measurements[0].values, {
    enteredUsers: 1_200,
    completedUsers: 240,
    totalConversion: expected.totalConversion,
    largestDropOffRate: expected.largestDropOff?.dropOffFromPrevious,
  });
  assert.equal(outcome.measurements[0].provenance.queryHash, await createQueryHash(query));
  assert.equal(outcome.measurements[0].provenance.observedAt, NOW);
  assert.equal(parseNormalizedMeasurement(outcome.measurements[0]).ok, true);
});

test("HAC-11 returns insufficient_sample without measurements below the sample threshold", async () => {
  const query: MeasurementQuery = { capability: "paths", startEvent: "signup", endEvent: "activate", window: WINDOW };
  const reader = new InMemoryAggregateReader({
    paths: [{ input: query, result: { startCount: MINIMUM_SAMPLE_SIZE - 1, reachedCount: 8 } }],
  });
  const outcome = await createMeasureService(reader, META).measure(query, { now: NOW, cache: new TestCache() });

  assert.deepEqual(outcome, {
    ok: false,
    code: "insufficient_sample",
    message: `최소 ${MINIMUM_SAMPLE_SIZE}개의 관찰 표본이 필요합니다.`,
  });
});

test("HAC-11 returns a value-free insufficient_sample for a zero-duration window", async () => {
  const instant = "2026-07-08T00:00:00.000Z";
  const query: MeasurementQuery = {
    capability: "paths",
    startEvent: "signup",
    endEvent: "activate",
    window: { from: instant, to: instant },
  };
  let calls = 0;
  class CountingReader extends InMemoryAggregateReader {
    override async pathReach(...args: Parameters<InMemoryAggregateReader["pathReach"]>) {
      calls += 1;
      return super.pathReach(...args);
    }
  }
  const reader = new CountingReader({ paths: [{ input: query, result: { startCount: 1_000, reachedCount: 500 } }] });
  const outcome = await createMeasureService(reader, META).measure(query, { now: NOW, cache: new TestCache() });

  assert.deepEqual(outcome, {
    ok: false,
    code: "insufficient_sample",
    message: "관찰 기간은 0초보다 길어야 합니다.",
  });
  assert.equal("measurements" in outcome, false);
  assert.equal(calls, 0);

  const positiveQuery: MeasurementQuery = {
    ...query,
    window: { from: instant, to: "2026-07-08T00:00:00.001Z" },
  };
  const positiveReader = new InMemoryAggregateReader({
    paths: [{ input: positiveQuery, result: { startCount: 1_000, reachedCount: 500 } }],
  });
  const positive = await createMeasureService(positiveReader, META).measure(positiveQuery, { now: NOW, cache: new TestCache() });
  assert.equal(positive.ok, true);
});

test("ConfidenceBand uses ordinal sample thresholds and states its limits", () => {
  assert.equal(createConfidenceBand(CONFIDENCE_MEDIUM_MINIMUM - 1).level, "low");
  assert.equal(createConfidenceBand(CONFIDENCE_MEDIUM_MINIMUM).level, "medium");
  assert.equal(createConfidenceBand(CONFIDENCE_HIGH_MINIMUM - 1).level, "medium");
  assert.equal(createConfidenceBand(CONFIDENCE_HIGH_MINIMUM).level, "high");
  assert.match(createConfidenceBand(1_000).basis, /표본/);
  assert.match(createConfidenceBand(1_000).limits, /인과|유의성/);
});

test("measurement trust checks bind window, segment, hash and deterministic confidence", async () => {
  const query: MeasurementQuery = { capability: "paths", startEvent: "signup", endEvent: "activate", window: WINDOW };
  const reader = new InMemoryAggregateReader({ paths: [{ input: query, result: { startCount: 100, reachedCount: 50 } }] });
  const outcome = await createMeasureService(reader, META).measure(query, { now: NOW, cache: new TestCache() });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const measurement = outcome.measurements[0];
  const queryHash = await createQueryHash(query);
  assert.equal(measurementMatchesQuery(measurement, META.adapterId, query, queryHash), true);
  assert.equal(measurementMatchesQuery({ ...measurement, provenance: { ...measurement.provenance, segment: "plan=pro" } }, META.adapterId, query, queryHash), false);
  assert.equal(measurementMatchesQuery({ ...measurement, confidence: { ...measurement.confidence, level: "high" } }, META.adapterId, query, queryHash), false);
});

test("interaction and path aggregates are normalized without causal claims", async () => {
  const interaction: MeasurementQuery = { capability: "interaction", signals: ["rage"], target: "pricing", window: WINDOW };
  const path: MeasurementQuery = { capability: "paths", startEvent: "signup", endEvent: "activate", window: WINDOW };
  const reader = new InMemoryAggregateReader({
    interactions: [{ input: interaction, result: { sampleSize: 200, counts: { rage: 25 } } }],
    paths: [{ input: path, result: { startCount: 200, reachedCount: 80 } }],
  });
  const service = createMeasureService(reader, META);

  const interactionOutcome = await service.measure(interaction, { now: NOW, cache: new TestCache() });
  const pathOutcome = await service.measure(path, { now: NOW, cache: new TestCache() });

  assert.equal(interactionOutcome.ok, true);
  assert.equal(pathOutcome.ok, true);
  if (!interactionOutcome.ok || !pathOutcome.ok) return;
  assert.deepEqual(interactionOutcome.measurements[0].values, { signalCount: 25, sampleSize: 200, signalsPer100Samples: 12.5 });
  assert.deepEqual(pathOutcome.measurements[0].values, { startedUsers: 200, reachedUsers: 80, reachRate: 40 });
  assert.doesNotMatch(interactionOutcome.measurements[0].observation, /원인|때문|유발/);
  assert.equal(parseNormalizedMeasurement(interactionOutcome.measurements[0]).ok, true);
  assert.equal(parseNormalizedMeasurement(pathOutcome.measurements[0]).ok, true);
});

test("segments measurement normalizes per-variant funnels and degrades small variants", async () => {
  const query: MeasurementQuery = { capability: "segments", steps: ["enter", "convert"], dimension: "variant", window: WINDOW };
  const meta: SourceAdapterMeta = { ...META, capabilities: [...META.capabilities, "segments"] };
  const reader = new InMemoryAggregateReader({
    segmented: [{
      input: query,
      rows: [
        { value: "v-2", counts: [400, 52] },
        { value: "v-1", counts: [400, 56] },
        { value: "baseline", counts: [1_000, 100] },
        { value: "v-3", counts: [20, 5] },
      ],
    }],
  });
  const outcome = await createMeasureService(reader, meta).measure(query, { now: NOW, cache: new TestCache() });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(
    outcome.measurements.map((measurement) => measurement.provenance.segment),
    ["variant=baseline", "variant=v-1", "variant=v-2"],
  );
  assert.deepEqual(outcome.measurements[1].values, { enteredUsers: 400, completedUsers: 56, conversionRate: 14 });
  assert.equal(outcome.degraded.length, 1);
  assert.match(outcome.degraded[0].detail, /variant=v-3.*표본 20/);
  assert.equal(parseNormalizedMeasurement(outcome.measurements[0]).ok, true);
  assert.doesNotMatch(outcome.measurements[0].observation, /원인|때문|유발/);

  const queryHash = await createQueryHash(query);
  assert.equal(measurementMatchesQuery(outcome.measurements[0], META.adapterId, query, queryHash), true);
  const forged = { ...outcome.measurements[0], provenance: { ...outcome.measurements[0].provenance, segment: "plan=pro" } };
  assert.equal(measurementMatchesQuery(forged, META.adapterId, query, queryHash), false);
});

test("segments measurement rejects malformed aggregates and reports value-free sample gaps", async () => {
  const query: MeasurementQuery = { capability: "segments", steps: ["enter", "convert"], dimension: "variant", window: WINDOW };
  const meta: SourceAdapterMeta = { ...META, capabilities: [...META.capabilities, "segments"] };
  const service = (rows: readonly { value: string; counts: readonly number[] }[]) =>
    createMeasureService(new InMemoryAggregateReader({ segmented: [{ input: query, rows }] }), meta)
      .measure(query, { now: NOW, cache: new TestCache() });

  const duplicated = await service([{ value: "v-1", counts: [400, 56] }, { value: "v-1", counts: [300, 30] }]);
  assert.equal(duplicated.ok === false && duplicated.code, "invalid_response");

  const increasing = await service([{ value: "v-1", counts: [100, 200] }]);
  assert.equal(increasing.ok === false && increasing.code, "invalid_response");

  const tooSmall = await service([{ value: "v-1", counts: [20, 5] }]);
  assert.equal(tooSmall.ok === false && tooSmall.code, "insufficient_sample");
  assert.equal(tooSmall.ok === false && "measurements" in tooSmall, false);
});

test("measure service caches a successful normalized result by queryHash", async () => {
  const query: MeasurementQuery = { capability: "paths", startEvent: "signup", endEvent: "activate", window: WINDOW };
  let calls = 0;
  class CountingReader extends InMemoryAggregateReader {
    override async pathReach(...args: Parameters<InMemoryAggregateReader["pathReach"]>) {
      calls += 1;
      return super.pathReach(...args);
    }
  }
  const reader = new CountingReader({ paths: [{ input: query, result: { startCount: 200, reachedCount: 80 } }] });
  const cache = new TestCache();
  const service = createMeasureService(reader, META);

  const first = await service.measure(query, { now: NOW, cache });
  const second = await service.measure(query, { now: NOW, cache });

  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});
