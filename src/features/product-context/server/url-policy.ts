import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { validateProductUrl } from "../../../shared/lib/input-policy.ts";
import { ProductContextError } from "../lib/product-context.ts";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type DnsLookup = (hostname: string) => Promise<ResolvedAddress[]>;

const blockedV4 = new BlockList();
const blockedV6 = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(address, prefix, "ipv4");

for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28],
  ["2001:20::", 28], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8],
] as const) blockedV6.addSubnet(address, prefix, "ipv6");

function normalizedHostname(hostname: string): string {
  const unwrapped = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return unwrapped.replace(/\.$/, "").toLowerCase();
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return !blockedV6.check(address, "ipv6");
  return false;
}

export function parsePublicUrl(value: string): URL {
  const validation = validateProductUrl(value);
  if (!validation.ok || !validation.url) throw new ProductContextError("invalid_url", validation.ok ? "제품 URL을 입력하세요." : validation.message);
  const url = new URL(validation.url);
  const hostname = normalizedHostname(url.hostname);
  if (["localhost", "localhost.localdomain"].includes(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa")) {
    throw new ProductContextError("blocked_address", "공개 인터넷 주소만 분석할 수 있습니다.");
  }
  const allowedPort = !url.port || (url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80");
  if (!allowedPort) throw new ProductContextError("invalid_url", "기본 HTTP 또는 HTTPS 포트만 사용할 수 있습니다.");
  if (isIP(hostname) && !isPublicAddress(hostname)) throw new ProductContextError("blocked_address", "비공개 또는 예약 IP 주소는 분석할 수 없습니다.");
  url.hash = "";
  return url;
}

const defaultLookup: DnsLookup = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({ address: record.address, family: record.family as 4 | 6 }));
};

export async function resolvePublicAddress(url: URL, dnsLookup: DnsLookup = defaultLookup): Promise<ResolvedAddress> {
  const hostname = normalizedHostname(url.hostname);
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily as 4 | 6 }] : await dnsLookup(hostname).catch(() => {
    throw new ProductContextError("dns_failed", "제품 주소의 DNS를 확인하지 못했습니다.");
  });
  if (addresses.length === 0) throw new ProductContextError("dns_failed", "제품 주소에 연결할 IP가 없습니다.");
  if (addresses.some((record) => !isPublicAddress(record.address))) throw new ProductContextError("blocked_address", "비공개 주소로 연결되는 제품 URL은 분석할 수 없습니다.");
  return addresses.find((record) => record.family === 4) ?? addresses[0];
}
