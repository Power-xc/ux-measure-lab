// Replay payload sanitizer. spec.md (session-replay) §6: masking is the default,
// input values are a hard block no configuration can weaken, and host overrides may
// only strengthen the policy. The sanitizer walks engine-emitted serialized events,
// so the same hard rules apply no matter which recording engine produced them.

import { normalizePath } from "./mask.ts";

export type ReplayMaskPolicy = {
  /** Extra class names whose subtree is removed entirely (adds to ml-block). */
  blockClasses?: readonly string[];
  /** Extra class names whose text/attributes are masked (adds to ml-mask). */
  maskClasses?: readonly string[];
};

type UnknownRecord = Record<string, unknown>;

const BLOCK_CLASSES = ["ml-block"];
const MASK_CLASSES = ["ml-mask"];
const BLOCK_ATTRIBUTES = ["data-ml-block"];
const VALUE_BEARING_TAGS = ["input", "textarea", "select", "option"];
const BLOCKED_TAGS = ["iframe", "canvas", "video", "audio", "object", "embed", "style"];
const TEXT_ATTRIBUTES = ["title", "alt", "placeholder", "aria-label", "aria-description", "label"];
const URL_ATTRIBUTES = ["href", "src", "poster", "action", "formaction"];
const EVENT_HANDLER_RE = /^on/i;
const DANGEROUS_URL_RE = /^\s*(javascript|data|vbscript):/i;
const MAX_DEPTH = 64;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

/** Every non-whitespace character becomes a bullet so layout survives without content. */
export function maskText(value: string): string {
  return value.replace(/\S/g, "*");
}

function classListOf(attributes: UnknownRecord): string[] {
  const raw = attributes.class;
  return typeof raw === "string" ? raw.split(/\s+/).filter(Boolean) : [];
}

function scrubUrl(value: string): string {
  if (DANGEROUS_URL_RE.test(value)) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${normalizePath(`${url.pathname}${url.search}`)}`;
  } catch {
    return normalizePath(value);
  }
}

type NodeVerdict = "keep" | "mask" | "block";

function judgeNode(node: UnknownRecord, policy: Required<ReplayMaskPolicy>): NodeVerdict {
  const attributes = record(node.attributes) ?? {};
  const classes = classListOf(attributes);
  if (classes.some((name) => policy.blockClasses.includes(name))) return "block";
  if (BLOCK_ATTRIBUTES.some((attribute) => attribute in attributes)) return "block";
  const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  if (BLOCKED_TAGS.includes(tag)) return "block";
  if (classes.some((name) => policy.maskClasses.includes(name))) return "mask";
  return "keep";
}

function sanitizeAttributes(node: UnknownRecord): void {
  const attributes = record(node.attributes);
  if (!attributes) return;
  const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  for (const key of Object.keys(attributes)) {
    const value = attributes[key];
    if (EVENT_HANDLER_RE.test(key)) {
      delete attributes[key];
      continue;
    }
    if (typeof value !== "string") continue;
    // Hard rule: form values never survive, regardless of tag-level judgement.
    if (key === "value" || key === "checked" || key === "selected") delete attributes[key];
    else if (URL_ATTRIBUTES.includes(key)) {
      const scrubbed = scrubUrl(value);
      if (scrubbed) attributes[key] = scrubbed;
      else delete attributes[key];
    } else if (TEXT_ATTRIBUTES.includes(key)) attributes[key] = maskText(value);
  }
  if (VALUE_BEARING_TAGS.includes(tag)) {
    delete attributes.value;
    delete attributes.checked;
    delete attributes.selected;
  }
}

function sanitizeNode(node: UnknownRecord, policy: Required<ReplayMaskPolicy>, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (judgeNode(node, policy) === "block") return false;
  sanitizeAttributes(node);
  if (typeof node.textContent === "string") node.textContent = maskText(node.textContent);
  const children = Array.isArray(node.childNodes) ? node.childNodes : [];
  node.childNodes = children.filter((child): child is UnknownRecord => {
    const item = record(child);
    return item !== null && sanitizeNode(item, policy, depth + 1);
  });
  return true;
}

function sanitizeValue(value: unknown, policy: Required<ReplayMaskPolicy>, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item, policy, depth + 1))
      .filter((item) => item !== null);
  }
  const item = record(value);
  if (!item) return value;
  // Serialized DOM subtrees carry childNodes/tagName; everything else is engine metadata.
  if ("childNodes" in item || "tagName" in item || "textContent" in item) {
    return sanitizeNode(item, policy, depth + 1) ? item : null;
  }
  for (const key of Object.keys(item)) {
    if (key === "text") {
      if (typeof item.text === "string") item.text = maskText(item.text);
      continue;
    }
    if ((key === "href" || key === "url" || key === "src") && typeof item[key] === "string") {
      item[key] = scrubUrl(item[key] as string);
      continue;
    }
    item[key] = sanitizeValue(item[key], policy, depth + 1);
  }
  return item;
}

/**
 * Sanitize one engine-emitted replay event in place-safe copy. Host policy can only
 * ADD masked/blocked classes: there is deliberately no allowlist knob to weaken defaults.
 */
export function sanitizeReplayEvent(event: unknown, policy: ReplayMaskPolicy = {}): unknown | null {
  const merged: Required<ReplayMaskPolicy> = {
    blockClasses: [...BLOCK_CLASSES, ...(policy.blockClasses ?? [])],
    maskClasses: [...MASK_CLASSES, ...(policy.maskClasses ?? [])],
  };
  const copy: unknown = structuredClone(event);
  return sanitizeValue(copy, merged, 0);
}
