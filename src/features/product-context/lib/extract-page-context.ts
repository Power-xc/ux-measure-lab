import type { ProductPageContext } from "./product-context.ts";

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith("#")) {
      const hex = key[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    return ENTITY_MAP[key.toLowerCase()] ?? entity;
  });
}

function textOnly(value: string, limit: number): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function withoutInactiveContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ");
}

function firstTag(html: string, tag: string, limit: number): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "i").exec(html);
  return match ? textOnly(match[1], limit) : "";
}

function attributes(tag: string): Record<string, string> {
  const values: Record<string, string> = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) values[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return values;
}

function metaDescription(html: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.name ?? attrs.property ?? "").toLowerCase();
    if (["description", "og:description", "twitter:description"].includes(key) && attrs.content) return textOnly(attrs.content, 500);
  }
  return "";
}

function collectTags(html: string, pattern: RegExp, limit: number): string[] {
  const values: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const value = textOnly(match[1], 300);
    if (value && !values.includes(value)) values.push(value);
    if (values.length === limit) break;
  }
  return values;
}

export function extractProductPageContext(input: {
  html: string;
  requestedUrl: string;
  finalUrl: string;
  fetchedAt: string;
}): ProductPageContext {
  const html = withoutInactiveContent(input.html);
  const navigationHtml = /<nav\b[^>]*>([\s\S]*?)<\/nav\s*>/i.exec(html)?.[1] ?? "";
  return {
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    title: firstTag(html, "title", 300) || firstTag(html, "h1", 300),
    description: metaDescription(html),
    headings: collectTags(html, /<h[12]\b[^>]*>([\s\S]*?)<\/h[12]\s*>/gi, 8),
    navigation: collectTags(navigationHtml, /<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, 8),
    fetchedAt: input.fetchedAt,
  };
}
