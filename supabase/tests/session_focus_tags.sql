begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Users: a = solo owner and duo participant, b = duo partner, c = outsider,
-- f = disposable cascade account.
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-00000000a201', 'tag-a@example.com'),
 ('00000000-0000-0000-0000-00000000b201', 'tag-b@example.com'),
 ('00000000-0000-0000-0000-00000000c201', 'tag-c@example.com'),
 ('00000000-0000-0000-0000-00000000f201', 'tag-f@example.com');

insert into public.sessions(id, room_code, focus_duration, break_duration, actual_focus, completed, started_at, ended_at) values
 ('40000000-0000-0000-0000-000000000001', 'tag-solo', 1500, 300, 1500, true, now() - interval '30 minutes', now() - interval '5 minutes'),
 ('40000000-0000-0000-0000-000000000002', 'tag-duo', 1500, 300, 1500, true, now() - interval '30 minutes', now() - interval '4 minutes'),
 ('40000000-0000-0000-0000-000000000003', 'tag-stopped', 1500, 300, 600, false, now() - interval '30 minutes', now() - interval '3 minutes'),
 ('40000000-0000-0000-0000-000000000004', 'tag-bonly', 1500, 300, 1500, true, now() - interval '30 minutes', now() - interval '2 minutes'),
 ('40000000-0000-0000-0000-000000000005', 'tag-cascade', 1500, 300, 1500, true, now() - interval '30 minutes', now() - interval '1 minute'),
 ('40000000-0000-0000-0000-000000000006', 'tag-untagged', 1500, 300, 1500, true, now() - interval '30 minutes', now() - interval '6 minutes'),
 ('40000000-0000-0000-0000-000000000007', 'tag-boundary', 1500, 300, 1500, true, '2026-03-01 07:00:00+00', '2026-03-01 07:30:00+00');
insert into public.session_participants(session_id, user_id) values
 ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a201'),
 ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000a201'),
 ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000b201'),
 ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000a201'),
 ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000b201'),
 ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000b201'),
 ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000f201'),
 ('40000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-00000000a201'),
 ('40000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-00000000a201');

-- Calendar totals before any tagging, to prove tags never change them.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a201', true);
select set_config('test.tag_total_before', (select sum(solo_seconds + duo_seconds)::text from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC')), true);
reset role;

-- ── Table constraints, enforced regardless of the RPC layer ─────────────────
select throws_ok(
  $$insert into public.session_focus_tags(session_id, user_id, tag) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a201', 'Work')$$,
  '23514', null, 'table rejects capitalised tag labels');
select throws_ok(
  $$insert into public.session_focus_tags(session_id, user_id, tag) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a201', ' work')$$,
  '23514', null, 'table rejects whitespace variants');
select throws_ok(
  $$insert into public.session_focus_tags(session_id, user_id, tag) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a201', '')$$,
  '23514', null, 'table rejects the empty string (No tag is null)');
select throws_ok(
  $$insert into public.session_focus_tags(session_id, user_id, tag) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a201', 'coding')$$,
  '23514', null, 'table rejects unknown identifiers');
select throws_ok(
  $$insert into public.session_focus_tags(session_id, user_id, tag, version) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a201', null, 0)$$,
  '23514', null, 'table rejects non-positive revisions');
select throws_ok(
  $$insert into public.session_focus_tags(session_id, user_id, tag, version) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a201', null, 9007199254740992)$$,
  '23514', null, 'table rejects revisions beyond JavaScript safe integers');
select throws_ok(
  $$insert into public.session_focus_tags(session_id, user_id, tag) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c201', 'work')$$,
  '23503', null, 'composite participant key prevents tags from non-participants');
select lives_ok(
  $$insert into public.session_focus_tags(session_id, user_id, tag) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a201', null)$$,
  'table accepts a null row for a cleared or untagged round');
delete from public.session_focus_tags where session_id = '40000000-0000-0000-0000-000000000001';

select ok(not has_sequence_privilege('authenticated', 'public.session_focus_tag_revision_seq', 'USAGE')
  and not has_sequence_privilege('anon', 'public.session_focus_tag_revision_seq', 'USAGE')
  and not has_sequence_privilege('public', 'public.session_focus_tag_revision_seq', 'USAGE'),
  'clients cannot use the private revision sequence');

-- ── Owner writes through the RPC ────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a201', true);

select throws_ok($$insert into public.session_focus_tags(session_id, user_id, tag) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a201', 'work')$$,
  '42501', null, 'clients cannot insert tags directly');
select throws_ok($$update public.session_focus_tags set tag = 'other'$$, '42501', null, 'clients cannot update tags directly');
select throws_ok($$delete from public.session_focus_tags$$, '42501', null, 'clients cannot delete tags directly');
select throws_ok($$select nextval('public.session_focus_tag_revision_seq')$$, '42501', null, 'clients cannot advance the revision sequence');

select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'Work', null)$$,
  '22023', 'Unknown focus tag', 'a non-preset label is rejected through the RPC');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'coding', null)$$,
  '22023', 'Unknown focus tag', 'an unknown identifier is rejected through the RPC');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'work', 0)$$,
  '22023', 'Expected version must be a positive safe integer', 'zero is not a valid expected revision');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'work', -4)$$,
  '22023', 'Expected version must be a positive safe integer', 'negative expected revisions are rejected');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'work', 9007199254740992)$$,
  '22023', 'Expected version must be a positive safe integer', 'unsafe expected revisions are rejected');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000003', 'work', null)$$,
  'P0002', 'Focus tag unavailable', 'interrupted sessions cannot receive tags');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000004', 'work', null)$$,
  'P0002', 'Focus tag unavailable', 'a session the caller did not join is rejected');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-0000000000ff', 'work', null)$$,
  'P0002', 'Focus tag unavailable', 'a nonexistent session matches the same error');

