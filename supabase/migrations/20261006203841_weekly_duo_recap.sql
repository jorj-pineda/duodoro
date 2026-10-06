-- Recap only completed rounds the caller actually shared with each partner.
-- No partner solo history, total focus, or private recording keys are exposed.
create function public.get_weekly_duo_recap(tz text default 'UTC')
returns table (partner_id uuid, partner_name text, focus_seconds bigint, completed_rounds bigint, week_start date, week_end date)
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  local_start timestamp;
begin
  if caller is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = tz) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;
  local_start := pg_catalog.date_trunc('week', pg_catalog.now() at time zone tz);
  return query
    select other.user_id, coalesce(p.display_name, p.username, 'Partner'),
           coalesce(sum(s.actual_focus), 0)::bigint, count(*)::bigint,
           local_start::date, (local_start + interval '6 days')::date
      from public.session_participants mine
      join public.sessions s on s.id = mine.session_id and s.completed
      join public.session_participants other on other.session_id = s.id and other.user_id <> caller
      left join public.profiles p on p.id = other.user_id
     where mine.user_id = caller
       and s.ended_at >= (local_start at time zone tz)
       and s.ended_at < ((local_start + interval '7 days') at time zone tz)
     group by other.user_id, coalesce(p.display_name, p.username, 'Partner')
     order by 3 desc, 2, 1;
end $$;
revoke all on function public.get_weekly_duo_recap(text) from public, anon;
grant execute on function public.get_weekly_duo_recap(text) to authenticated;
comment on function public.get_weekly_duo_recap(text) is 'Caller-participated completed duo rounds for the local Monday-Sunday week. Excludes all solo history.';
