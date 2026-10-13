begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-00000000a301', 'weekly-a@example.com'),
 ('00000000-0000-0000-0000-00000000b301', 'weekly-b@example.com');
insert into public.tasks(id, owner_id, content, room_code, is_shared) values
 ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a301','a1',null,false),
 ('50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000a301','a2',null,false),
 ('50000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000a301','a3',null,false),
 ('50000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-00000000a301','a4',null,false),
 ('50000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-00000000b301','b1',null,false),
 ('50000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-00000000a301','room','weekly-room',false),
 ('50000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-00000000a301','shared',null,true);
select ok((select relrowsecurity from pg_class where oid = 'public.weekly_focus_plans'::regclass), 'weekly plans enforce RLS');
select ok(not has_table_privilege('anon','public.weekly_focus_plans','SELECT'), 'anonymous cannot read');
select ok(not has_table_privilege('authenticated','public.weekly_focus_plans','INSERT'), 'clients cannot insert directly');
select ok(not has_table_privilege('authenticated','public.weekly_focus_plans','UPDATE'), 'clients cannot update directly');
select ok(not has_table_privilege('authenticated','public.weekly_focus_plans','DELETE'), 'clients cannot delete revisions');
select ok(not has_sequence_privilege('authenticated','public.weekly_focus_plan_revision_seq','USAGE'), 'clients cannot advance revisions');
select ok(not has_function_privilege('anon','public.set_weekly_focus_plan(date,uuid[],bigint)','EXECUTE'), 'anonymous cannot execute');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.set_weekly_focus_plan(date,uuid[],bigint)'::regprocedure), 'definer search path is pinned');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a301',true);
select throws_ok($$select public.set_weekly_focus_plan('2026-10-13','{}',null)$$,'22023','Invalid weekly plan','rejects non-Monday');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12',array['50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000004']::uuid[],null)$$,'22023','Invalid weekly plan','enforces three-goal cap');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12',array['50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001']::uuid[],null)$$,'P0002','Personal goal unavailable','rejects duplicates');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12',array['50000000-0000-0000-0000-000000000005']::uuid[],null)$$,'P0002','Personal goal unavailable','rejects partner goal');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12',array['50000000-0000-0000-0000-000000000006']::uuid[],null)$$,'P0002','Personal goal unavailable','rejects room goal');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12',array['50000000-0000-0000-0000-000000000007']::uuid[],null)$$,'P0002','Personal goal unavailable','rejects shared goal');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12',array[null]::uuid[],null)$$,'22023','Invalid weekly plan','rejects null ID');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12','{}',0)$$,'22023','Invalid revision','rejects invalid revision');
select lives_ok($$select public.set_weekly_focus_plan('2026-10-12',array['50000000-0000-0000-0000-000000000001']::uuid[],null)$$,'creates private plan');
select set_config('test.weekly_version',(select version::text from public.weekly_focus_plans),true);
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12','{}',null)$$,'PT409','Weekly plan changed elsewhere','create cannot overwrite');
select lives_ok($$select public.set_weekly_focus_plan('2026-10-12','{}',current_setting('test.weekly_version')::bigint)$$,'clears but retains row');
select is((select cardinality(task_ids) from public.weekly_focus_plans),0,'cleared plan is empty');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12',array['50000000-0000-0000-0000-000000000001']::uuid[],current_setting('test.weekly_version')::bigint)$$,'PT409','Weekly plan changed elsewhere','stale revision cannot revive cleared plan');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12','{}',null)$$,'PT409','Weekly plan changed elsewhere','cleared row cannot be recreated');
select lives_ok($$select public.set_weekly_focus_plan('2026-10-19','{}',null)$$,'next week has independent row');
select is((select content from public.tasks where id='50000000-0000-0000-0000-000000000001'),'a1','planning never changes goal content');
select is((select is_done from public.tasks where id='50000000-0000-0000-0000-000000000001'),false,'planning never completes goals');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b301',true);
select is((select count(*) from public.weekly_focus_plans),0::bigint,'partner cannot read plans');
select throws_ok($$select public.set_weekly_focus_plan('2026-10-12','{}',current_setting('test.weekly_version')::bigint)$$,'PT409','Weekly plan changed elsewhere','partner cannot change owner plan');
select lives_ok($$select public.set_weekly_focus_plan('2026-10-12',array['50000000-0000-0000-0000-000000000005']::uuid[],null)$$,'partner has independent plan');
reset role;
delete from auth.users where id='00000000-0000-0000-0000-00000000a301';
select is((select count(*) from public.weekly_focus_plans where user_id='00000000-0000-0000-0000-00000000a301'),0::bigint,'account deletion cascades plans');
select * from finish();
rollback;
