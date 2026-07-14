// Bot heuristics from UA + headers (research-ingest.md §5.3).
// This is a flag-based filter, not proof: false positives/negatives are expected,
// so borderline traffic is stored with `is_bot=true` (auditable) rather than lost,
// and only clear bots are dropped when the site opts in (`is_bot_dropped`).

export type BotVerdict = "clean" | "suspect" | "bot";

const BOT_UA = /(bot|crawler|spider|crawl|slurp|headless|phantom|puppeteer|playwright|selenium|preview|monitor|scan|curl|wget|python-requests|httpclient|libwww|okhttp|axios|go-http)/i;

export function classifyBot(headers: { userAgent: string | null; acceptLanguage: string | null }): BotVerdict {
  const ua = headers.userAgent?.trim() ?? "";
  if (!ua) return "bot"; // absent UA is a strong automation signal
  if (BOT_UA.test(ua)) return "bot";
  if (!headers.acceptLanguage?.trim()) return "suspect"; // no locale hint → flag, keep
  return "clean";
}

// Coarse UA family only — the raw UA is never stored (research-ingest.md §7.2).
export function uaFamily(userAgent: string | null): string | null {
  const ua = userAgent?.trim();
  if (!ua) return null;
  if (/edg\//i.test(ua)) return "Edge";
  if (/(chrome|crios|chromium)\//i.test(ua)) return "Chrome";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/(safari)\//i.test(ua) && !/(chrome|crios|chromium)/i.test(ua)) return "Safari";
  return "Other";
}
