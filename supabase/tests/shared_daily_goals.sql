begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-000000000001', 'shared-a@example.com'),
 ('00000000-0000-0000-0000-000000000002', 'shared-b@example.com'),
 ('00000000-0000-0000-0000-000000000003', 'shared-c@example.com');
insert into public.friendships(id, requester_id, addressee_id, status) values
 ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'accepted'),
 ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'pending');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$select public.create_shared_daily_goal('00000000-0000-0000-0000-000000000003', 60, 'UTC')$$, 'P0001', 'Accepted friendship required', 'pending friendship cannot create goal');
select throws_ok($$select public.create_shared_daily_goal('00000000-0000-0000-0000-000000000002', 60, 'made/up')$$, 'P0001', 'Invalid timezone', 'invalid timezone rejected');
select throws_ok($$select public.create_shared_daily_goal('00000000-0000-0000-0000-000000000002', 42, 'UTC')$$, '23514', null, 'unsupported target rejected');
select set_config('test.goal_id', public.create_shared_daily_goal('00000000-0000-0000-0000-000000000002', 60, 'America/Chicago')::text, true);
select is((select count(*)::int from public.get_shared_daily_goals()), 1, 'creator sees invitation');
select ok((select my_seconds is null and partner_seconds is null and not accepted from public.get_shared_daily_goals()), 'pending invitation exposes no focus totals');
select throws_ok($$select public.create_shared_daily_goal('00000000-0000-0000-0000-000000000002', 60, 'UTC')$$, '23505', null, 'only one goal per pair');
select throws_ok($$select public.accept_shared_daily_goal(current_setting('test.goal_id')::uuid)$$, 'P0001', 'Goal invitation unavailable', 'creator cannot accept own invitation');
select throws_ok($$select public.update_shared_daily_goal(current_setting('test.goal_id')::uuid, 90)$$, 'P0001', 'Accepted goal unavailable', 'pending target cannot change under recipient');
select throws_ok($$update public.shared_daily_goals set accepted = true$$, '42501', null, 'direct writes cannot bypass acceptance');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is((select count(*)::int from public.get_shared_daily_goals()), 0, 'outsider receives no goals');
select is((select count(*)::int from public.shared_daily_goals), 0, 'RLS hides goal metadata from outsider');
select throws_ok($$select public.accept_shared_daily_goal(current_setting('test.goal_id')::uuid)$$, 'P0001', 'Goal invitation unavailable', 'outsider cannot accept');
select throws_ok($$select public.update_shared_daily_goal(current_setting('test.goal_id')::uuid, 90)$$, 'P0001', 'Accepted goal unavailable', 'outsider cannot edit');
with deleted as (delete from public.shared_daily_goals returning id) select is(count(*)::int, 0, 'outsider cannot delete') from deleted;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is(public.accept_shared_daily_goal(current_setting('test.goal_id')::uuid)::text, current_setting('test.goal_id'), 'recipient accepts');
select is(public.update_shared_daily_goal(current_setting('test.goal_id')::uuid, 90)::text, current_setting('test.goal_id'), 'recipient can edit accepted target');
select is((select target_minutes from public.get_shared_daily_goals()), 90, 'updated target persisted');
select is((select my_seconds + partner_seconds from public.get_shared_daily_goals()), 0::bigint, 'successful empty history is zero');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select is((select count(*)::int from public.get_shared_daily_goals()), 0, 'outsider cannot read accepted goal totals');
reset role;

-- Today is defined in the shared timezone, not either browser's timezone.
insert into public.sessions(id, room_code, focus_duration, break_duration, actual_focus, completed, started_at, ended_at)
select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'shared-test', 300, 60, seconds, completed,
  ended_at - interval '5 minutes', ended_at
from (values
 (1, 120, true, ((now() at time zone 'America/Chicago')::date)::timestamp at time zone 'America/Chicago'),
 (2, 180, true, now()),
 (3, 300, true, now()),
 (4, 600, false, now()),
 (5, 100, true, ((now() at time zone 'America/Chicago')::date)::timestamp at time zone 'America/Chicago' - interval '1 second'),
 (6, 100, true, (((now() at time zone 'America/Chicago')::date) + 1)::timestamp at time zone 'America/Chicago')
) data(n, seconds, completed, ended_at);
insert into public.session_participants(session_id, user_id) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select my_seconds from public.get_shared_daily_goals()), 420::bigint, 'own solo and duo completed focus counted; interrupted and other days excluded');
select is((select partner_seconds from public.get_shared_daily_goals()), 480::bigint, 'partner solo and duo counted independently');
select is((select my_seconds + partner_seconds from public.get_shared_daily_goals()), 900::bigint, 'duo adds one contribution per person');
select is((select resets_at from public.get_shared_daily_goals()), (((now() at time zone 'America/Chicago')::date) + 1)::timestamp at time zone 'America/Chicago', 'reset follows shared timezone midnight');
select is(public.update_shared_daily_goal(current_setting('test.goal_id')::uuid, 120)::text, current_setting('test.goal_id'), 'creator can edit after acceptance');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select is((select my_seconds from public.get_shared_daily_goals()), 480::bigint, 'recipient sees contributions reversed');
with deleted as (delete from public.shared_daily_goals returning id) select is(count(*)::int, 1, 'either person can end goal') from deleted;
select is((select count(*)::int from public.get_shared_daily_goals()), 0, 'ended goal disappears');
select set_config('test.goal_id', public.create_shared_daily_goal('00000000-0000-0000-0000-000000000001', 60, 'UTC')::text, true);
delete from public.friendships where id = '10000000-0000-0000-0000-000000000001';
reset role;
select is((select count(*)::int from public.shared_daily_goals), 0, 'unfriending cascades goal cleanup');

insert into public.friendships(id, requester_id, addressee_id, status) values
 ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'accepted');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('test.goal_id', public.create_shared_daily_goal('00000000-0000-0000-0000-000000000002', 60, 'UTC')::text, true);
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.shared_daily_goals), 0, 'deleting recipient account removes goal');
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select public.get_shared_daily_goals()$$, 'P0001', 'Not authenticated', 'missing verified identity cannot read goals');
reset role;
select * from finish();
rollback;
