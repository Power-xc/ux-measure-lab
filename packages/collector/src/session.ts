// Session + visitor identity. research-sdk.md §5.1–§5.2 and spec.md §4:
// - vid persists across sessions; sid rotates.
// - 30min inactivity OR 24h hard cap ends a session (no midnight rollover, §5.4).
// - State lives in the shared Store (cookie/localStorage), never sessionStorage,
//   so a session spans multiple tabs of the same browser.
// Clock and id generator are injected so timeout arithmetic is deterministic in tests.

import type { SessionReason } from "./schema.ts";
import type { Store } from "./storage.ts";

const VID_KEY = "ml_vid";
const SESSION_KEY = "ml_ses";

export const DEFAULT_IDLE_MS = 1_800_000; // 30 minutes
export const MAX_SESSION_MS = 86_400_000; // 24 hours

interface SessionRecord {
  sid: string;
  startedAt: number;
  lastActivityAt: number;
}

/**
 * A session boundary crossing. `ended` is null for the first-ever session (nothing
 * to close); otherwise it names why the previous session ended. `started.reason`
 * carries the trigger: "new" for the first session, else the same cause as `ended`.
 */
export interface SessionTransition {
  ended: { sid: string; reason: Exclude<SessionReason, "new">; durationMs: number } | null;
  started: { sid: string; reason: SessionReason };
}

export interface SessionConfig {
  idleMs: number;
  maxDurationMs: number;
}

export class SessionManager {
  private readonly store: Store;
  private readonly newId: () => string;
  private readonly config: SessionConfig;
  private readonly vid: string;

  constructor(store: Store, deps: { newId: () => string; config?: Partial<SessionConfig> }) {
    this.store = store;
    this.newId = deps.newId;
    this.config = {
      idleMs: deps.config?.idleMs ?? DEFAULT_IDLE_MS,
      maxDurationMs: deps.config?.maxDurationMs ?? MAX_SESSION_MS,
    };
    this.vid = this.loadOrCreateVisitor();
  }

  visitorId(): string {
    return this.vid;
  }

  /** Current session id if one is active, else null. Used to stamp the batch envelope. */
  currentSid(): string | null {
    return this.read()?.sid ?? null;
  }

  private loadOrCreateVisitor(): string {
    const existing = this.store.get(VID_KEY);
    if (existing) return existing;
    const created = this.newId();
    this.store.set(VID_KEY, created);
    return created;
  }

  private read(): SessionRecord | null {
    const raw = this.store.get(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<SessionRecord>;
      if (typeof parsed.sid !== "string" || typeof parsed.startedAt !== "number" || typeof parsed.lastActivityAt !== "number") return null;
      return { sid: parsed.sid, startedAt: parsed.startedAt, lastActivityAt: parsed.lastActivityAt };
    } catch {
      return null;
    }
  }

  private write(record: SessionRecord): void {
    this.store.set(SESSION_KEY, JSON.stringify(record));
  }

  private begin(now: number): SessionRecord {
    const record: SessionRecord = { sid: this.newId(), startedAt: now, lastActivityAt: now };
    this.write(record);
    return record;
  }

  /**
   * Register activity at `now` and return the current session id plus any boundary
   * transition that occurred. The caller emits s_end/s_start for a returned transition.
   */
  touch(now: number): { sid: string; transition: SessionTransition | null } {
    const current = this.read();
    if (!current) {
      const fresh = this.begin(now);
      return { sid: fresh.sid, transition: { ended: null, started: { sid: fresh.sid, reason: "new" } } };
    }

    const idle = now - current.lastActivityAt;
    const age = now - current.startedAt;
    const reason: Exclude<SessionReason, "new"> | null = idle > this.config.idleMs ? "timeout" : age > this.config.maxDurationMs ? "maxdur" : null;

    if (reason) {
      const endedSid = current.sid;
      const endedDuration = current.lastActivityAt - current.startedAt;
      const fresh = this.begin(now);
      return { sid: fresh.sid, transition: { ended: { sid: endedSid, reason, durationMs: endedDuration }, started: { sid: fresh.sid, reason } } };
    }

    this.write({ ...current, lastActivityAt: now });
    return { sid: current.sid, transition: null };
  }
}
