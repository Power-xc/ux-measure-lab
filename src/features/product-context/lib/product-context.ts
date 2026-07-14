export type ProductPageContext = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  description: string;
  headings: string[];
  navigation: string[];
  fetchedAt: string;
};

export type ProductContextErrorCode =
  | "invalid_url"
  | "blocked_address"
  | "dns_failed"
  | "redirect_failed"
  | "timeout"
  | "response_too_large"
  | "unsupported_content"
  | "upstream_failed";

export class ProductContextError extends Error {
  readonly code: ProductContextErrorCode;

  constructor(code: ProductContextErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ProductContextError";
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isProductPageContext(value: unknown): value is ProductPageContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.requestedUrl === "string"
    && typeof record.finalUrl === "string"
    && typeof record.title === "string"
    && typeof record.description === "string"
    && isStringArray(record.headings)
    && isStringArray(record.navigation)
    && typeof record.fetchedAt === "string";
}