-- Create: the confirmed row names this owner, session, tag and a positive revision.
select is(
  (select tag || '|' || (version > 0)::text || '|' || (user_id = '00000000-0000-0000-0000-00000000a201'::uuid)::text || '|' || (session_id = '40000000-0000-0000-0000-000000000001'::uuid)::text
     from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'work', null)),
  'work|true|true|true', 'create returns the confirmed row for the caller');
select set_config('test.tag_v1', (select version::text from public.session_focus_tags where session_id = '40000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000a201'), true);

select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'study', null)$$,
  'PT409', 'Focus tag changed elsewhere', 'a create against an existing row is a conflict, never an overwrite');
select is((select tag from public.session_focus_tags where session_id = '40000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000a201'),
  'work', 'the first tag survives a duplicate create');

select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'study', 9007199254740991)$$,
  'PT409', 'Focus tag changed elsewhere', 'a stale or unknown revision is rejected promptly');
select is(
  (select (version > current_setting('test.tag_v1')::bigint)::text || '|' || tag from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'study', current_setting('test.tag_v1')::bigint)),
  'true|study', 'a matching revision changes the tag and advances the revision');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'planning', current_setting('test.tag_v1')::bigint)$$,
  'PT409', 'Focus tag changed elsewhere', 'an old revision cannot overwrite a later assignment');

-- Clear: the row stays, the tag is null, and the revision advances.
select set_config('test.tag_v2', (select version::text from public.session_focus_tags where session_id = '40000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000a201'), true);
select is(
  (select (tag is null)::text || '|' || (version > current_setting('test.tag_v2')::bigint)::text from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', null, current_setting('test.tag_v2')::bigint)),
  'true|true', 'No tag clears the tag, keeps the row and advances the revision');
select is((select count(*)::int from public.session_focus_tags where session_id = '40000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000a201'),
  1, 'clearing keeps metadata for concurrency');
select set_config('test.tag_v3', (select version::text from public.session_focus_tags where session_id = '40000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000a201'), true);

-- tag -> null -> tag cannot revive the revision an older editor still holds.
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'work', current_setting('test.tag_v2')::bigint)$$,
  'PT409', 'Focus tag changed elsewhere', 'a revision from before clearing cannot reassign');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'work', null)$$,
  'PT409', 'Focus tag changed elsewhere', 'creating over a cleared row is a conflict, not a fresh create');
