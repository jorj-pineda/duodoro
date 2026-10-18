begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-00000000a701','privacy-a@example.invalid'),
 ('00000000-0000-4000-8000-00000000b701','privacy-b@example.invalid'),
 ('00000000-0000-4000-8000-00000000c701','privacy-c@example.invalid');
update profiles set current_session_id='10000000-0000-4000-8000-00000000a701',current_world_id='forest',current_room='private-room'
 where id in ('00000000-0000-4000-8000-00000000a701','00000000-0000-4000-8000-00000000b701');
insert into friendships(id,requester_id,addressee_id) values
 ('20000000-0000-4000-8000-00000000a701','00000000-0000-4000-8000-00000000a701','00000000-0000-4000-8000-00000000b701');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a701',true);
select is((select count(*) from profiles where id='00000000-0000-4000-8000-00000000b701'),0::bigint,'pending requester cannot read recipient presence');
select is((select count(*) from profiles where id='00000000-0000-4000-8000-00000000a701'),1::bigint,'own profile remains readable');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000b701',true);
select is((select count(*) from profiles where id='00000000-0000-4000-8000-00000000a701'),0::bigint,'pending recipient cannot read requester presence');
-- RPC checks follow the privacy regressions so a pre-migration run proves
-- the disclosure before encountering the newly introduced function.
select is((select count(*) from get_friend_requests()),1::bigint,'recipient can list incoming request');
select is((select requester_id from get_friend_requests()),'00000000-0000-4000-8000-00000000a701'::uuid,'request identity is accurate');
select ok((select to_jsonb(r) ?& array['id','requester_id','username','discriminator','display_name','is_premium']
 and not (to_jsonb(r) ?| array['current_session_id','current_room','current_world_id','avatar_config','email'])
 from get_friend_requests() r),'RPC exposes public identity only');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a701',true);
select is((select count(*) from get_friend_requests()),0::bigint,'requester cannot list recipient requests');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000c701',true);
select is((select count(*) from get_friend_requests()),0::bigint,'outsider cannot list requests');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000b701',true);
update friendships set status='accepted' where id='20000000-0000-4000-8000-00000000a701';
select is((select count(*) from get_friend_requests()),0::bigint,'accepted request leaves inbox');
select is((select current_world_id from profiles where id='00000000-0000-4000-8000-00000000a701'),'forest','accepted recipient can read presence');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a701',true);
select is((select current_world_id from profiles where id='00000000-0000-4000-8000-00000000b701'),'forest','accepted requester can read presence');
delete from friendships where id='20000000-0000-4000-8000-00000000a701';
select is((select count(*) from profiles where id='00000000-0000-4000-8000-00000000b701'),0::bigint,'unfriending removes presence access');
reset role;
select ok(not has_function_privilege('anon','public.get_friend_requests()','EXECUTE'),'anonymous cannot execute inbox RPC');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.get_friend_requests()'::regprocedure),'RPC search path is pinned');
select * from finish();
rollback;
