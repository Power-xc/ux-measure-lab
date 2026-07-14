import { readServerEnv, type EnvSource } from "../../../shared/server/env.ts";
import { createPostHogAdapter } from "../adapters/posthog/index.ts";
import { InMemoryAggregateReader, type AggregateReader } from "./aggregate-reader.ts";
import { createFirstPartyAdapter } from "./first-party-adapter.ts";
import { createAdapterRegistry, type AdapterRegistry } from "./registry.ts";
import { SupabaseAggregateReader } from "./supabase-aggregate-reader.ts";

function createReader(source: EnvSource, fetcher: typeof fetch): AggregateReader {
  const supabase = readServerEnv(source).supabase;
  if (!supabase?.siteId) return new InMemoryAggregateReader();
  return new SupabaseAggregateReader({ ...supabase, siteId: supabase.siteId }, fetcher);
}

export function createDefaultHarnessRegistry(
  source: EnvSource = process.env,
  fetcher: typeof fetch = fetch,
): AdapterRegistry {
  const env = readServerEnv(source);
  const posthog = env.posthog
    ? {
        POSTHOG_HOST: env.posthog.host,
        POSTHOG_PROJECT_ID: env.posthog.projectId,
        POSTHOG_API_KEY: env.posthog.apiKey,
      }
    : {};
  const firstParty = createFirstPartyAdapter(createReader(source, fetcher));
  const connector = createPostHogAdapter({
    env: posthog,
    fetch: (url, init) => fetcher(url, init),
  });
  return createAdapterRegistry([firstParty, connector]);
}
