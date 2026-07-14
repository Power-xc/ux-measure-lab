import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { extractProductPageContext } from "../lib/extract-page-context.ts";
import { ProductContextError, type ProductPageContext } from "../lib/product-context.ts";
import { parsePublicUrl, resolvePublicAddress, type DnsLookup, type ResolvedAddress } from "./url-policy.ts";

export const MAX_HTML_BYTES = 524_288;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 10_000;

export type PageResponse = {
  status: number;
  contentType: string;
  contentEncoding: string;
  location: string;
  body: string;
};

export type PageTransport = (input: {
  url: URL;
  address: ResolvedAddress;
  timeoutMs: number;
  signal: AbortSignal;
}) => Promise<PageResponse>;

type FetchDependencies = {
  dnsLookup?: DnsLookup;
  transport?: PageTransport;
  now?: () => number;
  isoNow?: () => string;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
};

function header(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function withinDeadline<T>(start: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parentSignal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      controller.abort();
      fail(new ProductContextError("timeout", "제품 페이지 분석 시간이 초과되었습니다."));
    };
    const timeout = setTimeout(abort, timeoutMs);
    if (parentSignal?.aborted) {
      abort();
      return;
    }
    parentSignal?.addEventListener("abort", abort, { once: true });
    start(controller.signal).then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      fail,
    );
  });
}

const defaultTransport: PageTransport = ({ url, address, timeoutMs, signal }) => new Promise((resolve, reject) => {
  let settled = false;
  let request: ReturnType<typeof httpRequest> | null = null;
  const abort = () => fail(new ProductContextError("timeout", "제품 페이지 응답 시간이 초과되었습니다."));
  const cleanup = () => signal.removeEventListener("abort", abort);
  const fail = (error: ProductContextError) => {
    if (settled) return;
    settled = true;
    cleanup();
    request?.destroy();
    reject(error);
  };
  const requestHostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname: address.address,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    method: "GET",
    path: `${url.pathname}${url.search}`,
    servername: url.protocol === "https:" && isIP(requestHostname) === 0 ? requestHostname : undefined,
    agent: false,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Encoding": "identity",
      Host: url.host,
      "User-Agent": "UX-MeasureLab-Context/1.0",
    },
  };
  const client = url.protocol === "https:" ? httpsRequest : httpRequest;
  request = client(options, (response) => {
    const declaredLength = Number.parseInt(header(response.headers["content-length"]), 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
      response.destroy();
      fail(new ProductContextError("response_too_large", "제품 페이지가 허용 크기를 초과했습니다."));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_HTML_BYTES) {
        response.destroy();
        fail(new ProductContextError("response_too_large", "제품 페이지가 허용 크기를 초과했습니다."));
        return;
      }
      chunks.push(buffer);
    });
    response.on("end", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        status: response.statusCode ?? 0,
        contentType: header(response.headers["content-type"]),
        contentEncoding: header(response.headers["content-encoding"]),
        location: header(response.headers.location),
        body: Buffer.concat(chunks).toString("utf8"),
      });
    });
    response.on("error", () => fail(new ProductContextError("upstream_failed", "제품 페이지 응답을 읽지 못했습니다.")));
  });
  request.setTimeout(timeoutMs, () => {
    fail(new ProductContextError("timeout", "제품 페이지 응답 시간이 초과되었습니다."));
  });
  request.on("error", () => fail(new ProductContextError("upstream_failed", "제품 페이지에 연결하지 못했습니다.")));
  if (signal.aborted) {
    abort();
    return;
  }
  signal.addEventListener("abort", abort, { once: true });
  request.end();
});

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function validateResponse(response: PageResponse): void {
  if (Buffer.byteLength(response.body, "utf8") > MAX_HTML_BYTES) throw new ProductContextError("response_too_large", "제품 페이지가 허용 크기를 초과했습니다.");
  const contentType = response.contentType.trim().toLowerCase();
  if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml")) {
    throw new ProductContextError("unsupported_content", "HTML 제품 페이지만 분석할 수 있습니다.");
  }
  if (response.contentEncoding && response.contentEncoding.toLowerCase() !== "identity") {
    throw new ProductContextError("unsupported_content", "압축되지 않은 HTML 응답만 분석할 수 있습니다.");
  }
}

export async function fetchProductPage(value: string, dependencies: FetchDependencies = {}): Promise<ProductPageContext> {
  const now = dependencies.now ?? Date.now;
  const isoNow = dependencies.isoNow ?? (() => new Date().toISOString());
  const transport = dependencies.transport ?? defaultTransport;
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const totalTimeoutMs = dependencies.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  const requested = parsePublicUrl(value);
  let current = requested;
  const deadline = now() + totalTimeoutMs;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new ProductContextError("timeout", "제품 페이지 분석 시간이 초과되었습니다.");
    const address = await withinDeadline(() => resolvePublicAddress(current, dependencies.dnsLookup), remaining, dependencies.signal);
    const transportTimeout = Math.min(requestTimeoutMs, deadline - now());
    if (transportTimeout <= 0) throw new ProductContextError("timeout", "제품 페이지 분석 시간이 초과되었습니다.");
    const response = await withinDeadline((signal) => transport({ url: current, address, timeoutMs: transportTimeout, signal }), transportTimeout, dependencies.signal);

    if (isRedirect(response.status)) {
      if (!response.location || redirectCount === MAX_REDIRECTS) throw new ProductContextError("redirect_failed", "안전하게 따라갈 수 없는 redirect입니다.");
      current = parsePublicUrl(new URL(response.location, current).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new ProductContextError("upstream_failed", `제품 페이지가 HTTP ${response.status}로 응답했습니다.`);
    validateResponse(response);
    return extractProductPageContext({ html: response.body, requestedUrl: requested.toString(), finalUrl: current.toString(), fetchedAt: isoNow() });
  }
  throw new ProductContextError("redirect_failed", "redirect 횟수가 너무 많습니다.");
}
