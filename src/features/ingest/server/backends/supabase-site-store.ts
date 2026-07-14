import type { SiteRecord, SiteStore } from "../site-store.ts";

export type SupabaseRestConfig = {
  url: string;
  serviceRoleKey: string;
};

type SiteRow = {
  id: string;
  project_ref: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  allowed_origins: string[];
  retention_days: number;
  is_bot_dropped: boolean;
  created_at: string;
  disabled_at: string | null;
};

const SITE_FIELDS = [
  "id",
  "project_ref",
  "name",
  "key_hash",
  "key_prefix",
  "allowed_origins",
  "retention_days",
  "is_bot_dropped",
  "created_at",
  "disabled_at",
].join(",");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSiteRow(value: unknown): value is SiteRow {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.project_ref === "string"
    && typeof value.name === "string"
    && typeof value.key_hash === "string"
    && typeof value.key_prefix === "string"
    && Array.isArray(value.allowed_origins)
    && value.allowed_origins.every((origin) => typeof origin === "string")
    && Number.isInteger(value.retention_days)
    && typeof value.is_bot_dropped === "boolean"
    && typeof value.created_at === "string"
    && (value.disabled_at === null || typeof value.disabled_at === "string");
}

function toSiteRecord(row: SiteRow): SiteRecord {
  return {
    id: row.id,
    projectRef: row.project_ref,
    name: row.name,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    allowedOrigins: row.allowed_origins,
    retentionDays: row.retention_days,
    isBotDropped: row.is_bot_dropped,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

export class SupabaseSiteStore implements SiteStore {
  private readonly config: SupabaseRestConfig;
  private readonly fetcher: typeof fetch;

  constructor(config: SupabaseRestConfig, fetcher: typeof fetch = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  async findByKeyHash(keyHash: string): Promise<SiteRecord | null> {
    const url = new URL(`${this.config.url.replace(/\/$/, "")}/rest/v1/sites`);
    url.searchParams.set("key_hash", `eq.${keyHash}`);
    url.searchParams.set("select", SITE_FIELDS);
    url.searchParams.set("limit", "1");
    const response = await this.fetcher(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: this.config.serviceRoleKey,
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("supabase_site_lookup_failed");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("supabase_site_response_invalid");
    if (payload.length === 0) return null;
    if (!isSiteRow(payload[0])) throw new Error("supabase_site_response_invalid");
    return toSiteRecord(payload[0]);
  }
}
