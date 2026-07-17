// OpenAI Responses API 공용 배관. 작업별 스키마·지시문·검증은 각 feature가 소유한다.

export type AiFallbackReason = "not_configured" | "timeout" | "provider_error" | "invalid_output";

export type AiProviderRequest = (url: string, init: RequestInit) => Promise<Response>;

export type StructuredOutputOptions = {
  apiKey?: string;
  model?: string;
  request?: AiProviderRequest;
  timeoutMs?: number;
  schemaName: string;
  schema: Record<string, unknown>;
  systemInstruction: string;
  payload: unknown;
};

export type StructuredOutputResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: AiFallbackReason };

class AiProviderFailure extends Error {
  readonly reason: AiFallbackReason;

  constructor(reason: AiFallbackReason) {
    super(reason);
    this.reason = reason;
    this.name = "AiProviderFailure";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function outputText(value: unknown): string | null {
  const response = record(value);
  if (!response) return null;
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const output of response.output) {
    const message = record(output);
    if (!message || !Array.isArray(message.content)) continue;
    for (const content of message.content) {
      const item = record(content);
      if (!item) continue;
      if (item.type === "refusal") throw new AiProviderFailure("invalid_output");
      if (item.type === "output_text" && typeof item.text === "string") return item.text;
    }
  }
  return null;
}

function requestBody(options: StructuredOutputOptions, model: string): Record<string, unknown> {
  return {
    model,
    store: false,
    max_output_tokens: 1_200,
    input: [
      { role: "system", content: [{ type: "input_text", text: options.systemInstruction }] },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify({ payloadType: "untrusted_ux_measurement_data", payload: options.payload }) }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: options.schemaName,
        strict: true,
        schema: options.schema,
      },
    },
  };
}

async function sendRequest(options: StructuredOutputOptions): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const request = options.request ?? fetch;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiProviderFailure("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      request("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody(options, options.model?.trim() || "gpt-5.6-luna")),
        signal: controller.signal,
      }),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof AiProviderFailure) throw error;
    throw new AiProviderFailure("provider_error");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// provider 호출과 구조화 출력 추출까지만 담당한다. 결과 unknown의 도메인 검증은 호출자의 몫이다.
export async function requestStructuredOutput(options: StructuredOutputOptions): Promise<StructuredOutputResult> {
  if (!options.apiKey?.trim()) return { ok: false, reason: "not_configured" };
  try {
    const response = await sendRequest(options);
    if (!response.ok) throw new AiProviderFailure("provider_error");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiProviderFailure("invalid_output");
    }
    const rawText = outputText(payload);
    if (!rawText) throw new AiProviderFailure("invalid_output");
    try {
      return { ok: true, value: JSON.parse(rawText) };
    } catch {
      throw new AiProviderFailure("invalid_output");
    }
  } catch (error) {
    return { ok: false, reason: error instanceof AiProviderFailure ? error.reason : "provider_error" };
  }
}
