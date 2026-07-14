-- Scheduled jobs — 보존 + 세션 롤업 (research-ingest.md §3.3·§3.4·§5.1)
--
-- 실행 전제 (integration 단계):
--   * migrations/0001_ingest.sql 적용 완료.
--   * pg_cron 확장 사용 가능(cron schema). 최소 실행 주기·동시성은 tier별로 재확인.
--   * 이 파일은 실행 대상 DB가 없으므로 문법 정합·의도 정합에 집중한 초안이다.
--   * anon_id는 해시로 저장되므로, 방문자 삭제 요청은 입력 anon_id를 동일하게
--     해시한 뒤 대조·삭제한다.

create extension if not exists pg_cron;

-- ── 파티션 사전 생성 ────────────────────────────────────────────────────────
-- 다가오는 주 파티션(events_YYYYMMDD)을 미리 만든다. default 파티션은 안전망일
-- 뿐이며, 정상 경로는 주 단위 전용 파티션에 적재되어야 DROP 보존이 O(1)이 된다.
create or replace function ensure_event_partitions(weeks_ahead int default 3)
returns void language plpgsql as $$
declare
  wk        date := date_trunc('week', now())::date;
  part_from date;
  part_to   date;
  part_name text;
begin
  for i in 0..weeks_ahead loop
    part_from := wk + (i * 7);
    part_to   := part_from + 7;
    part_name := format('events_%s', to_char(part_from, 'YYYYMMDD'));
    if not exists (select 1 from pg_class where relname = part_name) then
      execute format(
        'create table %I partition of events for values from (%L) to (%L)',
        part_name, part_from, part_to
      );
    end if;
  end loop;
end;
$$;

-- ── 보존: 90일 지난 주 파티션 DETACH + DROP (O(1), 블로트 없음) ───────────────
-- 사이트별 retention_days < 90 override는 별도 배치 DELETE로 처리한다(§3.4 ②).
create or replace function drop_expired_event_partitions(retention_days int default 90)
returns void language plpgsql as $$
declare
  cutoff      date := (now() - make_interval(days => retention_days))::date;
  child       record;
  upper_bound date;
begin
  for child in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'events' and c.relname <> 'events_default'
  loop
    -- 파티션명 events_YYYYMMDD의 시작일 + 7일이 상한. 상한이 cutoff 이전이면 만료.
    upper_bound := to_date(right(child.relname, 8), 'YYYYMMDD') + 7;
    if upper_bound <= cutoff then
      execute format('alter table events detach partition %I', child.relname);
      execute format('drop table %I', child.relname);
    end if;
  end loop;
end;
$$;

-- ── 세션 롤업: gap-and-islands로 server_session_id 재도출 (§5.1) ──────────────
-- 같은 anon_id에서 직전 이벤트와의 gap > 30분이면 새 세션. 최근 구간만 증분 갱신.
-- NOTE(초안): 24h 상한 강제 분할은 여기서 구현하지 않았다. gap-30분 규칙만 완전
-- 구현하고, runaway 세션(>24h) 2차 분할은 integration 단계에서 정교화한다(정직 표기).
create or replace function rollup_sessions(lookback interval default interval '2 hours')
returns void language plpgsql as $$
begin
  insert into sessions as s (
    site_id, server_session_id, anon_id, started_at, ended_at, duration_ms,
    event_count, pageview_count, entry_path, exit_path, is_bounce, is_bot
  )
  with ordered as (
    select
      site_id, anon_id, type, path, ts,
      lag(ts) over (partition by site_id, anon_id order by ts) as prev_ts
    from events
    where received_at >= now() - lookback
  ),
  marked as (
    select *,
      case when prev_ts is null or ts - prev_ts > interval '30 minutes' then 1 else 0 end as is_new
    from ordered
  ),
  islands as (
    select *,
      sum(is_new) over (partition by site_id, anon_id order by ts
                        rows between unbounded preceding and current row) as seq
    from marked
  )
  select
    site_id,
    md5(site_id::text || anon_id || min(ts)::text)              as server_session_id,
    anon_id,
    min(ts)                                                     as started_at,
    max(ts)                                                     as ended_at,
    (extract(epoch from (max(ts) - min(ts))) * 1000)::bigint    as duration_ms,
    count(*)::int                                               as event_count,
    count(*) filter (where type = 'pv')::int                    as pageview_count,
    (array_agg(path order by ts))[1]                            as entry_path,
    (array_agg(path order by ts desc))[1]                       as exit_path,
    count(*) filter (where type = 'pv') <= 1                    as is_bounce,
    bool_or(false)                                              as is_bot
  from islands
  group by site_id, anon_id, seq
  on conflict (site_id, server_session_id) do update set
    ended_at       = excluded.ended_at,
    duration_ms    = excluded.duration_ms,
    event_count    = excluded.event_count,
    pageview_count = excluded.pageview_count,
    exit_path      = excluded.exit_path,
    is_bounce      = excluded.is_bounce;
end;
$$;

-- ── 방문자 삭제 (consent-first 운영 대응, §3.4 ③) ────────────────────────────
create or replace function delete_visitor(p_site_id uuid, p_anon_id_hash text)
returns void language plpgsql as $$
begin
  delete from events   where site_id = p_site_id and anon_id = p_anon_id_hash;
  delete from sessions where site_id = p_site_id and anon_id = p_anon_id_hash;
end;
$$;

-- ── pg_cron 등록 (실행 전제 충족 후 활성화) ──────────────────────────────────
-- select cron.schedule('ingest-ensure-partitions', '0 * * * *', $$ select ensure_event_partitions(3); $$);
-- select cron.schedule('ingest-retention',         '0 3 * * *', $$ select drop_expired_event_partitions(90); $$);
-- select cron.schedule('ingest-session-rollup',    '*/5 * * * *', $$ select rollup_sessions(); $$);
