export type SupabaseEnv = {
  url: string;
  serviceRoleKey: string;
  siteId?: string;
};

export type UpstashEnv = {
  url: string;
  token: string;
};

export type PostHogEnv = {
  host: string;
  projectId: string;
  apiKey: string;
};

export type ServerEnv = {
  supabase?: SupabaseEnv;
  upstash?: UpstashEnv;
  posthog?: PostHogEnv;
};

export type EnvSource = Readonly<Record<string, string | undefined>>;

function value(source: EnvSource, key: string): string | undefined {
  const candidate = source[key]?.trim();
  return candidate ? candidate : undefined;
}

function httpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    if (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) return undefined;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function readSupabase(source: EnvSource): SupabaseEnv | undefined {
  const url = httpUrl(value(source, "SUPABASE_URL"));
  const serviceRoleKey = value(source, "SUPABASE_SERVICE_ROLE_KEY");
  const siteId = value(source, "SUPABASE_SITE_ID");
  return url && serviceRoleKey ? { url, serviceRoleKey, ...(siteId ? { siteId } : {}) } : undefined;
}

function readUpstash(source: EnvSource): UpstashEnv | undefined {
  const url = httpUrl(value(source, "UPSTASH_REDIS_REST_URL"));
  const token = value(source, "UPSTASH_REDIS_REST_TOKEN");
  return url && token ? { url, token } : undefined;
}

function readPostHog(source: EnvSource): PostHogEnv | undefined {
  const host = httpUrl(value(source, "POSTHOG_HOST"));
  const projectId = value(source, "POSTHOG_PROJECT_ID");
  const apiKey = value(source, "POSTHOG_API_KEY");
  return host && projectId && apiKey ? { host, projectId, apiKey } : undefined;
}

export function readServerEnv(source: EnvSource = process.env): ServerEnv {
  return {
    supabase: readSupabase(source),
    upstash: readUpstash(source),
    posthog: readPostHog(source),
  };
}
