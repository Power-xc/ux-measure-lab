-- Measurement harness aggregate RPCs. Service-role access only.

create or replace function measurement_funnel_prefix(
  p_types text[],
  p_paths text[],
  p_steps text[]
)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  event_index int;
  reached_steps int := 0;
  step_count int := coalesce(array_length(p_steps, 1), 0);
  event_count int := coalesce(array_length(p_types, 1), 0);
begin
  if step_count = 0 or event_count = 0 then
    return 0;
  end if;
  for event_index in 1..event_count loop
    if p_types[event_index] = p_steps[reached_steps + 1]
      or p_paths[event_index] = p_steps[reached_steps + 1] then
      reached_steps := reached_steps + 1;
      if reached_steps = step_count then
        return reached_steps;
      end if;
    end if;
  end loop;
  return reached_steps;
end;
$$;

create or replace function funnel_counts(
  p_site_id uuid,
  p_steps text[],
  p_from timestamptz,
  p_to timestamptz
)
returns table(step text, users bigint)
language sql
stable
security definer
set search_path = public
as $$
  with deduped as (
    select distinct on (e.event_id)
      e.anon_id, e.type, e.path, e.ts, e.received_at, e.id
    from events e
    where e.site_id = p_site_id
      and e.ts >= p_from
      and e.ts <= p_to
      and not e.is_bot
    order by e.event_id, e.received_at, e.id
  ), per_visitor as (
    select
      e.anon_id,
      measurement_funnel_prefix(
        array_agg(e.type order by e.ts, e.received_at, e.id),
        array_agg(e.path order by e.ts, e.received_at, e.id),
        p_steps
      ) as reached_steps
    from deduped e
    group by e.anon_id
  ), requested_steps as (
    select position, p_steps[position] as step
    from generate_subscripts(p_steps, 1) as position
  )
  select
    requested_steps.step,
    count(per_visitor.anon_id) filter (
      where per_visitor.reached_steps >= requested_steps.position
    )::bigint as users
  from requested_steps
  left join per_visitor on true
  group by requested_steps.position, requested_steps.step
  order by requested_steps.position;
$$;

create or replace function interaction_counts(
  p_site_id uuid,
  p_signals text[],
  p_from timestamptz,
  p_to timestamptz,
  p_target text default null
)
returns table(signal text, count bigint, sample_size bigint)
language sql
stable
security definer
set search_path = public
as $$
  with deduped as (
    select distinct on (e.event_id)
      e.anon_id, e.type, e.path, e.props, e.received_at, e.id
    from events e
    where e.site_id = p_site_id
      and e.ts >= p_from
      and e.ts <= p_to
      and not e.is_bot
    order by e.event_id, e.received_at, e.id
  ), base as (
    select e.anon_id, e.type, e.props
    from deduped e
    where p_target is null
      or e.path = p_target
      or e.props ->> 'sel' = p_target
  ), sample as (
    select count(distinct anon_id)::bigint as sample_size
    from base
  ), requested_signals as (
    select position, p_signals[position] as signal
    from generate_subscripts(p_signals, 1) as position
  )
  select
    requested_signals.signal,
    count(base.anon_id) filter (
      where base.type = requested_signals.signal
        or base.props ->> 'signal' = requested_signals.signal
    )::bigint as count,
    sample.sample_size
  from requested_signals
  cross join sample
  left join base on true
  group by requested_signals.position, requested_signals.signal, sample.sample_size
  order by requested_signals.position;
$$;

create or replace function path_reach(
  p_site_id uuid,
  p_start_event text,
  p_end_event text,
  p_from timestamptz,
  p_to timestamptz
)
returns table(started bigint, reached bigint)
language sql
stable
security definer
set search_path = public
as $$
  with deduped as (
    select distinct on (e.event_id)
      e.anon_id, e.type, e.path, e.ts, e.received_at, e.id
    from events e
    where e.site_id = p_site_id
      and e.ts >= p_from
      and e.ts <= p_to
      and not e.is_bot
    order by e.event_id, e.received_at, e.id
  ), starts as (
    select e.anon_id, min(e.ts) as started_at
    from deduped e
    where e.type = p_start_event or e.path = p_start_event
    group by e.anon_id
  )
  select
    count(*)::bigint as started,
    count(*) filter (
      where exists (
        select 1
        from deduped e
        where e.anon_id = starts.anon_id
          and e.ts > starts.started_at
          and (e.type = p_end_event or e.path = p_end_event)
      )
    )::bigint as reached
  from starts;
$$;

revoke all on function funnel_counts(uuid, text[], timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function measurement_funnel_prefix(text[], text[], text[]) from public, anon, authenticated;
revoke all on function interaction_counts(uuid, text[], timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function path_reach(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function funnel_counts(uuid, text[], timestamptz, timestamptz) to service_role;
grant execute on function interaction_counts(uuid, text[], timestamptz, timestamptz, text) to service_role;
grant execute on function path_reach(uuid, text, text, timestamptz, timestamptz) to service_role;
