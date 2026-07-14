// CORS for the ingest boundary (research-ingest.md §4.4).
// Ingest is intentionally cross-origin, so the same-origin guards
// (hasAllowedOrigin/isCrossSite) are NOT used. A specific Origin is reflected —
// never `*` — and only after it matched the site's allowlist on POST.

const ALLOW_METHODS = "POST, OPTIONS";
const ALLOW_HEADERS = "content-type, content-encoding";
const MAX_AGE = "600";

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": MAX_AGE,
  };
}

// Preflight cannot read the body, so the site key and its allowlist are
// unavailable here. We echo the requested Origin (never `*`) and defer the
// authoritative allowlist check to POST, which returns 403 for a disallowed
// Origin. No credentials are used, so an echoed preflight grants no data.
export function handleOptions(request: Request): Response {
  const origin = request.headers.get("origin");
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  if (origin) {
    for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  }
  return new Response(null, { status: 204, headers });
}
