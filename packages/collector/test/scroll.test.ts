import assert from "node:assert/strict";
import test from "node:test";
import { ScrollTracker } from "../src/scroll.ts";
import type { EventProps } from "../src/schema.ts";

function collector(): { tracker: ScrollTracker; milestones: () => number[]; events: Array<EventProps> } {
  const events: EventProps[] = [];
  const tracker = new ScrollTracker((_type, props) => events.push(props));
  return { tracker, milestones: () => events.map((event) => event.ms as number), events };
}

test("SCROLL-001 emits each milestone once as depth increases", () => {
  const { tracker, milestones } = collector();
  let now = 0;
  const step = (scrollTop: number): void => tracker.update({ scrollTop, viewport: 1000, scrollHeight: 4000 }, (now += 300));
  step(0); // pct 25 → milestone 25
  step(1000); // pct 50
  step(2000); // pct 75
  step(3000); // pct 100
  assert.deepEqual(milestones(), [25, 50, 75, 100]);
});

test("SCROLL-002 never re-emits a milestone already reached", () => {
  const { tracker, milestones } = collector();
  let now = 0;
  tracker.update({ scrollTop: 3000, viewport: 1000, scrollHeight: 4000 }, (now += 300)); // jumps to 100 → 25,50,75,100
  tracker.update({ scrollTop: 3000, viewport: 1000, scrollHeight: 4000 }, (now += 300));
  assert.deepEqual(milestones(), [25, 50, 75, 100]);
});

test("SCROLL-003 throttles samples closer than 250ms apart", () => {
  const { tracker, milestones } = collector();
  tracker.update({ scrollTop: 0, viewport: 1000, scrollHeight: 4000 }, 0); // pct 25 → milestone 25
  tracker.update({ scrollTop: 1000, viewport: 1000, scrollHeight: 4000 }, 100); // throttled (100 < 250)
  assert.deepEqual(milestones(), [25]);
});

test("SCROLL-004 reset clears milestones and max for a new pageview", () => {
  const { tracker, milestones, events } = collector();
  tracker.update({ scrollTop: 3000, viewport: 1000, scrollHeight: 4000 }, 0);
  assert.equal(tracker.maxReached(), 100);
  tracker.reset();
  assert.equal(tracker.maxReached(), 0);
  events.length = 0;
  tracker.update({ scrollTop: 0, viewport: 1000, scrollHeight: 4000 }, 1000); // milestone 25 again
  assert.deepEqual(milestones(), [25]);
});

test("SCROLL-005 a zero-height document reports no scroll", () => {
  const { tracker, milestones } = collector();
  tracker.update({ scrollTop: 0, viewport: 0, scrollHeight: 0 }, 0);
  assert.deepEqual(milestones(), []);
});
