// Collector core: init, config, lifecycle, consent gate, and the emit pipeline.
// research-sdk.md §4.3 (config), §5 (session/pv/route), §7 (client bot filter).
// The pipeline's first act is always the consent gate — nothing is queued or sent
// before collection is allowed (spec.md HAC-02).

import { AutoCapture, type AutoCaptureConfig } from "./autocapture.ts";
import { ConsentGate, type ConsentState } from "./consent.ts";
import { normalizePath, normalizeReferrer } from "./mask.ts";
import { RouteWatcher } from "./routing.ts";
import { buildEnvelope, type EventProps, type WireEvent, type WireEventType } from "./schema.ts";
import { ScrollTracker, type ScrollMetrics } from "./scroll.ts";
import { SessionManager } from "./session.ts";
import { BrowserSender, Transport, type Scheduler, type Sender } from "./transport.ts";
import { BrowserStore, MemoryStore, type Store } from "./storage.ts";

export interface CollectorConfig {
  key: string;
  host: string;
  ingestPath: string;
  requireConsent: boolean;
  respectGpc: boolean;
  capture: { click: boolean; rage: boolean; dead: boolean; scroll: boolean; route: boolean; text: boolean };
  captureQueryParams: string[];
  sample: number;
  sessionIdleMs: number;
  deadWaitMs: number;
  batch: { maxEvents: number; maxWaitMs: number };
  debug: boolean;
}

export const DEFAULT_CONFIG: Omit<CollectorConfig, "key"> = {
  host: "",
  ingestPath: "/api/ingest",
  requireConsent: true,
  respectGpc: true,
  capture: { click: true, rage: true, dead: true, scroll: true, route: true, text: false },
  captureQueryParams: [],
  sample: 1,
  sessionIdleMs: 1_800_000,
  deadWaitMs: 3000,
  batch: { maxEvents: 20, maxWaitMs: 5000 },
  debug: false,
};

/** Everything the collector reads from the outside world. Injected for tests. */
export interface CollectorEnv {
  win: Window;
  doc: Document;
  now: () => number;
  isoNow: () => string;
  newId: () => string;
  store: Store;
  sender: Sender;
  scheduler: Scheduler;
  scrollMetrics: () => ScrollMetrics;
  signals: { gpc: boolean; dnt: boolean };
  webdriver: boolean;
}

function deterministicUnit(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 10000 / 10000;
}

export class Collector {
  private readonly env: CollectorEnv;
  private readonly config: CollectorConfig;
  private readonly consent: ConsentGate;
  private readonly session: SessionManager;
  private readonly transport: Transport;
  private readonly scroll: ScrollTracker;
  private readonly autocapture: AutoCapture;
  private readonly routing: RouteWatcher;

  private active = false;
  private pageviewEmitted = false;
  private pvid = "";
  private seq = 0;

  constructor(env: CollectorEnv, config: CollectorConfig) {
    this.env = env;
    this.config = config;
    this.consent = new ConsentGate(env.store, { requireConsent: config.requireConsent, respectGpc: config.respectGpc }, env.signals);
    this.session = new SessionManager(env.store, { newId: env.newId, config: { idleMs: config.sessionIdleMs } });

    const url = `${config.host}${config.ingestPath}`;
    const serialize = (events: WireEvent[]): string =>
      JSON.stringify(buildEnvelope({ key: config.key, sid: this.session.currentSid() ?? "", aid: this.session.visitorId(), sentAt: env.isoNow() }, events));
    this.transport = new Transport({ url, sender: env.sender, scheduler: env.scheduler, serialize, config: { maxEvents: config.batch.maxEvents, maxWaitMs: config.batch.maxWaitMs } });

    const emit = (type: WireEventType, props: EventProps): void => this.record(type, props);
    this.scroll = new ScrollTracker(emit);
    const captureConfig: AutoCaptureConfig = { rage: config.capture.rage, dead: config.capture.dead, captureText: config.capture.text, deadWaitMs: config.deadWaitMs };
    this.autocapture = new AutoCapture({ doc: env.doc, win: env.win, now: env.now, emit, config: captureConfig });
    this.routing = new RouteWatcher({ win: env.win, history: env.win.history, location: env.win.location }, (change) => this.onRoute(change.kind, change.from, change.to));
  }

  /** Whether client-side bot/sample gates admitted this visitor. */
  isActive(): boolean {
    return this.active;
  }

  private passesBotAndSample(): boolean {
    if (this.env.webdriver) return false; // automation — dropped (§7). Spoofable, so only a hint.
    if ((this.env.doc.visibilityState as string) === "prerender") return false;
    if (this.env.win.innerWidth === 0 || this.env.win.innerHeight === 0) return false;
    return deterministicUnit(this.session.visitorId()) < this.config.sample;
  }

