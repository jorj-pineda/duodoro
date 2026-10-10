begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

select ok(
  current_setting('server_version_num')::integer between 170000 and 179999,
  'migrations run against PostgreSQL 17'
);

select has_table(
  'public'::name,
  table_name::name,
  format('table public.%I exists', table_name)
)
  from unnest(array[
    'profiles',
    'friendships',
    'tasks',
    'waitlist',
    'sessions',
    'session_participants',
    'premium_grants',
    'shared_daily_goals',
    'session_reflections'
  ]) as table_name;

select has_column(
  'public'::name,
  'profiles'::name,
  column_name::name,
  format('profiles.%I exists', column_name)
)
  from unnest(array[
    'discriminator',
    'username_changed',
    'display_name_changed_at',
    'current_session_id',
    'current_world_id',
    'is_premium'
  ]) as column_name;

select has_column(
  'public'::name,
  'tasks'::name,
  'completed_by'::name,
  'tasks.completed_by exists'
);
select has_column(
  'public'::name,
  'sessions'::name,
  'recording_key'::name,
  'sessions.recording_key exists'
);

select ok(
  not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any(array[
         'profiles', 'friendships', 'tasks', 'waitlist', 'sessions',
         'session_participants', 'premium_grants', 'shared_daily_goals',
         'session_reflections'
       ])
       and not c.relrowsecurity
  ),
  'RLS is enabled on every application table'
);

select is(
  (
    select array_agg(policyname::text order by policyname)
      from pg_policies
     where schemaname = 'public'
  ),
  array[
    'friendships_accept',
    'friendships_delete',
    'friendships_insert',
    'friendships_read_own',
    'premium_grants_read_own',
    'profiles_insert_own',
    'profiles_read_known',
    'profiles_update_own',
    'session_reflections_read_own',
    'sessions_read_own',
    'shared_daily_goals_delete',
    'shared_daily_goals_read',
    'sp_read_own',
    'tasks_delete',
    'tasks_insert',
    'tasks_read',
    'tasks_update',
    'waitlist_insert'
  ]::text[],
  'the final RLS policy set matches the application contract'
);

select ok(
  exists (
    select 1
      from pg_constraint
     where conname = 'sessions_world_check'
       and pg_get_constraintdef(oid) like '%grocery%'
       and pg_get_constraintdef(oid) like '%lofi%'
  ),
  'the world constraint includes grocery and preserves historical lofi rows'
);

select has_index(
  'public'::name,
  'friendships'::name,
  'friendships_pair_unique'::name,
  'friendship pairs stay unique in either direction'
);
select has_index(
  'public'::name,
  'tasks'::name,
  'tasks_owner_room_idx'::name,
  'owner room task reads are indexed'
);
select has_index(
  'public'::name,
  'session_participants'::name,
  'session_participants_session_user_idx'::name,
  'session participant policy lookups are indexed'
);
select has_index(
  'public'::name,
  'sessions'::name,
  'sessions_recording_key_unique'::name,
  'focus recording idempotency keys are unique'
);

select has_function('public', 'claim_username', array['text']);
select has_function('public', 'search_profiles', array['text']);
select has_function('public', 'toggle_shared_task', array['uuid', 'boolean']);
select has_function('public', 'claim_premium', array['boolean']);
select has_function('public', 'total_focus_seconds', array['uuid']);
select has_function('public', 'list_accepted_friend_ids', array['uuid']);
select has_function(
  'public',
  'record_focus_session',
  array[
    'uuid', 'text', 'text', 'integer', 'integer', 'integer', 'boolean',
    'timestamp with time zone', 'uuid[]'
  ]
);

select ok(
  not (select prosecdef from pg_proc where oid = 'public.record_focus_session(uuid,text,text,integer,integer,integer,boolean,timestamptz,uuid[])'::regprocedure),
  'record_focus_session is security invoker'
);
select is(
  (select proconfig from pg_proc where oid = 'public.record_focus_session(uuid,text,text,integer,integer,integer,boolean,timestamptz,uuid[])'::regprocedure),
  array['search_path=""']::text[],
  'record_focus_session has an empty search path'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_focus_session(uuid,text,text,integer,integer,integer,boolean,timestamptz,uuid[])',
    'EXECUTE'
  ),
  'service_role can record focus sessions'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_focus_session(uuid,text,text,integer,integer,integer,boolean,timestamptz,uuid[])',
    'EXECUTE'
  ),
  'authenticated clients cannot record focus sessions'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.search_profiles(text)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.search_profiles(text)',
    'EXECUTE'
  ),
  'profile search is authenticated-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.total_focus_seconds(uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.total_focus_seconds(uuid)',
    'EXECUTE'
  ),
  'cross-user focus totals are service-role-only'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.list_accepted_friend_ids(uuid)'::regprocedure),
  'list_accepted_friend_ids is security definer'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.list_accepted_friend_ids(uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.list_accepted_friend_ids(uuid)',
    'EXECUTE'
  ),
  'accepted-friend lookups are service-role-only'
);

select ok(
  exists (
    select 1
      from pg_trigger
     where tgname = 'on_auth_user_created'
       and not tgisinternal
  ),
  'new auth users receive a profile through the signup trigger'
);

select is(
  (
    select array_agg(tablename::text order by tablename)
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = any(array['profiles', 'tasks', 'friendships', 'shared_daily_goals'])
  ),
  array['friendships', 'profiles', 'shared_daily_goals', 'tasks']::text[],
  'social and task tables are in the realtime publication'
);

select has_index('public'::name, 'shared_daily_goals'::name, 'shared_daily_goals_friendship_id_key'::name, 'one goal per friendship');
select ok(not has_table_privilege('authenticated', 'public.shared_daily_goals', 'INSERT'), 'clients cannot bypass goal invitation RPC');
select ok(not has_table_privilege('authenticated', 'public.shared_daily_goals', 'UPDATE'), 'clients cannot self-accept or change timezone');
select ok(
  has_function_privilege('authenticated', signature, 'EXECUTE')
  and not has_function_privilege('anon', signature, 'EXECUTE')
  and (select prosecdef from pg_proc where oid = signature::regprocedure)
  and (select proconfig from pg_proc where oid = signature::regprocedure) = array['search_path=""']::text[],
  signature || ' is authenticated-only with a pinned definer search path'
) from unnest(array[
  'public.create_shared_daily_goal(uuid,integer,text)',
  'public.accept_shared_daily_goal(uuid)',
  'public.update_shared_daily_goal(uuid,integer)',
  'public.get_shared_daily_goals()'
]) signature;
select ok(
  has_function_privilege('authenticated', 'public.get_weekly_duo_recap(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_weekly_duo_recap(text)', 'EXECUTE')
  and (select prosecdef from pg_proc where oid = 'public.get_weekly_duo_recap(text)'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.get_weekly_duo_recap(text)'::regprocedure) = array['search_path=""']::text[],
  'weekly recap is authenticated-only with a pinned definer search path'
);
select ok(
  has_function_privilege('authenticated', 'public.get_focus_calendar(date,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_focus_calendar(date,text)', 'EXECUTE')
  and (select prosecdef from pg_proc where oid = 'public.get_focus_calendar(date,text)'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.get_focus_calendar(date,text)'::regprocedure) = array['search_path=""']::text[],
  'focus calendar is authenticated-only with a pinned definer search path'
);
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
  not has_table_privilege('authenticated', 'public.session_reflections', 'INSERT')
  and not has_table_privilege('authenticated', 'public.session_reflections', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.session_reflections', 'DELETE'),
  'private reflections have no direct client write grants'
);
select * from finish();
rollback;
