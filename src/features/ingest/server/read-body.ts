// Bounded body reader with gzip support (research-ingest.md §4.2·§4.3).
// Plain bodies reuse the shared `readBoundedBody` (text-decoded, bounded).
// gzip bodies are read as raw bytes bounded to the compressed cap, inflated via
// DecompressionStream, then re-bounded to the decompressed cap — a decompression
// bomb cannot exceed either limit.

import { readBoundedBody } from "../../../shared/server/request-guards.ts";

export type BodyLimits = { compressedMax: number; decompressedMax: number };
export type BodyResult =
  | { ok: true; text: string }
  | { ok: false; code: "request_too_large" | "invalid_request" };

async function readBoundedBytes(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function decodeBounded(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return text + decoder.decode();
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

export async function readIngestBody(request: Request, limits: BodyLimits): Promise<BodyResult> {
  if (!request.body) return { ok: true, text: "" };
  const encoding = request.headers.get("content-encoding")?.toLowerCase().trim() ?? "";

  if (encoding === "gzip" || encoding === "x-gzip") {
    const compressed = await readBoundedBytes(request.body, limits.compressedMax);
    if (compressed === null) return { ok: false, code: "request_too_large" };
    let text: string | null;
    try {
      const source = new Response(compressed).body;
      if (!source) return { ok: true, text: "" };
      text = await decodeBounded(source.pipeThrough(new DecompressionStream("gzip")), limits.decompressedMax);
    } catch {
      return { ok: false, code: "invalid_request" }; // malformed gzip
    }
    if (text === null) return { ok: false, code: "request_too_large" };
    return { ok: true, text };
  }

  const text = await readBoundedBody(request, limits.compressedMax);
  if (text === null) return { ok: false, code: "request_too_large" };
  return { ok: true, text };
}