  start(): void {
    this.active = this.passesBotAndSample();
    if (!this.active) return;
    if (this.config.capture.click) this.autocapture.start();
    if (this.config.capture.route) this.routing.start();
    if (this.config.capture.scroll) this.attachScroll();
    this.transport.start(this.env.win, this.env.doc);
    this.maybeEmitInitialPageview();
  }

  private attachScroll(): void {
    this.env.win.addEventListener(
      "scroll",
      () => {
        if (this.active) this.scroll.update(this.env.scrollMetrics(), this.env.now());
      },
      true,
    );
  }

  setConsent(state: ConsentState): void {
    this.consent.set(state);
    this.maybeEmitInitialPageview();
  }

  private maybeEmitInitialPageview(): void {
    if (!this.active || this.pageviewEmitted || !this.consent.isCollectionAllowed()) return;
    this.pageviewEmitted = true;
    this.emitPageview("navigation");
  }

  private onRoute(kind: string, from: string, to: string): void {
    this.autocapture.notifyRouteChange();
    this.record("route", { from, to, kind });
    this.emitPageview("spa");
  }

  private emitPageview(nav: "navigation" | "spa"): void {
    this.pvid = this.env.newId();
    this.scroll.reset();
    const props: EventProps = {
      title: (this.env.doc.title ?? "").slice(0, 256),
      vw: this.env.win.innerWidth,
      vh: this.env.win.innerHeight,
      nav,
    };
    this.record("pv", props, normalizeReferrer(this.env.doc.referrer));
  }

  private currentPath(): string {
    return normalizePath(`${this.env.win.location.pathname}${this.env.win.location.search}`, this.config.captureQueryParams);
  }

  /** The one pipeline every event flows through. Consent gate is unconditional (HAC-02). */
  private record(type: WireEventType, props: EventProps, ref?: string): void {
    if (!this.active || !this.consent.isCollectionAllowed()) return;
    const now = this.env.now();
    const { transition } = this.session.touch(now);
    if (transition) {
      if (transition.ended) this.enqueue("s_end", { sid: transition.ended.sid, reason: transition.ended.reason, dur: transition.ended.durationMs }, now);
      this.seq = 0;
      this.enqueue("s_start", { sid: transition.started.sid, reason: transition.started.reason }, now);
    }
    this.enqueue(type, props, now, ref);
  }

  private enqueue(type: WireEventType, props: EventProps, now: number, ref?: string): void {
    const event: WireEvent = { eid: this.env.newId(), t: type, ts: now, p: this.currentPath(), props: { ...props, pvid: this.pvid, seq: this.seq } };
    this.seq += 1;
    if (ref) event.ref = ref;
    this.transport.enqueue(event);
    if (this.config.debug) (this.env.win as Window & typeof globalThis).console.debug?.("[ml]", type, event.props);
  }
}

/** Build the production environment from a real window (used by loader.ts). */
export function browserEnv(win: Window): CollectorEnv {
  const doc = win.document;
  const localStore: Store | null = safeLocalStore(win);
  const store = new BrowserStore({ cookie: { get: () => doc.cookie, set: (value) => { doc.cookie = value; } }, localStorage: localStore });
  const nav = win.navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const winDnt = (win as Window & { doNotTrack?: string }).doNotTrack;
  return {
    win,
    doc,
    now: () => Date.now(),
    isoNow: () => new Date().toISOString(),
    newId: () => win.crypto.randomUUID(),
    store,
    sender: new BrowserSender(win),
    scheduler: { set: (fn, ms) => win.setTimeout(fn, ms) as unknown as number, clear: (handle) => win.clearTimeout(handle) },
    scrollMetrics: () => ({ scrollTop: win.scrollY || doc.documentElement.scrollTop || 0, viewport: win.innerHeight || 0, scrollHeight: doc.documentElement.scrollHeight || 0 }),
    signals: { gpc: nav.globalPrivacyControl === true, dnt: nav.doNotTrack === "1" || winDnt === "1" || nav.msDoNotTrack === "1" },
    webdriver: nav.webdriver === true,
  };
}

function safeLocalStore(win: Window): Store | null {
  try {
    const ls = win.localStorage;
    const probe = "ml_probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return { get: (key) => ls.getItem(key), set: (key, value) => ls.setItem(key, value), remove: (key) => ls.removeItem(key) };
  } catch {
    return new MemoryStore(); // private mode / disabled storage — fall back to memory.
  }
}

/** Merge partial user config over defaults, keeping nested capture/batch objects intact. */
export function resolveConfig(input: Partial<CollectorConfig> & { key: string }): CollectorConfig {
  return {
    ...DEFAULT_CONFIG,
    ...input,
    capture: { ...DEFAULT_CONFIG.capture, ...input.capture },
    batch: { ...DEFAULT_CONFIG.batch, ...input.batch },
  };
}
