begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-00000000a601','consent-a@example.invalid'),
 ('00000000-0000-4000-8000-00000000b601','consent-b@example.invalid'),
 ('00000000-0000-4000-8000-00000000c601','consent-c@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a601',true);
select throws_ok($$insert into friendships(requester_id,addressee_id,status) values
 ('00000000-0000-4000-8000-00000000a601','00000000-0000-4000-8000-00000000b601','accepted')$$,
 '42501',null,'requester cannot insert an already accepted friendship');
select throws_ok($$insert into friendships(requester_id,addressee_id,status) values
 ('00000000-0000-4000-8000-00000000b601','00000000-0000-4000-8000-00000000c601','pending')$$,
 '42501',null,'requester identity cannot be forged');
select throws_ok($$insert into friendships(requester_id,addressee_id,status) values
 ('00000000-0000-4000-8000-00000000a601','00000000-0000-4000-8000-00000000a601','pending')$$,
 '42501',null,'self friendship cannot bypass recipient consent');
select throws_ok($$insert into friendships(requester_id,addressee_id,status) values
 ('00000000-0000-4000-8000-00000000a601','00000000-0000-4000-8000-00000000c601',null)$$,
 '42501',null,'null status cannot bypass the pending state');
-- A preceding regression assertion inserts a row on vulnerable schemas.
-- Remove it so every subsequent assertion still exercises its intended case.
delete from friendships where requester_id='00000000-0000-4000-8000-00000000a601';
select lives_ok($$insert into friendships(id,requester_id,addressee_id) values
 ('10000000-0000-4000-8000-00000000a601','00000000-0000-4000-8000-00000000a601','00000000-0000-4000-8000-00000000b601')$$,
 'normal requests still default to pending');
select is((select status from friendships where id='10000000-0000-4000-8000-00000000a601'),'pending','request begins pending');
update friendships set status='accepted' where id='10000000-0000-4000-8000-00000000a601';
select is((select status from friendships where id='10000000-0000-4000-8000-00000000a601'),'pending','requester cannot accept own request');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000c601',true);
update friendships set status='accepted' where id='10000000-0000-4000-8000-00000000a601';
select is((select count(*) from friendships),0::bigint,'outsider cannot see the request');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000b601',true);
select is((select status from friendships where id='10000000-0000-4000-8000-00000000a601'),'pending','outsider could not accept the request');
select throws_ok($$update friendships set requester_id='00000000-0000-4000-8000-00000000c601',status='accepted'
 where id='10000000-0000-4000-8000-00000000a601'$$,'42501',null,'recipient cannot replace the requester');
select lives_ok($$update friendships set status='accepted' where id='10000000-0000-4000-8000-00000000a601'$$,'recipient may accept');
select is((select status from friendships where id='10000000-0000-4000-8000-00000000a601'),'accepted','recipient acceptance persists');
update friendships set status='pending' where id='10000000-0000-4000-8000-00000000a601';
select is((select status from friendships where id='10000000-0000-4000-8000-00000000a601'),'accepted','accepted friendship cannot be reverted to pending');
select lives_ok($$delete from friendships where id='10000000-0000-4000-8000-00000000a601'$$,'recipient may remove friendship');
select is((select count(*) from friendships),0::bigint,'recipient removal persists');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a601',true);
insert into friendships(requester_id,addressee_id) values
 ('00000000-0000-4000-8000-00000000a601','00000000-0000-4000-8000-00000000b601');
delete from friendships where requester_id='00000000-0000-4000-8000-00000000a601';
select is((select count(*) from friendships),0::bigint,'requester may withdraw a pending request');
reset role;
set local role anon;
select throws_ok($$insert into friendships(requester_id,addressee_id) values
 ('00000000-0000-4000-8000-00000000a601','00000000-0000-4000-8000-00000000b601')$$,
 '42501',null,'anonymous requests remain forbidden');
select * from finish();
rollback;