select is(
  (select tag from public.set_session_focus_tag('40000000-0000-0000-0000-000000000001', 'reading', current_setting('test.tag_v3')::bigint)),
  'reading', 'the cleared revision is the one that can assign the next tag');

-- ── Calendar read: own tag only, never-tagged and cleared rounds distinguishable
select is(
  (select e->>'private_tag' || '|' || (e->>'private_tag_version' is not null)::text
     from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC') d, jsonb_array_elements(d.sessions) e
    where e->>'id' = '40000000-0000-0000-0000-000000000001'),
  'reading|true', 'the calendar returns the caller tag and revision');
select is(
  (select ((e->>'private_tag') is null and (e->>'private_tag_version') is null)::text
     from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC') d, jsonb_array_elements(d.sessions) e
    where e->>'id' = '40000000-0000-0000-0000-000000000006'),
  'true', 'a never-tagged round returns null for both tag fields');
select is(
  (select (e ? 'private_tag')::text || '|' || (e ? 'private_tag_version')::text
     from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC') d, jsonb_array_elements(d.sessions) e
    where e->>'id' = '40000000-0000-0000-0000-000000000006'),
  'true|true', 'both calendar tag keys are present even when null');

-- Cleared rounds: null tag, but the revision remains.
select set_config('test.tag_untagged_version', (select version::text from public.set_session_focus_tag('40000000-0000-0000-0000-000000000006', 'other', null)), true);
select is(
  (select e->>'private_tag' from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC') d, jsonb_array_elements(d.sessions) e
    where e->>'id' = '40000000-0000-0000-0000-000000000006'),
  'other', 'a newly created tag appears on the calendar');

select is(
  (select sum(solo_seconds + duo_seconds)::text from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC')),
  current_setting('test.tag_total_before'), 'tagging changes no focus totals');

-- Month and timezone boundaries: 07:30 UTC on 1 March is 23:30 on 28 February in Los Angeles.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a201', true);
select is((select tag from public.set_session_focus_tag('40000000-0000-0000-0000-000000000007', 'planning', null)), 'planning', 'a boundary round can be tagged');
select is(
  (select e->>'private_tag' from public.get_focus_calendar('2026-02-01', 'America/Los_Angeles') d, jsonb_array_elements(d.sessions) e
    where e->>'id' = '40000000-0000-0000-0000-000000000007'),
  'planning', 'the tag follows the round into its local February');
select is(
  (select count(*)::int from public.get_focus_calendar('2026-03-01', 'America/Los_Angeles') d, jsonb_array_elements(d.sessions) e
    where e->>'id' = '40000000-0000-0000-0000-000000000007'),
  0, 'the same instant is absent from the next local month');
select is(
  (select e->>'private_tag' from public.get_focus_calendar('2026-03-01', 'UTC') d, jsonb_array_elements(d.sessions) e
    where e->>'id' = '40000000-0000-0000-0000-000000000007'),
  'planning', 'in UTC the same round belongs to March');

-- ── Duo: each person keeps an independent tag on the same shared session ────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a201', true);
select is((select tag from public.set_session_focus_tag('40000000-0000-0000-0000-000000000002', 'work', null)), 'work', 'A tags the shared round');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b201', true);
select is((select count(*)::int from public.session_focus_tags where session_id = '40000000-0000-0000-0000-000000000002'), 0, 'B cannot see A''s tag on the shared round');
select is((select tag from public.set_session_focus_tag('40000000-0000-0000-0000-000000000002', 'study', null)), 'study', 'B tags the same round independently');
select is((select string_agg(tag, ',') from public.session_focus_tags where session_id = '40000000-0000-0000-0000-000000000002'), 'study', 'B sees only B''s tag');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000002', 'planning', 1)$$,
  'PT409', 'Focus tag changed elsewhere', 'B cannot change A''s tag through a guessed revision');
select is(
  (select e->>'private_tag' from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC') d, jsonb_array_elements(d.sessions) e
    where e->>'id' = '40000000-0000-0000-0000-000000000002'),
  'study', 'B''s calendar shows only B''s tag');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a201', true);
select is(
  (select e->>'private_tag' from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC') d, jsonb_array_elements(d.sessions) e
    where e->>'id' = '40000000-0000-0000-0000-000000000002'),
  'work', 'A''s calendar shows only A''s tag, never the partner''s');
