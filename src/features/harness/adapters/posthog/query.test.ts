import assert from "node:assert/strict";
import test from "node:test";
import type { MeasurementQuery } from "../../contract.ts";
import { buildHogQLRequest, PostHogQueryError } from "./query.ts";
import { LocalPostHogRateLimiter } from "./rate-limit.ts";

const window = { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" };

test("PostHog HogQL builder maps supported capabilities without executing requests", () => {
  const queries: MeasurementQuery[] = [
    { capability: "funnel", steps: ["visit", "signup", "activate"], window, segment: { dimension: "plan", value: "pro" } },
    { capability: "events", event: "report_created", interval: "day", window },
    { capability: "paths", startEvent: "signup", endEvent: "report_created", window },
    { capability: "interaction", signals: ["rage", "dead", "error"], target: "#checkout", window },
  ];
  const requests = queries.map(buildHogQLRequest);

  assert.deepEqual(requests.map((request) => request.body.query.kind), ["HogQLQuery", "HogQLQuery", "HogQLQuery", "HogQLQuery"]);
  assert.match(requests[0].body.query.query, /windowFunnel/);
  assert.match(requests[1].body.query.query, /toStartOfDay/);
  assert.match(requests[2].body.query.query, /reached_count/);
  assert.match(requests[3].body.query.query, /\$rageclick/);
  assert.doesNotMatch(requests[3].body.query.query, /WHERE event IN/);
  assert.match(requests[3].body.query.query, /count\(DISTINCT person_id\)/);
  assert.match(requests[3].body.query.query, /\$elements_chain/);
  assert.match(requests[3].body.query.query, /\$current_url/);
  assert.deepEqual(requests[0].columns, ["step_1", "step_2", "step_3"]);
});

test("PostHog HogQL builder escapes literals and rejects invalid shapes", () => {
  const request = buildHogQLRequest({ capability: "events", event: "x' OR 1=1 --", interval: "week", window });
  assert.match(request.body.query.query, /x'' OR 1=1 --/);
  assert.throws(
    () => buildHogQLRequest({ capability: "funnel", steps: ["same", "same"], window }),
    PostHogQueryError,
  );
  assert.throws(
    () => buildHogQLRequest({ capability: "interaction", signals: [], window }),
    PostHogQueryError,
  );
  assert.throws(
    () => buildHogQLRequest({
      capability: "paths",
      startEvent: "signup",
      endEvent: "report_created",
      window: { from: window.from, to: window.from },
    }),
    PostHogQueryError,
  );
});

test("PostHog local token buckets enforce 240 per minute and 2400 per hour", () => {
  const limiter = new LocalPostHogRateLimiter();
  for (let index = 0; index < 240; index += 1) assert.deepEqual(limiter.consume(0), { allowed: true });
  assert.deepEqual(limiter.consume(0), { allowed: false, retryAfterMs: 250 });
  assert.deepEqual(limiter.consume(250), { allowed: true });

  const hourly = new LocalPostHogRateLimiter();
  for (let minute = 0; minute <= 10; minute += 1) {
    for (let index = 0; index < 240; index += 1) assert.equal(hourly.consume(minute * 60_000).allowed, true);
  }
  for (let index = 0; index < 200; index += 1) assert.equal(hourly.consume(11 * 60_000).allowed, true);
  assert.deepEqual(hourly.consume(11 * 60_000), { allowed: false, retryAfterMs: 1_500 });
});
