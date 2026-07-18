-- Session replay storage. spec.md (session-replay) §7·§10. Service-role access only.
-- v1 stores chunk payloads in Postgres with a 30-day hard expiry; moving payloads to
-- object storage is a later decision recorded in the feature research.

create table if not exists replay_recordings (
  site_id uuid not null,
  recording_id text not null,
  session_id text not null,
  anon_id_hash text not null,          -- sha256; raw visitor id is never stored
  started_at timestamptz not null,
  ended_at timestamptz not null,
  chunk_count int not null default 0,
  byte_size bigint not null default 0,
  purpose_version text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (site_id, recording_id)
);

create index if not exists replay_recordings_expiry on replay_recordings (expires_at);
create index if not exists replay_recordings_visitor on replay_recordings (site_id, anon_id_hash);

create table if not exists replay_chunks (
  site_id uuid not null,
  recording_id text not null,
  sequence int not null,
  payload jsonb not null,
  byte_size int not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  primary key (site_id, recording_id, sequence),
  foreign key (site_id, recording_id) references replay_recordings (site_id, recording_id) on delete cascade
);

-- Daily hard delete. Chunks go with the recording via the cascading foreign key.
create or replace function replay_purge_expired(p_now timestamptz)
returns bigint
language sql
security definer
set search_path = public
as $$
  with purged as (
    delete from replay_recordings
    where expires_at <= p_now
    returning 1
  )
  select count(*)::bigint from purged;
$$;

alter table replay_recordings enable row level security;
alter table replay_chunks enable row level security;

revoke all on replay_recordings from public, anon, authenticated;
revoke all on replay_chunks from public, anon, authenticated;
revoke all on function replay_purge_expired(timestamptz) from public, anon, authenticated;
grant execute on function replay_purge_expired(timestamptz) to service_role;
