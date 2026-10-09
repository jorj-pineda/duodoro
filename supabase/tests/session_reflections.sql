begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Users: a = solo owner and duo participant, b = duo partner, c = outsider,
-- d = friend-like account that did not take part, f = disposable cascade account.
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-00000000a001', 'reflect-a@example.com'),
 ('00000000-0000-0000-0000-00000000b001', 'reflect-b@example.com'),
 ('00000000-0000-0000-0000-00000000c001', 'reflect-c@example.com'),
 ('00000000-0000-0000-0000-00000000d001', 'reflect-d@example.com'),
 ('00000000-0000-0000-0000-00000000f001', 'reflect-f@example.com');

insert into public.sessions(id, room_code, focus_duration, break_duration, actual_focus, completed, started_at, ended_at) values
 ('30000000-0000-0000-0000-000000000001', 'reflect-solo', 1500, 300, 1500, true, now() - interval '30 minutes', now() - interval '5 minutes'),
 ('30000000-0000-0000-0000-000000000002', 'reflect-duo', 1500, 300, 1500, true, now() - interval '30 minutes', now() - interval '4 minutes'),
 ('30000000-0000-0000-0000-000000000003', 'reflect-stopped', 1500, 300, 600, false, now() - interval '30 minutes', now() - interval '3 minutes'),
 ('30000000-0000-0000-0000-000000000004', 'reflect-bonly', 1500, 300, 1500, true, now() - interval '30 minutes', now() - interval '2 minutes'),
 ('30000000-0000-0000-0000-000000000005', 'reflect-cascade', 1500, 300, 1500, true, now() - interval '30 minutes', now() - interval '1 minute');
insert into public.session_participants(session_id, user_id) values
 ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001'),
 ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000a001'),
 ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000b001'),
 ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000a001'),
 ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000b001'),
 ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000b001'),
 ('30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000f001');

-- ── Table constraints, enforced regardless of the RPC layer ──────────────────
select throws_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', '   ')$$,
  '23514', null, 'table rejects whitespace-only text');
select throws_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', ' padded ')$$,
  '23514', null, 'table rejects untrimmed text');
select throws_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', E'\u00a0\u3000')$$,
  '23514', null, 'table treats non-ASCII spaces as blank, matching the client''s JavaScript \\s');
select throws_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', E'\u2028leading line separator')$$,
  '23514', null, 'table rejects leading Unicode line separators, which are JavaScript whitespace');
select throws_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', E'windows\r\nline')$$,
  '23514', null, 'table rejects carriage returns');
select throws_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', repeat('x', 501))$$,
  '23514', null, 'table rejects 501 code points');
select throws_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text, version) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', 'ok', 0)$$,
  '23514', null, 'table rejects non-positive versions');
select throws_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', E'bell\u0007')$$,
  '23514', null, 'table rejects control characters');
select lives_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', repeat(E'\U0001F600', 500))$$,
  'table accepts exactly 500 emoji code points');
delete from public.session_reflections where session_id = '30000000-0000-0000-0000-000000000001';
select throws_ok(
  $$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c001', 'outsider note')$$,
  '23503', null, 'composite participant key prevents notes from non-participants');

-- ── Owner writes through RPCs ───────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);

select throws_ok($$insert into public.session_reflections(session_id, user_id, reflection_text) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', 'direct')$$,
  '42501', null, 'clients cannot insert reflections directly');
select throws_ok($$update public.session_reflections set reflection_text = 'forged'$$, '42501', null, 'clients cannot update reflections directly');
select throws_ok($$delete from public.session_reflections$$, '42501', null, 'clients cannot delete reflections directly');

select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000001', E'\u3000\u00a0\ufeff')$$,
  '22023', 'Reflection cannot be blank', 'ideographic and no-break spaces count as blank through the RPC');
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000001', '   ')$$,
  '22023', 'Reflection cannot be blank', 'blank text is rejected through the RPC');
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000001', repeat('x', 501))$$,
  '22023', 'Reflection must be 500 characters or fewer', 'over-limit text is rejected through the RPC');
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000001', E'first\r\nsecond')$$,
  '22023', 'Reflection must be plain text with line feed line endings', 'raw carriage returns are rejected through the RPC');
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000001', ' trimmed ')$$,
  '22023', 'Reflection must not start or end with whitespace', 'untrimmed text is rejected through the RPC');

