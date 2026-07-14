// Shared test rig: a jsdom window plus a fully injected CollectorEnv so unit tests
// drive time, identifiers, delivery, and scheduling deterministically. Not a *.test.ts
// file, so `node --test test/*.test.ts` does not execute it as a suite.

import { JSDOM } from "jsdom";
import type { CollectorEnv } from "../src/core.ts";
import { MemoryStore } from "../src/storage.ts";
import type { ScrollMetrics } from "../src/scroll.ts";
import type { Scheduler, Sender } from "../src/transport.ts";

/** Records outbound payloads instead of hitting the network. */
export class RecordingSender implements Sender {
  posts: string[] = [];
  beacons: string[] = [];
  postOk = true;

  async post(_url: string, body: string): Promise<boolean> {
    this.posts.push(body);
    return this.postOk;
  }

  beacon(_url: string, body: string): boolean {
    this.beacons.push(body);
    return true;
  }
}

/** A scheduler whose timers only fire when the test advances or runs them. */
export class ManualScheduler implements Scheduler {
  private tasks = new Map<number, { fn: () => void; at: number }>();
  private seq = 1;
  clock = 0;

  set(fn: () => void, ms: number): number {
    const id = this.seq;
    this.seq += 1;
    this.tasks.set(id, { fn, at: this.clock + ms });
    return id;
  }

  clear(handle: number): void {
    this.tasks.delete(handle);
  }

  /** Advance virtual time and fire every timer whose deadline has passed. */
  advance(ms: number): void {
    this.clock += ms;
    for (const [id, task] of [...this.tasks]) {
      if (task.at <= this.clock) {
        this.tasks.delete(id);
        task.fn();
      }
    }
  }

  pending(): number {
    return this.tasks.size;
  }
}

export interface Harness {
  dom: JSDOM;
  win: Window;
  doc: Document;
  env: CollectorEnv;
  sender: RecordingSender;
  scheduler: ManualScheduler;
  store: MemoryStore;
  metrics: ScrollMetrics;
  setNow: (value: number) => void;
}

export interface HarnessOptions {
  url?: string;
  startNow?: number;
  webdriver?: boolean;
  gpc?: boolean;
  dnt?: boolean;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: options.url ?? "https://shop.example.com/pricing", pretendToBeVisual: true });
  const win = dom.window as unknown as Window;
  const doc = dom.window.document as unknown as Document;
  const sender = new RecordingSender();
  const scheduler = new ManualScheduler();
  const store = new MemoryStore();
  const metrics: ScrollMetrics = { scrollTop: 0, viewport: 768, scrollHeight: 3000 };

  let clock = options.startNow ?? 1_000_000;
  let idCounter = 0;

  const env: CollectorEnv = {
    win,
    doc,
    now: () => clock,
    isoNow: () => new Date(clock).toISOString(),
    newId: () => {
      idCounter += 1;
      return `id-${idCounter}`;
    },
    store,
    sender,
    scheduler,
    scrollMetrics: () => ({ ...metrics }),
    signals: { gpc: options.gpc ?? false, dnt: options.dnt ?? false },
    webdriver: options.webdriver ?? false,
  };

  return { dom, win, doc, env, sender, scheduler, store, metrics, setNow: (value: number) => { clock = value; } };
}

/** Parse the most recent recorded POST body as a batch envelope. */
export function lastEnvelope(sender: RecordingSender): { k: string; sent_at: string; sid: string; aid: string; events: Array<{ eid: string; t: string; ts: number; p: string; ref?: string; props: Record<string, unknown> }> } {
  const body = sender.posts[sender.posts.length - 1];
  return JSON.parse(body);
}
