// Async loader stub + command dispatcher. research-sdk.md §4.1: the inline <head>
// snippet only builds a queue; the main script replaces `window.ml` with a real
// dispatcher and replays the queue in order. Calls made before the main script loads
// (init, consent) are buffered and applied on bootstrap.

import { Collector, browserEnv, resolveConfig, type CollectorConfig } from "./core.ts";
import type { ConsentState } from "./consent.ts";

/** The global `ml(...)` function: a callable that, pre-bootstrap, buffers into `q`. */
export interface MlGlobal {
  (command: string, ...args: unknown[]): void;
  q?: unknown[][];
  k?: string;
}

/** Minimal surface the dispatcher drives, so tests can inject a fake collector. */
export interface Controllable {
  start(): void;
  setConsent(state: ConsentState): void;
}

function isConsentState(value: unknown): value is ConsentState {
  return value === "granted" || value === "denied" || value === "unknown";
}

/**
 * Routes `ml(command, ...args)` calls to a collector. The collector is created lazily
 * on `init` (it needs config); a `consent` call arriving before `init` is held and
 * applied once the collector exists.
 */
export class Dispatcher {
  private collector: Controllable | null = null;
  private pendingConsent: ConsentState | null = null;
  private readonly make: (config: CollectorConfig) => Controllable;
  private readonly defaultKey: string | undefined;

  constructor(make: (config: CollectorConfig) => Controllable, defaultKey?: string) {
    this.make = make;
    this.defaultKey = defaultKey;
  }

  dispatch(command: string, args: readonly unknown[]): void {
    if (command === "init") this.init(args[0]);
    else if (command === "consent") this.consent(args[0]);
    // Unknown commands are ignored so older snippets stay forward-compatible.
  }

  private init(raw: unknown): void {
    if (this.collector) return; // idempotent: a second init is a no-op.
    const input = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<CollectorConfig>;
    const key = typeof input.key === "string" ? input.key : this.defaultKey;
    if (!key) return; // no destination project — cannot collect.
    this.collector = this.make(resolveConfig({ ...input, key }));
    this.collector.start();
    if (this.pendingConsent) {
      this.collector.setConsent(this.pendingConsent);
      this.pendingConsent = null;
    }
  }

  private consent(raw: unknown): void {
    if (!isConsentState(raw)) return;
    if (this.collector) this.collector.setConsent(raw);
    else this.pendingConsent = raw;
  }
}

/** Install the queue stub (mirrors the inline snippet) if the page hasn't already. */
export function installStub(win: Window & { ml?: MlGlobal }): MlGlobal {
  if (win.ml) return win.ml;
  const stub = ((...args: unknown[]): void => {
    (stub.q = stub.q ?? []).push(args);
  }) as MlGlobal;
  win.ml = stub;
  return stub;
}

/**
 * Bootstrap the real collector: replace the stub with a live dispatcher and replay
 * everything the page queued before this script loaded.
 */
export function bootstrap(win: Window & { ml?: MlGlobal }): Dispatcher {
  const stub = installStub(win);
  const queued = stub.q ?? [];
  const dispatcher = new Dispatcher((config) => new Collector(browserEnv(win), config), stub.k);
  const live: MlGlobal = (command: string, ...args: unknown[]): void => dispatcher.dispatch(command, args);
  live.k = stub.k;
  win.ml = live;
  for (const call of queued) dispatcher.dispatch(String(call[0]), call.slice(1));
  return dispatcher;
}
