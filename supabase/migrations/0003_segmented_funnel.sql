-- 변형별 퍼널 집계. experiment fleet의 웨이브 관찰을 공급한다. Service-role access only.
-- 변형 배정은 이벤트 props의 dimension 키(예: props ->> 'variant')로 식별한다.

create or replace function segmented_funnel_counts(
  p_site_id uuid,
  p_steps text[],
  p_dimension text,
  p_from timestamptz,
  p_to timestamptz
)
returns table(value text, step text, users bigint)
language sql
stable
security definer
set search_path = public
as $$
  with deduped as (
    select distinct on (e.event_id)
      e.anon_id, e.type, e.path, e.props, e.ts, e.received_at, e.id
    from events e
    where e.site_id = p_site_id
      and e.ts >= p_from
      and e.ts <= p_to
      and not e.is_bot
    order by e.event_id, e.received_at, e.id
  ), assigned as (
    -- 한 방문자가 여러 변형 값을 보낸 경우 첫 배정을 따른다. 재배정은 배분 이상 신호로 드러나야 한다.
    select distinct on (e.anon_id)
      e.anon_id, e.props ->> p_dimension as value
    from deduped e
    where e.props ? p_dimension
    order by e.anon_id, e.ts, e.received_at, e.id
  ), per_visitor as (
    select
      assigned.value,
      e.anon_id,
      measurement_funnel_prefix(
        array_agg(e.type order by e.ts, e.received_at, e.id),
        array_agg(e.path order by e.ts, e.received_at, e.id),
        p_steps
      ) as reached_steps
    from deduped e
    join assigned on assigned.anon_id = e.anon_id
    group by assigned.value, e.anon_id
  ), requested_steps as (
    select position, p_steps[position] as step
    from generate_subscripts(p_steps, 1) as position
  ), observed_values as (
    select distinct value from per_visitor where value is not null and value <> ''
  )
  select
    observed_values.value,
    requested_steps.step,
    count(per_visitor.anon_id) filter (
      where per_visitor.value = observed_values.value
        and per_visitor.reached_steps >= requested_steps.position
    )::bigint as users
  from observed_values
  cross join requested_steps
  left join per_visitor on true
  group by observed_values.value, requested_steps.position, requested_steps.step
  order by observed_values.value, requested_steps.position;
$$;

revoke all on function segmented_funnel_counts(uuid, text[], text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function segmented_funnel_counts(uuid, text[], text, timestamptz, timestamptz) to service_role;
