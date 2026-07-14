// Site (collection source) lookup. research-ingest.md §3.1·§4.5.
// The store is keyed by the SHA-256 of the public site key — the raw key is
// never persisted. The real implementation is a Supabase `sites` query; the
// in-memory fake below backs unit tests and the un-provisioned default wiring.

export type SiteRecord = {
  id: string;
  projectRef: string;
  name: string;
  keyHash: string; // sha256 of the public write key
  keyPrefix: string; // identify/rotate UI only, never used for auth
  allowedOrigins: string[]; // CORS boundary data source (§4.4)
  retentionDays: number;
  isBotDropped: boolean;
  createdAt: string;
  disabledAt: string | null; // null → active
};

export interface SiteStore {
  findByKeyHash(keyHash: string): Promise<SiteRecord | null>;
}

export class InMemorySiteStore implements SiteStore {
  private readonly byHash = new Map<string, SiteRecord>();

  constructor(sites: readonly SiteRecord[] = []) {
    for (const site of sites) this.byHash.set(site.keyHash, site);
  }

  async findByKeyHash(keyHash: string): Promise<SiteRecord | null> {
    return this.byHash.get(keyHash) ?? null;
  }
}
