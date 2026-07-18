// Workspace dogfood wiring for the replay recorder. spec.md (session-replay) §12
// step 7: the first recorded surface is the owner's own workspace on loopback. This
// wires the collector's consent gate → recorder → bounded chunks to the vendored
// rrweb engine and the replay ingest wire — every privacy layer (separate consent,
// GPC/DNT block, hard sanitizer, quotas, server rejection) stays exactly as the SDK
// enforces it; nothing here weakens or reimplements a rule.

import { DEFAULT_REPLAY_QUOTAS, type ReplayChunkEnvelope } from "../../../../packages/collector/src/replay-chunk.ts";
import { ReplayConsentGate, REPLAY_PURPOSE_VERSION, type ReplayConsentState } from "../../../../packages/collector/src/replay-consent.ts";
import { ReplayRecorder, type RecordingEngine, type ReplayRecorderState } from "../../../../packages/collector/src/replay-recorder.ts";
import type { PrivacySignals } from "../../../../packages/collector/src/consent.ts";
import type { Store } from "../../../../packages/collector/src/storage.ts";
import { loadRrwebEngine } from "./rrweb-engine.ts";

export type DogfoodRecorderDeps = {
  siteKey: string;
  store: Store;
  signals: PrivacySignals;
  send: (envelope: ReplayChunkEnvelope) => void;
  loadEngine?: () => Promise<RecordingEngine>;
  now?: () => number;
  createId?: () => string;
};

export type DogfoodRecorder = {
  consent(): ReplayConsentState;
  state(): ReplayRecorderState;
  recordingId(): string | null;
  /** Explicit grant for the replay purpose, then start. GPC/DNT still block. */
  grant(): Promise<ReplayRecorderState>;
  /** Stop, drop unsent buffers, persist the withdrawn state. */
  withdraw(): void;
  /** Normal end: flush the bounded final chunk. */
  end(): void;
};

export function createDogfoodRecorder(deps: DogfoodRecorderDeps): DogfoodRecorder {
  const createId = deps.createId ?? (() => crypto.randomUUID());
  const gate = new ReplayConsentGate(deps.store, deps.signals);
  const recorder = new ReplayRecorder({
    gate,
    loadEngine: deps.loadEngine ?? loadRrwebEngine,
    send: deps.send,
    siteKey: deps.siteKey,
    // Dogfood identifiers are per-recorder random: nothing links two sessions.
    sessionId: createId(),
    anonymousId: createId(),
    purposeVersion: REPLAY_PURPOSE_VERSION,
    quotas: DEFAULT_REPLAY_QUOTAS,
    now: deps.now ?? (() => Date.now()),
    createRecordingId: createId,
  });
  return {
    consent: () => gate.current(),
    state: () => recorder.current(),
    recordingId: () => recorder.currentRecordingId(),
    async grant() {
      gate.set("granted");
      return recorder.start();
    },
    withdraw() {
      recorder.withdraw();
    },
    end() {
      recorder.end();
    },
  };
}

/** Browser defaults: localStorage-backed consent, real GPC/DNT, beacon-or-fetch send. */
export function createBrowserDogfoodRecorder(siteKey: string): DogfoodRecorder {
  const storage = window.localStorage;
  const store: Store = {
    get(key) {
      try { return storage.getItem(`ux-measure-lab.${key}`); } catch { return null; }
    },
    set(key, value) {
      try { storage.setItem(`ux-measure-lab.${key}`, value); } catch { return; }
    },
    remove(key) {
      try { storage.removeItem(`ux-measure-lab.${key}`); } catch { return; }
    },
  };
  const navigatorSignals = navigator as Navigator & { globalPrivacyControl?: boolean };
  const signals: PrivacySignals = {
    gpc: navigatorSignals.globalPrivacyControl === true,
    dnt: navigator.doNotTrack === "1",
  };
  const send = (envelope: ReplayChunkEnvelope) => {
    const body = JSON.stringify(envelope);
    // A plain fetch is the primary path: unlike keepalive/sendBeacon (both capped at
    // ~64KB), it carries a full-snapshot chunk of any size. text/plain keeps it a
    // simple request (no preflight). Owner recordings end on an explicit click, so the
    // page is alive when this runs. The pagehide flush below is a separate best-effort
    // beacon for the unload edge — small buffers only.
    if (typeof fetch === "function") {
      void fetch("/api/replay/ingest", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
      }).catch(() => undefined);
      return;
    }
    navigator.sendBeacon?.("/api/replay/ingest", new Blob([body], { type: "text/plain" }));
  };
  return createDogfoodRecorder({ siteKey, store, signals, send });
}
