begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000a501','reschedule-a@example.com'),
 ('00000000-0000-0000-0000-00000000b501','reschedule-b@example.com'),
 ('00000000-0000-0000-0000-00000000c501','reschedule-c@example.com');
insert into friendships(requester_id,addressee_id,status) values ('00000000-0000-0000-0000-00000000a501','00000000-0000-0000-0000-00000000b501','accepted');
insert into focus_dates(id,proposer_id,recipient_id,starts_at,status) values ('60000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-00000000a501','00000000-0000-0000-0000-00000000b501',now()+interval '1 day','accepted');
select ok(not has_function_privilege('anon','public.reschedule_focus_date(uuid,bigint,text,timestamptz)','EXECUTE'),'anonymous cannot reschedule');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.reschedule_focus_date(uuid,bigint,text,timestamptz)'::regprocedure),'search path pinned');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000c501',true);
select throws_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',1,'propose',now()+interval '2 days')$$,'P0002','Focus date unavailable','outsider blocked');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a501',true);
select throws_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',1,'propose',now()-interval '1 day')$$,'22023','Choose a different future time within 90 days','past proposal blocked');
select lives_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',1,'propose',now()+interval '2 days')$$,'participant proposes');
select is((select starts_at from focus_dates),now()+interval '1 day','original time retained');
select is((select status from focus_dates),'accepted','original agreement retained');
select throws_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',2,'accept')$$,'PT409','Focus date changed elsewhere','cannot accept own proposal');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000b501',true);
select throws_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',1,'accept')$$,'PT409','Focus date changed elsewhere','stale revision blocked');
select lives_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',2,'decline')$$,'partner keeps current time');
select is((select starts_at from focus_dates),now()+interval '1 day','decline preserves original');
select lives_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',3,'propose',now()+interval '3 days')$$,'recipient can propose too');
select lives_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',4,'withdraw')$$,'proposer withdraws');
select lives_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',5,'propose',now()+interval '2 days')$$,'new proposal after withdrawal');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a501',true);
select lives_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',6,'accept')$$,'other participant accepts');
select is((select starts_at from focus_dates),now()+interval '2 days','accepted replacement atomic');
select ok((select proposed_starts_at is null and reschedule_by is null from focus_dates),'proposal cleared after acceptance');
select lives_ok($$select respond_focus_date('60000000-0000-0000-0000-000000000501',7,'cancelled')$$,'existing cancellation still works');
select throws_ok($$select reschedule_focus_date('60000000-0000-0000-0000-000000000501',8,'propose',now()+interval '3 days')$$,'PT409','Focus date changed elsewhere','cancelled date never revived');
select * from finish();
rollback;
