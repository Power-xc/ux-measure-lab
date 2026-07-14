// Event persistence. research-ingest.md §3.2.
// The normalized record maps onto the partitioned `events` table. `anonId` is a
// hash (§3.2), `uaFamily` is coarse (raw UA never stored), `ts` is skew-corrected
// while `receivedAt` is server-authoritative and drives partition placement.
// The real implementation is a batched Supabase insert; the fake collects rows.

import type { EventType } from "./schema.ts";

export type StoredEvent = {
  siteId: string;
  eventId: string; // client idempotency key (eid)
  sessionId: string; // client-provided session id (sid) — a rollup hint (§5.1)
  anonId: string; // hashed pseudonymous visitor id
  type: EventType;
  path: string | null;
  referrerHost: string | null;
  props: Record<string, unknown>;
  uaFamily: string | null;
  isBot: boolean;
  ts: string; // ISO, skew-corrected authoritative time
  clientTs: string; // ISO, client-claimed time (retained for skew analysis)
  receivedAt: string; // ISO, server receive time
};

export interface EventStore {
  insertBatch(events: readonly StoredEvent[]): Promise<void>;
}

export class InMemoryEventStore implements EventStore {
  readonly inserted: StoredEvent[] = [];

  async insertBatch(events: readonly StoredEvent[]): Promise<void> {
    this.inserted.push(...events);
  }
}
