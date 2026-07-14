import { isProductPageContext, type ProductPageContext } from "../lib/product-context.ts";

export type ProductContextRequest = (url: string, init: RequestInit) => Promise<Response>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error("제품 분석 서버의 응답을 읽지 못했습니다.");
  }
  const record = asRecord(value);
  if (!record) throw new Error("제품 분석 서버가 올바르지 않은 응답을 반환했습니다.");
  return record;
}

export async function analyzeProductUrl(
  productUrl: string,
  options: { signal?: AbortSignal; request?: ProductContextRequest } = {},
): Promise<ProductPageContext> {
  const request = options.request ?? fetch;
  const response = await request("/api/product-context", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ url: productUrl }),
    signal: options.signal,
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : "제품 페이지를 분석하지 못했습니다.";
    throw new Error(message);
  }
  if (!isProductPageContext(payload.context)) throw new Error("제품 분석 결과 형식을 확인하지 못했습니다.");
  return payload.context;
}