select is((select count(*)::int from public.session_focus_tags), 4, 'A sees only A''s own rows (rounds 1, 2, 6 and the boundary round)');

-- ── Outsider and anonymous callers ──────────────────────────────────────────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c201', true);
select is((select count(*)::int from public.session_focus_tags), 0, 'an outsider reads no tags');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000002', 'work', null)$$,
  'P0002', 'Focus tag unavailable', 'an outsider cannot tag a shared session');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000002', 'work', 1)$$,
  'P0002', 'Focus tag unavailable', 'an outsider cannot change a tag through a guessed revision');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.session_focus_tags$$, '42501', null, 'anonymous callers cannot read tags');
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000002', 'work', null)$$, '42501', null, 'anonymous callers cannot write tags');
reset role;

-- An RPC call without identity fails before any metadata is touched.
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select * from public.set_session_focus_tag('40000000-0000-0000-0000-000000000002', 'work', null)$$, '42501', 'Not authenticated', 'missing identity is rejected');
reset role;

-- ── Cascades ────────────────────────────────────────────────────────────────
delete from public.session_participants where session_id = '40000000-0000-0000-0000-000000000002' and user_id = '00000000-0000-0000-0000-00000000b201';
select is((select count(*)::int from public.session_focus_tags where user_id = '00000000-0000-0000-0000-00000000b201'), 0, 'removing a participant deletes that person''s tag');
select is((select count(*)::int from public.session_focus_tags where user_id = '00000000-0000-0000-0000-00000000a201' and session_id = '40000000-0000-0000-0000-000000000002'), 1, 'the other participant''s tag survives');

delete from public.sessions where id = '40000000-0000-0000-0000-000000000006';
select is((select count(*)::int from public.session_focus_tags where session_id = '40000000-0000-0000-0000-000000000006'), 0, 'deleting a session removes its tags');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f201', true);
select is((select tag from public.set_session_focus_tag('40000000-0000-0000-0000-000000000005', 'reading', null)), 'reading', 'the cascade fixture has a tag before account deletion');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-00000000f201';
select is((select count(*)::int from public.session_focus_tags where user_id = '00000000-0000-0000-0000-00000000f201'), 0, 'deleting an account removes its tags');

-- ── Grants, RLS and definer boundaries ──────────────────────────────────────
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'session_focus_tags'),
  'focus tags have RLS enabled');
select ok(
  has_table_privilege('authenticated', 'public.session_focus_tags', 'SELECT')
  and not has_table_privilege('authenticated', 'public.session_focus_tags', 'INSERT')
  and not has_table_privilege('authenticated', 'public.session_focus_tags', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.session_focus_tags', 'DELETE')
  and not has_table_privilege('anon', 'public.session_focus_tags', 'SELECT'),
  'clients have read-only table access and anon has none');
select ok(
  has_function_privilege('authenticated', 'public.set_session_focus_tag(uuid,text,bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_session_focus_tag(uuid,text,bigint)', 'EXECUTE')
  and not has_function_privilege('public', 'public.set_session_focus_tag(uuid,text,bigint)', 'EXECUTE')
  and (select prosecdef from pg_proc where oid = 'public.set_session_focus_tag(uuid,text,bigint)'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.set_session_focus_tag(uuid,text,bigint)'::regprocedure) = array['search_path=""']::text[],
  'set_session_focus_tag is authenticated-only with a pinned definer search path');
select ok(
  not has_function_privilege('authenticated', 'public.assert_focus_tag_session_eligible(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.assert_focus_tag_session_eligible(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.assert_focus_tag_session_eligible(uuid)', 'EXECUTE'),
  'the eligibility helper is not callable by clients');
select ok(
  (select prosecdef from pg_proc where oid = 'public.get_focus_calendar(date,text)'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.get_focus_calendar(date,text)'::regprocedure) = array['search_path=""']::text[]
  and has_function_privilege('authenticated', 'public.get_focus_calendar(date,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_focus_calendar(date,text)', 'EXECUTE'),
  'the calendar keeps its pinned search path and authenticated-only grant');

select * from finish();
rollback;
