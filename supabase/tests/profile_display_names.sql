begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-4000-8000-00000000a901','names-a@example.invalid','{}'),
 ('00000000-0000-4000-8000-00000000b901','names-b@example.invalid','{}'),
 ('00000000-0000-4000-8000-00000000c901','names-c@example.invalid',jsonb_build_object('full_name',repeat('x',1000)));
select ok((select char_length(display_name) <= 50 from profiles where id='00000000-0000-4000-8000-00000000c901'),'provider-supplied initial names are bounded');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a901',true);
select throws_ok($$update profiles set display_name=repeat('x',10000) where id='00000000-0000-4000-8000-00000000a901'$$,'23514',null,'direct writes cannot store oversized names');
select throws_ok($$update profiles set display_name='   ' where id='00000000-0000-4000-8000-00000000a901'$$,'23514',null,'direct writes cannot store blank names');
select throws_ok($$select change_display_name(null)$$,'22023',null,'RPC rejects null names');
select throws_ok($$select change_display_name(repeat('x',51))$$,'22023',null,'RPC rejects oversized names');
-- Restore a clean initial state when this test is run against the vulnerable schema.
reset role;
update profiles set display_name='Initial' where id='00000000-0000-4000-8000-00000000a901';
update profiles set display_name_changed_at=null where id='00000000-0000-4000-8000-00000000a901';
set local role authenticated;
select lives_ok($$update profiles set display_name='Setup Name' where id='00000000-0000-4000-8000-00000000a901'$$,'initial setup may set a display name');
select ok((select display_name_changed_at is not null from profiles where id='00000000-0000-4000-8000-00000000a901'),'setup starts the shared cooldown');
select throws_ok($$update profiles set display_name='Bypass Name' where id='00000000-0000-4000-8000-00000000a901'$$,'P0001',null,'direct writes cannot bypass cooldown');
select throws_ok($$update profiles set display_name=null where id='00000000-0000-4000-8000-00000000a901'$$,'P0001',null,'clearing cannot bypass cooldown');
select throws_ok($$select change_display_name('Another Name')$$,'P0001',null,'RPC observes the same cooldown');
select lives_ok($$update profiles set display_name='Setup Name' where id='00000000-0000-4000-8000-00000000a901'$$,'retrying an identical setup write remains safe');
select lives_ok($$select change_display_name(' Setup Name ')$$,'same-name RPC retry succeeds during cooldown');
select is((select display_name from profiles where id='00000000-0000-4000-8000-00000000a901'),'Setup Name','same-name retry preserves the stored name');
select throws_ok($$update profiles set display_name_changed_at=now()-interval '8 days' where id='00000000-0000-4000-8000-00000000a901'$$,'42501',null,'caller cannot reset cooldown timestamp');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000b901',true);
update profiles set display_name='Forged Name' where id='00000000-0000-4000-8000-00000000a901';
reset role;
select is((select display_name from profiles where id='00000000-0000-4000-8000-00000000a901'),'Setup Name','another account cannot rename the owner');
update profiles set display_name_changed_at=now()-interval '8 days' where id='00000000-0000-4000-8000-00000000a901';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a901',true);
select is((change_display_name(' After Cooldown ')->>'display_name'),'After Cooldown','rename succeeds after cooldown and trims whitespace');
select ok((select display_name_changed_at=now() from profiles where id='00000000-0000-4000-8000-00000000a901'),'successful rename advances the cooldown');
reset role;
select ok(not has_function_privilege('anon','public.change_display_name(text)','EXECUTE'),'anonymous caller cannot invoke rename RPC');
select * from finish();
rollback;
