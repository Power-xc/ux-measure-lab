import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_IDLE_MS, MAX_SESSION_MS, SessionManager } from "../src/session.ts";
import { MemoryStore } from "../src/storage.ts";

function makeManager(store = new MemoryStore()): { manager: SessionManager; ids: () => number } {
  let n = 0;
  const manager = new SessionManager(store, { newId: () => `sid-${(n += 1)}` });
  return { manager, ids: () => n };
}

test("SESSION-001 the first touch opens a session with a 'new' start and no end", () => {
  const { manager } = makeManager();
  const result = manager.touch(1000);
  assert.equal(result.transition?.ended, null);
  assert.equal(result.transition?.started.reason, "new");
  assert.equal(result.sid, result.transition?.started.sid);
});

test("SESSION-002 activity exactly at the 30min boundary keeps the same session", () => {
  const { manager } = makeManager();
  const first = manager.touch(0).sid;
  const boundary = manager.touch(DEFAULT_IDLE_MS); // exactly 30min idle: not yet expired (> is strict)
  assert.equal(boundary.sid, first);
  assert.equal(boundary.transition, null);
});

test("SESSION-003 crossing 30min inactivity rotates the session as a timeout", () => {
  const { manager } = makeManager();
  const first = manager.touch(0).sid;
  const rotated = manager.touch(DEFAULT_IDLE_MS + 1);
  assert.notEqual(rotated.sid, first);
  assert.equal(rotated.transition?.ended?.sid, first);
  assert.equal(rotated.transition?.ended?.reason, "timeout");
  assert.equal(rotated.transition?.started.reason, "timeout");
});

test("SESSION-004 the 24h hard cap rotates even under continuous activity", () => {
  const { manager } = makeManager();
  const first = manager.touch(0).sid;
  // Keep activity fresh every 10min up to just past the 24h cap.
  let now = 0;
  let last = first;
  for (let i = 1; now <= MAX_SESSION_MS; i += 1) {
    now = i * 600_000;
    last = manager.touch(now).sid;
  }
  assert.notEqual(last, first);
});

test("SESSION-005 ended-session duration is measured to the last activity, not the rotation time", () => {
  const { manager } = makeManager();
  manager.touch(0);
  manager.touch(100_000); // lastActivity = 100s
  const rotated = manager.touch(100_000 + DEFAULT_IDLE_MS + 1);
  assert.equal(rotated.transition?.ended?.durationMs, 100_000);
});

test("SESSION-006 the visitor id persists across a session rotation", () => {
  const { manager } = makeManager();
  const vid = manager.visitorId();
  manager.touch(0);
  manager.touch(DEFAULT_IDLE_MS + 1);
  assert.equal(manager.visitorId(), vid);
});

test("SESSION-007 session state is shared through the store across tabs", () => {
  const store = new MemoryStore();
  const tabA = makeManager(store).manager;
  const sid = tabA.touch(1000).sid;
  // A second manager over the same store models a second tab of the same browser.
  const tabB = makeManager(store).manager;
  assert.equal(tabB.currentSid(), sid);
  assert.equal(tabB.touch(2000).sid, sid); // no rotation — shared activity window
});

test("SESSION-008 a fresh visitor id is created once and reused", () => {
  const store = new MemoryStore();
  const first = makeManager(store).manager.visitorId();
  const second = makeManager(store).manager.visitorId();
  assert.equal(second, first);
});
