export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function hasAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const requestHost = (request.headers.get("host") || new URL(request.url).host).toLowerCase();
    return ["http:", "https:"].includes(originUrl.protocol) && originUrl.host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

export function isCrossSite(request: Request): boolean {
  return request.headers.get("sec-fetch-site") === "cross-site";
}

function clientKey(request: Request): string {
  const direct = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (direct || forwarded || "local").slice(0, 128);
}

export async function readBoundedBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = "";
  while (true) {
    const result = await reader.read();
    if (result.done) return value + decoder.decode();
    size += result.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    value += decoder.decode(result.value, { stream: true });
  }
}

export type RateLimitResult = { limited: boolean; retryAfter: number };

// 단일 프로세스 메모리 기반이며 여러 인스턴스에 걸친 전역 quota가 아니다.
// 공개 multi-tenant 출시 전에는 durable user quota가 별도로 필요하다.
export function createRateLimiter(config: { limit: number; windowMs: number; maxKeys: number }): (request: Request) => RateLimitResult {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return (request: Request): RateLimitResult => {
    const now = Date.now();
    if (windows.size >= config.maxKeys) {
      for (const [key, window] of windows) {
        if (window.resetAt <= now) windows.delete(key);
      }
    }
    const requestedKey = clientKey(request);
    const key = windows.size >= config.maxKeys && !windows.has(requestedKey) ? "overflow" : requestedKey;
    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + config.windowMs });
      return { limited: false, retryAfter: 0 };
    }
    current.count += 1;
    return { limited: current.count > config.limit, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)) };
  };
}
