import type { EventStore, StoredEvent } from "../event-store.ts";
import type { SupabaseRestConfig } from "./supabase-site-store.ts";

type EventRow = {
  site_id: string;
  event_id: string;
  session_id: string;
  anon_id: string;
  type: StoredEvent["type"];
  path: string | null;
  referrer_host: string | null;
  props: Record<string, unknown>;
  ua_family: string | null;
  is_bot: boolean;
  ts: string;
  client_ts: string;
  received_at: string;
};

function toEventRow(event: StoredEvent): EventRow {
  return {
    site_id: event.siteId,
    event_id: event.eventId,
    session_id: event.sessionId,
    anon_id: event.anonId,
    type: event.type,
    path: event.path,
    referrer_host: event.referrerHost,
    props: event.props,
    ua_family: event.uaFamily,
    is_bot: event.isBot,
    ts: event.ts,
    client_ts: event.clientTs,
    received_at: event.receivedAt,
  };
}

export class SupabaseEventStore implements EventStore {
  private readonly config: SupabaseRestConfig;
  private readonly fetcher: typeof fetch;

  constructor(config: SupabaseRestConfig, fetcher: typeof fetch = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  async insertBatch(events: readonly StoredEvent[]): Promise<void> {
    if (events.length === 0) return;
    const response = await this.fetcher(`${this.config.url.replace(/\/$/, "")}/rest/v1/events`, {
      method: "POST",
      headers: {
        apikey: this.config.serviceRoleKey,
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(events.map(toEventRow)),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("supabase_event_insert_failed");
  }
}