select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000003', 'stopped')$$,
  'P0002', 'Session reflection unavailable', 'interrupted sessions cannot receive reflections');
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000004', 'not mine')$$,
  'P0002', 'Session reflection unavailable', 'a session the caller did not join is rejected');
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-0000000000ff', 'missing')$$,
  'P0002', 'Session reflection unavailable', 'a nonexistent session matches the same error');

select is(
  (select reflection_text || '|' || version || '|' || (session_id = '30000000-0000-0000-0000-000000000001'::uuid) || '|' || (user_id = '00000000-0000-0000-0000-00000000a001'::uuid)
     from public.create_session_reflection('30000000-0000-0000-0000-000000000001', E'Good focus.\nNext: stretch')),
  'Good focus.' || E'\n' || 'Next: stretch|1|true|true',
  'create returns the saved row with server owner, normalized text and version 1');

select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000001', 'second attempt')$$,
  '23505', 'Reflection already exists', 'duplicate creation conflicts instead of overwriting');
select is((select reflection_text from public.session_reflections where session_id = '30000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000a001'),
  'Good focus.' || E'\n' || 'Next: stretch', 'the first note survives a duplicate create');

select throws_ok($$select public.update_session_reflection('30000000-0000-0000-0000-000000000001', 'edit', 0)$$,
  '22023', 'Expected version is required', 'update requires a positive expected version');
select throws_ok($$select public.update_session_reflection('30000000-0000-0000-0000-000000000001', 'edit', 9)$$,
  '40001', 'Reflection changed elsewhere', 'stale update version is rejected');
select is(
  (select version || '|' || reflection_text from public.update_session_reflection('30000000-0000-0000-0000-000000000001', 'Edited note', 1)),
  '2|Edited note', 'matching update increments the version and returns the saved row');
select throws_ok($$select public.update_session_reflection('30000000-0000-0000-0000-000000000001', 'stale second edit', 1)$$,
  '40001', 'Reflection changed elsewhere', 'a second writer holding the old version cannot overwrite');
select ok(
  (select updated_at >= created_at from public.session_reflections where session_id = '30000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000a001'),
  'updated_at is never before created_at');

select throws_ok($$select public.delete_session_reflection('30000000-0000-0000-0000-000000000001', 1)$$,
  '40001', 'Reflection changed elsewhere', 'stale delete version is rejected');
select is(
  (select session_id::text || '|' || deleted_version from public.delete_session_reflection('30000000-0000-0000-0000-000000000001', 2)),
  '30000000-0000-0000-0000-000000000001|2', 'matching delete returns the deleted record');
select throws_ok($$select public.delete_session_reflection('30000000-0000-0000-0000-000000000001', 2)$$,
  '40001', 'Reflection changed elsewhere', 'a repeated delete is a conflict, not silent success');

-- ── Duo: each person writes their own note; neither can read or change the other's
select is(public.create_session_reflection('30000000-0000-0000-0000-000000000002', 'A duo note')::text is not null, true, 'duo owner A saves a note');
select is((select count(*)::int from public.session_reflections where session_id = '30000000-0000-0000-0000-000000000002'), 1, 'A sees only A''s note on the shared session');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b001', true);
select is((select count(*)::int from public.session_reflections where session_id = '30000000-0000-0000-0000-000000000002'), 0, 'B does not see A''s duo note');
select throws_ok($$select public.update_session_reflection('30000000-0000-0000-0000-000000000002', 'B wants this', 1)$$,
  '40001', 'Reflection changed elsewhere', 'B cannot update A''s note: B has no row there, so the stale-or-missing check rejects it');
select is((select reflection_text from public.create_session_reflection('30000000-0000-0000-0000-000000000002', 'B private note')), 'B private note', 'B saves an independent note on the same duo session');
select is((select count(*)::int from public.session_reflections where session_id = '30000000-0000-0000-0000-000000000002'), 1, 'B sees only B''s note');
select is((select user_id::text from public.delete_session_reflection('30000000-0000-0000-0000-000000000002', 1)), '00000000-0000-0000-0000-00000000b001', 'B''s delete can only ever target B''s own row');
select is((select count(*)::int from public.session_reflections where user_id = '00000000-0000-0000-0000-00000000a001'), 0, 'B cannot read A''s rows by user filter');
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000001', 'not a participant')$$,
  'P0002', 'Session reflection unavailable', 'B cannot write to a session B did not join');
-- Partner B can see their own participation in a session they joined alone with A. B cannot see A's solo reflections.

-- ── Outsider and anonymous callers ──────────────────────────────────────────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c001', true);
select is((select count(*)::int from public.session_reflections), 0, 'outsider reads no reflections');
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000002', 'outsider')$$,
  'P0002', 'Session reflection unavailable', 'outsider cannot create on a shared session');
