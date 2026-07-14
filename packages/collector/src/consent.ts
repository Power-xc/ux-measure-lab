// Consent gate. research-sdk.md §3.3 + spec.md HAC-02: with requireConsent on
// (the default), NOTHING is queued or sent before consent is granted. GPC/DNT
// signals, when respected, are interpreted as a hard block on collection.

import type { Store } from "./storage.ts";

export type ConsentState = "unknown" | "granted" | "denied";

const CONSENT_KEY = "ml_consent";

/** Privacy signals read from the environment (Global Privacy Control, Do Not Track). */
export interface PrivacySignals {
  /** navigator.globalPrivacyControl === true */
  gpc: boolean;
  /** navigator.doNotTrack / window.doNotTrack === "1" */
  dnt: boolean;
}

export interface ConsentConfig {
  /** When true (default), collection is blocked until state === "granted". */
  requireConsent: boolean;
  /** When true, a GPC or DNT signal forces a hard block. */
  respectGpc: boolean;
}

export class ConsentGate {
  private state: ConsentState;
  private readonly store: Store;
  private readonly config: ConsentConfig;
  private readonly signals: PrivacySignals;

  constructor(store: Store, config: ConsentConfig, signals: PrivacySignals) {
    this.store = store;
    this.config = config;
    this.signals = signals;
    const persisted = store.get(CONSENT_KEY);
    this.state = persisted === "granted" || persisted === "denied" ? persisted : "unknown";
  }

  /** Record an explicit user decision and persist it. */
  set(state: ConsentState): void {
    this.state = state;
    if (state === "unknown") this.store.remove(CONSENT_KEY);
    else this.store.set(CONSENT_KEY, state);
  }

  current(): ConsentState {
    return this.state;
  }

  private privacyBlocked(): boolean {
    return this.config.respectGpc && (this.signals.gpc || this.signals.dnt);
  }

  /**
   * The single authority for "may we collect right now?". A respected GPC/DNT signal
   * blocks unconditionally. With requireConsent, only an explicit grant unblocks.
   */
  isCollectionAllowed(): boolean {
    if (this.privacyBlocked()) return false;
    if (!this.config.requireConsent) return this.state !== "denied";
    return this.state === "granted";
  }
}
