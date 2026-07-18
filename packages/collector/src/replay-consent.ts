// Replay consent gate. spec.md (session-replay) §2/§6: replay is a SEPARATE purpose.
// Behavior-collection consent never implies replay consent, and a respected GPC/DNT
// signal blocks recording unconditionally. Withdrawal is a distinct state so the
// recorder can stop, clear unsent buffers and refuse automatic restarts.

import type { PrivacySignals } from "./consent.ts";
import type { Store } from "./storage.ts";

export type ReplayConsentState = "unknown" | "granted" | "denied" | "withdrawn";

const REPLAY_CONSENT_KEY = "ml_replay_consent";
const STATES: readonly ReplayConsentState[] = ["unknown", "granted", "denied", "withdrawn"];

/** Version of the consent purpose text shown to the visitor. Sent with every chunk. */
export const REPLAY_PURPOSE_VERSION = "replay-v1";

export class ReplayConsentGate {
  private state: ReplayConsentState;
  private readonly store: Store;
  private readonly signals: PrivacySignals;

  constructor(store: Store, signals: PrivacySignals) {
    this.store = store;
    this.signals = signals;
    const persisted = store.get(REPLAY_CONSENT_KEY);
    this.state = STATES.includes(persisted as ReplayConsentState) && persisted !== "unknown"
      ? persisted as ReplayConsentState
      : "unknown";
  }

  set(state: ReplayConsentState): void {
    this.state = state;
    if (state === "unknown") this.store.remove(REPLAY_CONSENT_KEY);
    else this.store.set(REPLAY_CONSENT_KEY, state);
  }

  current(): ReplayConsentState {
    return this.state;
  }

  /** Recording may only run on an explicit grant, never on the behavior-collection consent. */
  isRecordingAllowed(): boolean {
    if (this.signals.gpc || this.signals.dnt) return false;
    return this.state === "granted";
  }
}