select throws_ok($$select public.delete_session_reflection('30000000-0000-0000-0000-000000000002', 1)$$,
  'P0002', 'Session reflection unavailable', 'outsider cannot delete on a shared session');

reset role;
set local role anon;
select throws_ok($$select count(*) from public.session_reflections$$, '42501', null, 'anonymous callers cannot read reflections');
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000002', 'anon')$$, '42501', null, 'anonymous callers cannot create reflections');
select throws_ok($$select public.update_session_reflection('30000000-0000-0000-0000-000000000002', 'anon', 1)$$, '42501', null, 'anonymous callers cannot update reflections');
select throws_ok($$select public.delete_session_reflection('30000000-0000-0000-0000-000000000002', 1)$$, '42501', null, 'anonymous callers cannot delete reflections');
reset role;

-- An unauthenticated RPC call has no auth.uid(); it must fail the same way.
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select public.create_session_reflection('30000000-0000-0000-0000-000000000002', 'nobody')$$, '42501', 'Not authenticated', 'missing identity is rejected');
reset role;

-- ── Calendar and totals are unchanged by reflections ────────────────────────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);
set local role authenticated;
select set_config('test.before_calendar', (select sum(solo_seconds + duo_seconds)::text from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC')), true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a001', true);
select public.create_session_reflection('30000000-0000-0000-0000-000000000001', 'calendar neutral note');
select is(
  (select sum(solo_seconds + duo_seconds)::text from public.get_focus_calendar(date_trunc('month', now())::date, 'UTC')),
  current_setting('test.before_calendar'),
  'writing a reflection changes no focus totals');
reset role;

-- ── Cascades ────────────────────────────────────────────────────────────────
-- Remove B's participation in the duo session: B's note goes, A's stays.
delete from public.session_participants where session_id = '30000000-0000-0000-0000-000000000002' and user_id = '00000000-0000-0000-0000-00000000b001';
select is((select count(*)::int from public.session_reflections where user_id = '00000000-0000-0000-0000-00000000b001'), 0, 'removing a participant deletes that person''s reflection');
select is((select count(*)::int from public.session_reflections where user_id = '00000000-0000-0000-0000-00000000a001' and session_id = '30000000-0000-0000-0000-000000000002'), 1, 'the other participant''s reflection survives');

-- Deleting a session removes every note attached to it.
delete from public.sessions where id = '30000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.session_reflections where session_id = '30000000-0000-0000-0000-000000000002'), 0, 'deleting a session removes its reflections');

-- Deleting an account removes its notes, profile links and participant rows.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f001', true);
select is((select reflection_text from public.create_session_reflection('30000000-0000-0000-0000-000000000005', 'cascade fixture note')), 'cascade fixture note', 'cascade fixture has a note before account deletion');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-00000000f001';
select is((select count(*)::int from public.session_reflections where user_id = '00000000-0000-0000-0000-00000000f001'), 0, 'deleting an account removes its reflections');

-- ── Grants, RLS and definer boundaries ──────────────────────────────────────
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'session_reflections'),
  'session reflections have RLS enabled');
select ok(
  has_table_privilege('authenticated', 'public.session_reflections', 'SELECT')
  and not has_table_privilege('authenticated', 'public.session_reflections', 'INSERT')
  and not has_table_privilege('authenticated', 'public.session_reflections', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.session_reflections', 'DELETE')
  and not has_table_privilege('anon', 'public.session_reflections', 'SELECT'),
  'clients have read-only table access and anon has none');
select ok(
  has_function_privilege('authenticated', signature, 'EXECUTE')
  and not has_function_privilege('anon', signature, 'EXECUTE')
  and not has_function_privilege('public', signature, 'EXECUTE')
  and (select prosecdef from pg_proc where oid = signature::regprocedure)
  and (select proconfig from pg_proc where oid = signature::regprocedure) = array['search_path=""']::text[],
  signature || ' is authenticated-only with a pinned definer search path'
) from unnest(array[
  'public.create_session_reflection(uuid,text)',
  'public.update_session_reflection(uuid,text,bigint)',
  'public.delete_session_reflection(uuid,bigint)'
]) signature;
select ok(
  not has_function_privilege('authenticated', 'public.check_session_reflection_text(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.check_session_reflection_text(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.assert_reflection_session_eligible(uuid)', 'EXECUTE'),
  'validation and eligibility helpers are not callable by clients');

select * from finish();
rollback;
