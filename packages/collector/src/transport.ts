// Batching + delivery. research-sdk.md §5.5:
// - flush on maxEvents(20) OR maxWaitMs(5s) OR visibilitychange→hidden / pagehide.
// - normal flush: fetch keepalive POST, Content-Type text/plain (a CORS "simple"
//   request → no preflight, §4). terminal flush: navigator.sendBeacon, fire-and-forget.
// - failed normal flush retries with bounded exponential backoff; the buffer is capped
//   (loss tolerated). Sender + scheduler are injected so tests are deterministic.

import type { WireEvent } from "./schema.ts";

export interface Sender {
  /** Normal flush. Resolves true when accepted (2xx), false on network/5xx. */
  post(url: string, body: string): Promise<boolean>;
  /** Terminal flush. Fire-and-forget; returns whether the agent queued the send. */
  beacon(url: string, body: string): boolean;
}

export interface Scheduler {
  set(fn: () => void, ms: number): number;
  clear(handle: number): void;
}

export interface TransportConfig {
  maxEvents: number;
  maxWaitMs: number;
  maxBufferEvents: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxRetries: number;
}

export const DEFAULT_TRANSPORT: TransportConfig = {
  maxEvents: 20,
  maxWaitMs: 5000,
  maxBufferEvents: 1000,
  baseBackoffMs: 1000,
  maxBackoffMs: 30_000,
  maxRetries: 5,
};

/** Production sender backed by the browser's fetch + sendBeacon. */
export class BrowserSender implements Sender {
  private readonly win: Window;

  constructor(win: Window) {
    this.win = win;
  }

  async post(url: string, body: string): Promise<boolean> {
    try {
      const response = await this.win.fetch(url, {
        method: "POST",
        body,
        keepalive: true,
        headers: { "Content-Type": "text/plain" },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  beacon(url: string, body: string): boolean {
    const nav = this.win.navigator;
    if (typeof nav.sendBeacon !== "function") return false;
    return nav.sendBeacon(url, new Blob([body], { type: "text/plain" }));
  }
}

interface TransportDeps {
  url: string;
  sender: Sender;
  scheduler: Scheduler;
  serialize: (events: WireEvent[]) => string;
  config?: Partial<TransportConfig>;
}

export class Transport {
  private readonly deps: TransportDeps;
  private readonly config: TransportConfig;
  private buffer: WireEvent[] = [];
  private timer: number | null = null;
  private detach: Array<() => void> = [];

  constructor(deps: TransportDeps) {
    this.deps = deps;
    this.config = { ...DEFAULT_TRANSPORT, ...deps.config };
  }

  pendingCount(): number {
    return this.buffer.length;
  }

  /** Attach lifecycle listeners so page-hide always attempts a terminal flush. */
  start(win: Window, doc: Document): void {
    const onHide = (): void => {
      if (doc.visibilityState === "hidden") this.flushTerminal();
    };
    const onPageHide = (): void => this.flushTerminal();
    doc.addEventListener("visibilitychange", onHide);
    win.addEventListener("pagehide", onPageHide);
    this.detach = [() => doc.removeEventListener("visibilitychange", onHide), () => win.removeEventListener("pagehide", onPageHide)];
  }

  stop(): void {
    for (const off of this.detach) off();
    this.detach = [];
    this.clearTimer();
  }

  enqueue(event: WireEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.config.maxBufferEvents) {
      this.buffer.splice(0, this.buffer.length - this.config.maxBufferEvents); // drop oldest; loss tolerated.
    }
    if (this.buffer.length >= this.config.maxEvents) {
      this.flush();
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer !== null) return;
    this.timer = this.deps.scheduler.set(() => {
      this.timer = null;
      this.flush();
    }, this.config.maxWaitMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.deps.scheduler.clear(this.timer);
      this.timer = null;
    }
  }

  private drain(): WireEvent[] {
    this.clearTimer();
    return this.buffer.splice(0, this.buffer.length);
  }

  /** Normal flush over fetch keepalive, with bounded retry on failure. */
  flush(): void {
    if (this.buffer.length === 0) return;
    void this.send(this.drain(), 0);
  }

  private async send(batch: WireEvent[], attempt: number): Promise<void> {
    const ok = await this.deps.sender.post(this.deps.url, this.deps.serialize(batch));
    if (ok || attempt >= this.config.maxRetries) return;
    const delay = Math.min(this.config.baseBackoffMs * 2 ** attempt, this.config.maxBackoffMs);
    this.deps.scheduler.set(() => void this.send(batch, attempt + 1), delay);
  }

  /** Terminal flush on page hide: sendBeacon, no retry (loss accepted). */
  flushTerminal(): void {
    if (this.buffer.length === 0) return;
    const batch = this.drain();
    const body = this.deps.serialize(batch);
    if (!this.deps.sender.beacon(this.deps.url, body)) void this.deps.sender.post(this.deps.url, body);
  }
}
