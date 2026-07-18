// rrweb 2.1.0 binding for the collector's injected RecordingEngine contract.
// research.md (session-replay) §1·§3: the SDK stays dependency-free and receives the
// engine through `loadEngine`, so rrweb is vendored HERE and loaded lazily — nothing
// downloads or runs before an explicit replay grant (SR-01). The privacy options
// below are hardening only: the engine-agnostic sanitizer and the server privacy
// rejection still apply to every emitted event, whatever the engine settings say.

type EmitFn = (event: unknown) => void;

/** Structural mirror of packages/collector replay-recorder.ts `RecordingEngine`. */
export type RecordingEngine = {
  start(emit: EmitFn): () => void;
};

/** The subset of the rrweb `record` entry point this binding relies on. */
export type RrwebRecordFn = (options: Record<string, unknown> & { emit: EmitFn }) => (() => void) | undefined;

// Defaults in rrweb collect rather than mask, so every privacy-relevant option is
// pinned explicitly. Host policy may only add masked/blocked regions on top.
export const RRWEB_PRIVACY_OPTIONS = {
  maskAllInputs: true,
  maskTextSelector: "*",
  maskTextClass: "ml-mask",
  blockSelector: ".ml-block,[data-ml-block]",
  blockClass: "ml-block",
  inlineStylesheet: false,
  inlineImages: false,
  recordCanvas: false,
  collectFonts: false,
  recordCrossOriginIframes: false,
  slimDOMOptions: "all",
} as const;

export function createRrwebEngine(record: RrwebRecordFn): RecordingEngine {
  return {
    start(emit: EmitFn): () => void {
      const stop = record({ ...RRWEB_PRIVACY_OPTIONS, emit });
      return () => stop?.();
    },
  };
}

/** Lazy vendored-engine loader: the rrweb chunk is fetched only when this runs. */
export async function loadRrwebEngine(): Promise<RecordingEngine> {
  const rrweb = await import("@rrweb/record");
  return createRrwebEngine(rrweb.record as unknown as RrwebRecordFn);
}
