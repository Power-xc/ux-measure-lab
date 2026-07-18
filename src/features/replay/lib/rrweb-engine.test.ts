import assert from "node:assert/strict";
import test from "node:test";
import { createRrwebEngine, RRWEB_PRIVACY_OPTIONS, type RrwebRecordFn } from "./rrweb-engine.ts";

test("ENGINE-01 the binding pins every privacy-relevant rrweb option to the hardened value", () => {
  let seen: Record<string, unknown> | null = null;
  const record: RrwebRecordFn = (options) => {
    seen = options;
    return () => undefined;
  };
  createRrwebEngine(record).start(() => undefined);

  assert.ok(seen, "record must be called with options");
  const options = seen as Record<string, unknown>;
  assert.equal(options.maskAllInputs, true);
  assert.equal(options.maskTextSelector, "*");
  assert.equal(options.maskTextClass, "ml-mask");
  assert.equal(options.blockClass, "ml-block");
  assert.ok(String(options.blockSelector).includes("[data-ml-block]"));
  assert.equal(options.inlineStylesheet, false);
  assert.equal(options.inlineImages, false);
  assert.equal(options.recordCanvas, false);
  assert.equal(options.collectFonts, false);
  assert.equal(options.recordCrossOriginIframes, false);
  assert.equal(options.slimDOMOptions, "all");
  // The exported constant is what the binding actually sends — no drift.
  for (const [key, value] of Object.entries(RRWEB_PRIVACY_OPTIONS)) assert.equal(options[key], value);
});

test("ENGINE-02 emitted events reach the recorder callback and stop tears the engine down", () => {
  const emitted: unknown[] = [];
  let stopped = 0;
  const record: RrwebRecordFn = (options) => {
    options.emit({ type: 3, timestamp: 1 });
    return () => {
      stopped += 1;
    };
  };
  const stop = createRrwebEngine(record).start((event) => emitted.push(event));
  assert.deepEqual(emitted, [{ type: 3, timestamp: 1 }]);
  stop();
  assert.equal(stopped, 1);
});

test("ENGINE-03 a record entry point without a stop function still yields a safe stop", () => {
  const record: RrwebRecordFn = () => undefined;
  const stop = createRrwebEngine(record).start(() => undefined);
  assert.doesNotThrow(() => stop());
});
