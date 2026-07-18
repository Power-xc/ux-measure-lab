import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayRecordingMeta } from "../server/store.ts";
import { buildReplayEvidence, isReplayEvidence, markReplayEvidenceExpired } from "./replay-evidence.ts";

const META: ReplayRecordingMeta = {
  siteId: "site-1",
  recordingId: "rec-1",
  sessionId: "sess-1",
  anonymousIdHash: "hash-a",
  startedAt: "2026-07-18T00:00:00.000Z",
  endedAt: "2026-07-18T00:03:00.000Z",
  chunkCount: 4,
  byteSize: 2_048,
  purposeVersion: "replay-v1",
  expiresAt: "2026-08-17T00:00:00.000Z",
};

test("SR-10 replay references become qualitative evidence that still requires explicit apply", () => {
  const evidence = buildReplayEvidence({ id: "ev-replay-1", meta: META, observedAt: "2026-07-18T01:00:00.000Z" });
  assert.equal(evidence.sourceKind, "qualitative");
  assert.equal(evidence.direction, "context");
  assert.equal(evidence.sourceRef?.capability, "recordings");
  assert.equal(evidence.sourceRef?.sampleSize, 1);
  assert.ok(isReplayEvidence(evidence));
  assert.doesNotMatch(evidence.observation, /원인|때문|유발/);
  assert.doesNotMatch(`${evidence.observation} ${evidence.detail}`, /%|pp\b/);
});

test("SR-11 expiry marks the reference unavailable without inventing numbers", () => {
  const evidence = buildReplayEvidence({ id: "ev-replay-1", meta: META, observedAt: "2026-07-18T01:00:00.000Z" });
  const expired = markReplayEvidenceExpired(evidence);
  assert.match(expired.detail, /원본 녹화가 만료/);
  assert.equal(markReplayEvidenceExpired(expired).detail, expired.detail);
  assert.equal(expired.observation, evidence.observation);

  const foreign = { ...evidence, sourceRef: { ...evidence.sourceRef!, adapterId: "first-party" } };
  assert.equal(markReplayEvidenceExpired(foreign), foreign);
});
