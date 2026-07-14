// PII non-collection defaults. research-sdk.md §3.3 promotes docs/security.md's
// "never store credentials / sensitive form payload" to a client-side HARD RULE:
// these paths cannot be enabled by any config. Masking is the default, not an option.

/** Path segments that look like emails, UUIDs, or long hex/opaque tokens become this. */
const MASKED_SEGMENT = ":masked";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Long opaque token: 16+ hex chars, or 20+ base64-ish chars. Short slugs are kept.
const LONG_HEX_RE = /^[0-9a-f]{16,}$/i;
const LONG_TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;
// Any digit-heavy segment (e.g. an order id) is masked to avoid leaking identifiers.
const NUMERIC_ID_RE = /^\d{4,}$/;

/** Names/attributes that mark a payment or otherwise sensitive field. */
const SENSITIVE_NAME_RE = /card|cvc|cvv|ssn|iban|account|routing/i;

function segmentIsSensitive(segment: string): boolean {
  return EMAIL_RE.test(segment) || UUID_RE.test(segment) || LONG_HEX_RE.test(segment) || LONG_TOKEN_RE.test(segment) || NUMERIC_ID_RE.test(segment);
}

/**
 * Normalize a path for the wire. Query string is dropped by default; individual
 * params can only be re-added by an explicit whitelist (capturePathQueryParams).
 * Sensitive-looking segments are replaced with `:masked`.
 */
export function normalizePath(rawPathAndQuery: string, allowedQueryParams: readonly string[] = []): string {
  const [rawPath, rawQuery = ""] = rawPathAndQuery.split("?");
  const maskedPath = rawPath
    .split("/")
    .map((segment) => (segment && segmentIsSensitive(segment) ? MASKED_SEGMENT : segment))
    .join("/");
  if (allowedQueryParams.length === 0 || rawQuery === "") return maskedPath || "/";

  const kept: string[] = [];
  for (const pair of rawQuery.split("&")) {
    const key = pair.split("=")[0];
    if (key && allowedQueryParams.includes(key)) kept.push(pair);
  }
  return kept.length > 0 ? `${maskedPath || "/"}?${kept.join("&")}` : maskedPath || "/";
}

/** Referrer is reduced to its origin: scheme + host, never path or query. */
export function normalizeReferrer(referrer: string): string | undefined {
  if (!referrer) return undefined;
  try {
    return new URL(referrer).origin;
  } catch {
    return undefined;
  }
}

/** Elements whose text/value must never be captured, regardless of config. */
function tagName(element: Element): string {
  return element.tagName.toLowerCase();
}

/**
 * A hard, config-independent check: does this element (or an ancestor) carry data
 * that must never be collected? Covers all inputs, password/contenteditable,
 * payment autocomplete tokens, sensitive names, and the explicit data-ml-mask opt-out.
 */
export function isSensitiveTarget(element: Element | null): boolean {
  let node: Element | null = element;
  let depth = 0;
  while (node && depth < 12) {
    const tag = tagName(node);
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (node.getAttribute("type") === "password") return true;
    if (node.getAttribute("contenteditable") === "" || node.getAttribute("contenteditable") === "true") return true;
    if (node.hasAttribute("data-ml-mask")) return true;
    const autocomplete = node.getAttribute("autocomplete");
    if (autocomplete && autocomplete.toLowerCase().startsWith("cc-")) return true;
    const name = node.getAttribute("name");
    if (name && SENSITIVE_NAME_RE.test(name)) return true;
    node = node.parentElement;
    depth += 1;
  }
  return false;
}

/**
 * Extract at most a bounded, sanitized text label for a click target — only when the
 * caller has explicitly opted in (captureText). Sensitive targets always return
 * undefined. Never returns input values or contenteditable text.
 */
export function boundedText(element: Element, enabled: boolean): string | undefined {
  if (!enabled || isSensitiveTarget(element)) return undefined;
  const text = (element.textContent ?? "").trim().replace(/\s+/g, " ");
  if (!text) return undefined;
  return text.length > 128 ? text.slice(0, 128) : text;
}
