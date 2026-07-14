import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { RouteWatcher } from "../src/routing.ts";

interface RouteChange {
  kind: string;
  from: string;
  to: string;
}

function setup(): { win: Window; history: History; watcher: RouteWatcher; changes: RouteChange[]; originalReplace: (data: unknown, unused: string, url?: string) => void } {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://app.example.com/a" });
  const win = dom.window as unknown as Window;
  const history = dom.window.history as unknown as History;
  const originalReplace = dom.window.history.replaceState.bind(dom.window.history);
  const changes: RouteChange[] = [];
  const watcher = new RouteWatcher({ win, history, location: dom.window.location as unknown as Location }, (change) => changes.push(change));
  return { win, history, watcher, changes, originalReplace };
}

test("ROUTE-001 wraps pushState: emits a push route and still updates the URL", () => {
  const { win, history, watcher, changes } = setup();
  watcher.start();
  history.pushState({}, "", "/b");
  assert.deepEqual(changes, [{ kind: "push", from: "/a", to: "/b" }]);
  assert.equal(win.location.pathname, "/b"); // original pushState ran → router not broken
});

test("ROUTE-002 wraps replaceState as a replace route", () => {
  const { history, watcher, changes } = setup();
  watcher.start();
  history.replaceState({}, "", "/c");
  assert.deepEqual(changes, [{ kind: "replace", from: "/a", to: "/c" }]);
});

test("ROUTE-003 debounces navigation to the identical URL", () => {
  const { history, watcher, changes } = setup();
  watcher.start();
  history.pushState({}, "", "/b");
  history.pushState({}, "", "/b");
  assert.equal(changes.length, 1);
});

test("ROUTE-004 popstate (back/forward) emits a pop route", () => {
  const { win, watcher, changes, originalReplace } = setup();
  watcher.start();
  win.history.pushState({}, "", "/b"); // current → /b
  originalReplace({}, "", "/a"); // simulate the browser moving the URL back without emitting
  win.dispatchEvent(new (win as unknown as { Event: typeof Event }).Event("popstate"));
  assert.deepEqual(changes[changes.length - 1], { kind: "pop", from: "/b", to: "/a" });
});

test("ROUTE-005 hashchange emits a hash route", () => {
  const { win, watcher, changes, originalReplace } = setup();
  watcher.start();
  originalReplace({}, "", "/a#section");
  win.dispatchEvent(new (win as unknown as { Event: typeof Event }).Event("hashchange"));
  assert.deepEqual(changes[changes.length - 1], { kind: "hash", from: "/a", to: "/a#section" });
});

test("ROUTE-006 stop restores the original history methods", () => {
  const { win, history, watcher, changes } = setup();
  watcher.start();
  watcher.stop();
  history.pushState({}, "", "/d");
  assert.equal(changes.length, 0); // no longer intercepting
  assert.equal(win.location.pathname, "/d"); // original still works
});
