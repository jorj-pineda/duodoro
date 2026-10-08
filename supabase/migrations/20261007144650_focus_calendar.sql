-- One row per local day avoids PostgREST's row cap on busy months.
-- Details include only completed sessions in which the caller participated.
create function public.get_focus_calendar(month_start date, tz text default 'UTC')
returns table (day date, solo_seconds bigint, duo_seconds bigint, solo_rounds bigint, duo_rounds bigint, sessions jsonb)
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if month_start is null or month_start <> pg_catalog.date_trunc('month', month_start)::date then
    raise exception 'Expected first day of month' using errcode = '22023';
  end if;
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = tz) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;
  return query
    select (s.ended_at at time zone tz)::date,
      coalesce(sum(s.actual_focus) filter (where other.user_id is null), 0)::bigint,
      coalesce(sum(s.actual_focus) filter (where other.user_id is not null), 0)::bigint,
      count(*) filter (where other.user_id is null), count(*) filter (where other.user_id is not null),
      jsonb_agg(jsonb_build_object('id', s.id, 'focus_seconds', s.actual_focus, 'world', s.world,
        'ended_at', s.ended_at, 'is_duo', other.user_id is not null,
        'partner_name', coalesce(p.display_name, p.username, 'Partner')) order by s.ended_at desc, s.id)
    from public.session_participants mine
    join public.sessions s on s.id = mine.session_id and s.completed
    left join lateral (
      select sp.user_id from public.session_participants sp
      where sp.session_id = s.id and sp.user_id <> caller order by sp.user_id limit 1
    ) other on true
    left join public.profiles p on p.id = other.user_id
    where mine.user_id = caller
      and s.ended_at >= (month_start::timestamp at time zone tz)
      and s.ended_at < ((month_start + interval '1 month')::timestamp at time zone tz)
    group by (s.ended_at at time zone tz)::date order by 1;
end $$;
revoke all on function public.get_focus_calendar(date, text) from public, anon;
grant execute on function public.get_focus_calendar(date, text) to authenticated;
comment on function public.get_focus_calendar(date, text) is 'Caller-owned completed focus by local day with solo/duo totals and details; never partner solo history.';
