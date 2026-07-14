import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../../app/api/product-context/route.ts";
import { extractProductPageContext } from "../lib/extract-page-context.ts";
import { ProductContextError } from "../lib/product-context.ts";
import { analyzeProductUrl, type ProductContextRequest } from "../model/analyze-product-url.ts";
import { fetchProductPage, MAX_HTML_BYTES, type PageResponse } from "./fetch-product-page.ts";
import { isPublicAddress, parsePublicUrl, resolvePublicAddress } from "./url-policy.ts";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 as const }];

function response(patch: Partial<PageResponse> = {}): PageResponse {
  return {
    status: 200,
    contentType: "text/html; charset=utf-8",
    contentEncoding: "",
    location: "",
    body: "<html><head><title>Measure</title></head><body><h1>Test impact</h1></body></html>",
    ...patch,
  };
}

test("URL-001 blocks local, private, credential and non-standard-port targets", () => {
  for (const value of [
    "http://localhost",
    "http://127.0.0.1",
    "http://2130706433",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "https://user:password@example.com",
    "https://example.com:8443",
  ]) assert.throws(() => parsePublicUrl(value), ProductContextError);
  assert.equal(isPublicAddress("10.0.0.1"), false);
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("URL-002 rejects a hostname when any DNS answer is private", async () => {
  await assert.rejects(
    resolvePublicAddress(new URL("https://example.com"), async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.0.2", family: 4 },
    ]),
    (error: unknown) => error instanceof ProductContextError && error.code === "blocked_address",
  );
});

test("URL-003 revalidates redirects before making the next request", async () => {
  let requests = 0;
  await assert.rejects(
    fetchProductPage("https://example.com", {
      dnsLookup: publicDns,
      transport: async () => {
        requests += 1;
        return response({ status: 302, location: "http://127.0.0.1/admin" });
      },
    }),
    (error: unknown) => error instanceof ProductContextError && error.code === "blocked_address",
  );
  assert.equal(requests, 1);
});

test("URL-004 accepts bounded HTML and extracts inert text only", async () => {
  const context = await fetchProductPage("https://example.com/product", {
    dnsLookup: publicDns,
    isoNow: () => "2026-07-14T00:00:00.000Z",
    transport: async () => response({
      body: '<html><head><title>UX &amp; Metrics</title><meta name="description" content="Test impact"></head><body><script><h1>Ignore me</h1></script><nav><a href="/a">Overview</a><a href="/b">Pricing</a></nav><h1>Measure <em>impact</em></h1></body></html>',
    }),
  });
  assert.equal(context.title, "UX & Metrics");
  assert.equal(context.description, "Test impact");
  assert.deepEqual(context.headings, ["Measure impact"]);
  assert.deepEqual(context.navigation, ["Overview", "Pricing"]);
  assert.equal(context.fetchedAt, "2026-07-14T00:00:00.000Z");
});

test("URL-005 rejects oversized and non-HTML responses", async () => {
  await assert.rejects(
    fetchProductPage("https://example.com", { dnsLookup: publicDns, transport: async () => response({ body: "가".repeat(Math.ceil(MAX_HTML_BYTES / 3) + 1) }) }),
    (error: unknown) => error instanceof ProductContextError && error.code === "response_too_large",
  );
  await assert.rejects(
    fetchProductPage("https://example.com", { dnsLookup: publicDns, transport: async () => response({ body: "x".repeat(MAX_HTML_BYTES + 1) }) }),
    (error: unknown) => error instanceof ProductContextError && error.code === "response_too_large",
  );
  await assert.rejects(
    fetchProductPage("https://example.com", { dnsLookup: publicDns, transport: async () => response({ contentType: "application/json" }) }),
    (error: unknown) => error instanceof ProductContextError && error.code === "unsupported_content",
  );
});

test("URL-006 extraction limits duplicated text and strips inactive markup", () => {
  const context = extractProductPageContext({
    html: `<h1>${"A".repeat(400)}</h1><h1>${"A".repeat(400)}</h1><style><h1>Hidden</h1></style><script><h1>Malformed hidden</h1>`,
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    fetchedAt: "2026-07-14T00:00:00.000Z",
  });
  assert.equal(context.headings.length, 1);
  assert.equal(context.headings[0].length, 300);
  assert.doesNotMatch(context.headings[0], /Hidden/);
});

test("URL-007 route rejects malformed requests before network access", async () => {
  const result = await POST(new Request("http://localhost/api/product-context", { method: "POST", body: "{}", headers: { "Content-Type": "application/json", Origin: "http://localhost" } }));
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { error: "invalid_request" });

  const mediaType = await POST(new Request("http://localhost/api/product-context", { method: "POST", body: "{}", headers: { "Content-Type": "text/plain", Origin: "http://localhost" } }));
  assert.equal(mediaType.status, 415);

  const oversized = await POST(new Request("http://localhost/api/product-context", { method: "POST", body: "x".repeat(4_097), headers: { "Content-Type": "application/json", Origin: "http://localhost" } }));
  assert.equal(oversized.status, 413);

  const proxiedHost = await POST(new Request("http://localhost/api/product-context", { method: "POST", body: "{}", headers: { "Content-Type": "application/json", Host: "127.0.0.1:3015", Origin: "http://127.0.0.1:3015" } }));
  assert.equal(proxiedHost.status, 400);

  const crossOrigin = await POST(new Request("http://localhost/api/product-context", { method: "POST", body: "{}", headers: { "Content-Type": "application/json", Host: "127.0.0.1:3015", Origin: "https://attacker.example" } }));
  assert.equal(crossOrigin.status, 403);

  const missingOrigin = await POST(new Request("http://localhost/api/product-context", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
  assert.equal(missingOrigin.status, 403);
});

test("URL-008 client accepts only a validated product context payload", async () => {
  const validRequest: ProductContextRequest = async () => new Response(JSON.stringify({
    context: {
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      title: "Measure",
      description: "Test impact",
      headings: ["Measure impact"],
      navigation: ["Overview"],
      fetchedAt: "2026-07-14T00:00:00.000Z",
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const context = await analyzeProductUrl("https://example.com", { request: validRequest });
  assert.equal(context.title, "Measure");

  const invalidRequest: ProductContextRequest = async () => new Response(JSON.stringify({ context: { title: "Incomplete" } }), { status: 200 });
  await assert.rejects(analyzeProductUrl("https://example.com", { request: invalidRequest }), /결과 형식/);
});

test("URL-009 total timeout aborts the active transport", async () => {
  let aborted = false;
  await assert.rejects(
    fetchProductPage("https://example.com", {
      dnsLookup: publicDns,
      requestTimeoutMs: 100,
      totalTimeoutMs: 5,
      transport: async ({ signal }) => new Promise<PageResponse>(() => {
        signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      }),
    }),
    (error: unknown) => error instanceof ProductContextError && error.code === "timeout",
  );
  assert.equal(aborted, true);
});

test("URL-010 caller cancellation aborts the active transport", async () => {
  const controller = new AbortController();
  let aborted = false;
  let markStarted: (() => void) | null = null;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const pending = fetchProductPage("https://example.com", {
    dnsLookup: publicDns,
    signal: controller.signal,
    transport: async ({ signal }) => new Promise<PageResponse>(() => {
      markStarted?.();
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    }),
  });
  await started;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof ProductContextError && error.code === "timeout");
  assert.equal(aborted, true);
});
