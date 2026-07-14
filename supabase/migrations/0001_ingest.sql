-- Migration 0001 — ingest storage (research-ingest.md §3)
--
-- 실행 전제 (integration 단계, spec D-101 승인 후에 충족):
--   * Supabase Postgres 프로젝트 프로비저닝. 이 파일은 아직 실행 대상 DB가 없으므로
--     문법 정합에만 집중한다. 실제 적용 전 tier별 커넥션·CPU 한도를 재확인한다.
--   * 확장: pgcrypto(gen_random_uuid). 보존/롤업 잡은 supabase/jobs.sql 참조
--     (pg_cron, 선택적으로 pg_partman).
--   * 컬럼 enum/길이는 runtime validator(src/features/ingest/server/schema.ts)와
--     반드시 일치한다. type enum은 spec.md §4 바인딩 계약(SDK wire 형태)으로 통일했다.

create extension if not exists pgcrypto;

-- 3.1 sites — 수집원. 공개 write 키는 해시로만 저장한다(raw 미저장).
create table if not exists sites (
  id               uuid        primary key default gen_random_uuid(),
  project_ref      text        not null,               -- dogfood: 로컬 project id 문자열
  name             text        not null,
  key_hash         text        not null unique,        -- 사이트 키의 sha256. raw 키는 저장하지 않음
  key_prefix       text        not null,               -- 식별·회전 UI용 앞자리 (예: "umlk_ab12")
  allowed_origins  text[]      not null default '{}',  -- 이 사이트가 전송 허용된 Origin allowlist (§4.4)
  retention_days   int         not null default 90,
  is_bot_dropped   boolean     not null default true,  -- 명백한 봇 이벤트를 ingest에서 버릴지
  created_at       timestamptz not null default now(),
  disabled_at      timestamptz                         -- 폐기·정지 시각 (null이면 활성)
);

-- 3.2 events — 파티셔닝된 이벤트 테이블. received_at 주 단위 range partition.
-- PK는 파티션 키(received_at)를 포함해야 하므로 (received_at, id)로 둔다.
create table if not exists events (
  id            bigint      generated always as identity,
  site_id       uuid        not null,
  event_id      text        not null,   -- 클라이언트 생성 멱등키 (eid, dedup용)
  session_id    text        not null,   -- 클라이언트 제공 세션 id (sid, 신뢰하되 재검증)
  anon_id       text        not null,   -- 1차 pseudonymous 방문자 id (해시 저장)
  type          text        not null,   -- pv|click|rage|dead|scroll|route|s_start|s_end (spec §4)
  path          text,                   -- 정규화된 경로 (기본적으로 query string 제외)
  referrer_host text,                   -- referrer의 host만 (full URL 아님)
  props         jsonb,                  -- 이벤트 타입별 bounded 속성 (직렬화 ≤ 4KB)
  ua_family     text,                   -- 파싱된 UA 계열 (raw UA 저장 안 함)
  is_bot        boolean     not null default false,
  ts            timestamptz not null,   -- 서버 권위 이벤트 시각 (skew 보정 후)
  client_ts     timestamptz,            -- 클라이언트 주장 시각 (skew 분석용 보존)
  received_at   timestamptz not null default now(),
  primary key (received_at, id)
) partition by range (received_at);

-- 인덱스는 부모에 만들면 각 파티션에 상속된다.
create index if not exists events_site_ts_idx      on events (site_id, ts);          -- 테넌트 + 시간 지역성
create index if not exists events_site_anon_ts_idx on events (site_id, anon_id, ts); -- 세션 gap 계산
create index if not exists events_site_type_ts_idx on events (site_id, type, ts);    -- 퍼널·마찰 카운트

-- 미래 파티션은 supabase/jobs.sql의 pg_cron 잡이 주 단위로 사전 생성한다.
-- 사전 생성 실패 시 유실을 막기 위한 안전망으로 default 파티션을 둔다.
create table if not exists events_default partition of events default;

-- 3.3 sessions — 세션 롤업. server_session_id는 서버가 gap 규칙으로 재도출(§5.1).
create table if not exists sessions (
  site_id           uuid        not null,
  server_session_id text        not null,   -- gap-and-islands로 재도출한 세션 id
  anon_id           text        not null,
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  duration_ms       bigint      not null,
  event_count       int         not null,
  pageview_count    int         not null,
  entry_path        text,
  exit_path         text,
  is_bounce         boolean     not null,   -- pageview 1개 이하
  is_bot            boolean     not null,
  primary key (site_id, server_session_id)
);
