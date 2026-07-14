// Click autocapture, rage/dead detection, and the selector builder.
// research-sdk.md §3.4 (selector policy), §6 (deterministic detection algorithms).
// Detectors are pure, clock-injected classes so tests drive them with fixed
// timestamps (spec.md HAC-04). AutoCapture wires them to a real document.

import type { EmitFn } from "./schema.ts";
import { boundedText, isSensitiveTarget } from "./mask.ts";

// --- selector builder -------------------------------------------------------

// Hashy / generated class or id: excluded from selectors (§3.4). Heuristic → NOT_CHECKED.
const HASHY_PREFIX_RE = /^(css-|sc-|jsx-|emotion-|styled-)/i;
const HASH_RUN_RE = /[0-9a-f]{6,}/i;
const SHORT_PREFIX_HASH_RE = /^[a-z]{1,3}[-_][a-z0-9]{5,}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;

function isHashyOrToken(value: string): boolean {
  return HASHY_PREFIX_RE.test(value) || SHORT_PREFIX_HASH_RE.test(value) || TOKEN_RE.test(value) || (HASH_RUN_RE.test(value) && /\d/.test(value));
}

function escapeIdentifier(value: string): string {
  const globalCss = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;
  return globalCss?.escape ? globalCss.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function safeClasses(element: Element): string[] {
  return Array.from(element.classList)
    .filter((cls) => !isHashyOrToken(cls))
    .slice(0, 1);
}

function nthOfType(element: Element): number {
  let index = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === element.tagName) index += 1;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function elementToken(element: Element): { token: string; anchored: boolean } {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  if (id && !isHashyOrToken(id)) return { token: `${tag}#${escapeIdentifier(id)}`, anchored: true };
  const classes = safeClasses(element)
    .map((cls) => `.${escapeIdentifier(cls)}`)
    .join("");
  return { token: `${tag}${classes}:nth-of-type(${nthOfType(element)})`, anchored: false };
}

/**
 * Build a stable-ish CSS selector for a click target. `data-ml-name` wins when present
 * (the recommended, stable escape hatch). Otherwise climb up to `maxDepth` ancestors
 * using tag + safe #id + one whitelisted class + :nth-of-type. Text is never included.
 */
export function buildSelector(target: Element, maxDepth = 5): string {
  const explicit = target.getAttribute("data-ml-name");
  if (explicit) return `[data-ml-name="${escapeIdentifier(explicit)}"]`;

  const parts: string[] = [];
  let element: Element | null = target;
  let depth = 0;
  while (element && depth < maxDepth && element.nodeType === 1) {
    const { token, anchored } = elementToken(element);
    parts.unshift(token);
    if (anchored) break; // a safe #id uniquely anchors the path — stop climbing.
    element = element.parentElement;
    depth += 1;
  }
  return parts.join(" > ");
}

// --- rage detection ---------------------------------------------------------

export interface RageConfig {
  radiusPx: number;
  windowMs: number;
  needed: number;
}

export const DEFAULT_RAGE: RageConfig = { radiusPx: 30, windowMs: 1000, needed: 3 };

/** Deterministic rage cluster detector (PostHog $rageclick definition, §6). */
export class RageDetector {
  private last: { x: number; y: number; t: number } | null = null;
  private count = 0;
  private firstT = 0;
  private readonly config: RageConfig;

  constructor(config: RageConfig = DEFAULT_RAGE) {
    this.config = config;
  }

  /** Register a click; returns { rage:true } and resets when a cluster completes. */
  register(x: number, y: number, t: number): { rage: boolean; n: number; t0: number } {
    const near = this.last !== null && t - this.last.t <= this.config.windowMs && Math.hypot(x - this.last.x, y - this.last.y) <= this.config.radiusPx;
    if (near) {
      this.count += 1;
    } else {
      this.count = 1;
      this.firstT = t;
    }
    this.last = { x, y, t };
    if (this.count >= this.config.needed) {
      const result = { rage: true, n: this.count, t0: this.firstT };
      this.reset();
      return result;
    }
    return { rage: false, n: this.count, t0: this.firstT };
  }

  reset(): void {
    this.last = null;
    this.count = 0;
    this.firstT = 0;
  }
}

// --- dead-click detection ---------------------------------------------------

export const DEFAULT_DEAD_WAIT_MS = 3000; // Our default; PostHog's exact value NOT_CHECKED (§6).

/**
 * Deterministic dead-click detector. A click is "dead" if none of URL change,
 * subtree mutation, scroll, or selection change happens within `waitedMs`.
 * The detector holds no timers: `notifyActivity` cancels, `resolve(now)` decides.
 */
export class DeadClickDetector {
  private pending: { sel: string; clickedAt: number } | null = null;
  private readonly waitedMs: number;

  constructor(waitedMs: number = DEFAULT_DEAD_WAIT_MS) {
    this.waitedMs = waitedMs;
  }

  register(sel: string, now: number): void {
    this.pending = { sel, clickedAt: now };
  }

  /** Any qualifying activity cancels the pending dead-click check. */
  notifyActivity(): void {
    this.pending = null;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  /** Resolve at `now`; emits a dead observation only if the wait elapsed unresolved. */
  resolve(now: number): { sel: string; waited: number } | null {
    if (!this.pending) return null;
    const waited = now - this.pending.clickedAt;
    if (waited < this.waitedMs) return null;
    const result = { sel: this.pending.sel, waited };
    this.pending = null;
    return result;
  }
}

// --- wiring ------------------------------------------------------------------

export interface AutoCaptureConfig {
  rage: boolean;
  dead: boolean;
  captureText: boolean;
  deadWaitMs: number;
}

interface AutoCaptureDeps {
  doc: Document;
  win: Window;
  now: () => number;
  emit: EmitFn;
  config: AutoCaptureConfig;
}

/**
 * Attaches a capture-phase click listener plus scroll/selection listeners that feed
 * the dead-click detector. Uses composedPath()[0] to recover the real target across
 * open shadow boundaries (§5.6). Never reads input values (mask.isSensitiveTarget).
 */
export class AutoCapture {
  private readonly deps: AutoCaptureDeps;
  private readonly rage = new RageDetector();
  private readonly dead: DeadClickDetector;
  private deadTimer: ReturnType<typeof setTimeout> | null = null;
  private detach: Array<() => void> = [];

  constructor(deps: AutoCaptureDeps) {
    this.deps = deps;
    this.dead = new DeadClickDetector(deps.config.deadWaitMs);
  }

  start(): void {
    const { doc, win } = this.deps;
    const onClick = (event: Event): void => this.handleClick(event as MouseEvent);
    const cancelDead = (): void => this.dead.notifyActivity();
    doc.addEventListener("click", onClick, true);
    win.addEventListener("scroll", cancelDead, true);
    doc.addEventListener("selectionchange", cancelDead, true);
    this.detach = [
      () => doc.removeEventListener("click", onClick, true),
      () => win.removeEventListener("scroll", cancelDead, true),
      () => doc.removeEventListener("selectionchange", cancelDead, true),
    ];
  }

  stop(): void {
    for (const off of this.detach) off();
    this.detach = [];
    if (this.deadTimer !== null) clearTimeout(this.deadTimer);
  }

  /** Called by routing when the URL changes — a route change cancels a pending dead click. */
  notifyRouteChange(): void {
    this.dead.notifyActivity();
  }

  private originTarget(event: MouseEvent): Element | null {
    // composedPath()[0] recovers the real target across open shadow boundaries (§5.6).
    // Duck-type on nodeType rather than `instanceof Element`: the SDK runs against the
    // page's own Element constructor, which is not this realm's global.
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const candidate = path.length > 0 ? path[0] : event.target;
    if (candidate && (candidate as unknown as Node).nodeType === 1) return candidate as unknown as Element;
    return null;
  }

  private handleClick(event: MouseEvent): void {
    const target = this.originTarget(event);
    if (!target) return;
    const sel = buildSelector(target);
    const sensitive = isSensitiveTarget(target);
    const x = Math.round(event.clientX);
    const y = Math.round(event.clientY);
    const now = this.deps.now();

    const props = {
      sel,
      tag: target.tagName.toLowerCase(),
      role: target.getAttribute("role"),
      has_text: !sensitive && (target.textContent ?? "").trim().length > 0,
      x,
      y,
      btn: event.button,
      text: boundedText(target, this.deps.config.captureText) ?? null,
    };
    this.deps.emit("click", props);

    if (this.deps.config.rage) {
      const cluster = this.rage.register(x, y, now);
      if (cluster.rage) {
        this.deps.emit("rage", { sel, n: cluster.n, t0: cluster.t0 });
        this.dead.notifyActivity(); // a rage cluster is activity, not a dead click.
        return;
      }
    }
    if (this.deps.config.dead) this.armDeadCheck(sel, now, target);
  }

  private armDeadCheck(sel: string, now: number, target: Element): void {
    this.dead.register(sel, now);
    // MutationObserver lives on the page's window, not this realm's global scope.
    const observer = new (this.deps.win as Window & typeof globalThis).MutationObserver(() => this.dead.notifyActivity());
    observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
    if (this.deadTimer !== null) clearTimeout(this.deadTimer);
    this.deadTimer = setTimeout(() => {
      observer.disconnect();
      const result = this.dead.resolve(this.deps.now());
      if (result) this.deps.emit("dead", { sel: result.sel, waited: result.waited });
    }, this.deps.config.deadWaitMs);
  }
}
