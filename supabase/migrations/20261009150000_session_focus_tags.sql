-- ─────────────────────────────────────────────────────────────────────────────
-- Private focus tags
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One optional preset label per participant per saved, completed focus session.
-- Tags are personal: a partner can neither read nor change them, and they feed
-- no totals, goals, streaks, milestones, recaps or companion growth.
--
-- Clearing a tag keeps the row (tag = null) and advances its revision, so a
-- stale editor cannot resurrect an old assignment through tag -> none -> tag.
-- Revisions come from a private sequence that clients cannot advance, separate
-- from the reflection sequence.

CREATE SEQUENCE public.session_focus_tag_revision_seq AS bigint
  MINVALUE 1 MAXVALUE 9007199254740991 NO CYCLE;
REVOKE ALL ON SEQUENCE public.session_focus_tag_revision_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.session_focus_tag_revision_seq TO service_role;

CREATE TABLE public.session_focus_tags (
  session_id uuid NOT NULL,
  user_id    uuid NOT NULL,
  tag        text,
  version    bigint NOT NULL DEFAULT pg_catalog.nextval('public.session_focus_tag_revision_seq'::regclass),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id),
  -- Deleting a session, a participant link, or an account removes the tag.
  CONSTRAINT session_focus_tags_participant_fk
    FOREIGN KEY (session_id, user_id)
    REFERENCES public.session_participants (session_id, user_id)
    ON DELETE CASCADE,
  -- Exact preset identifiers only. Null means "No tag"; it is never a tag value.
  CONSTRAINT session_focus_tags_tag_valid CHECK (
    tag IS NULL OR tag IN ('work', 'study', 'creative', 'reading', 'planning', 'other')
  ),
  CONSTRAINT session_focus_tags_version_safe CHECK (version BETWEEN 1 AND 9007199254740991)
);

ALTER TABLE public.session_focus_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_focus_tags FROM anon, authenticated;
GRANT SELECT ON public.session_focus_tags TO authenticated;
GRANT ALL ON public.session_focus_tags TO service_role;

-- Own rows only, and only for sessions the caller still participates in.
-- is_session_participant() is SECURITY DEFINER, so this policy does not
-- reference its own table.
CREATE POLICY session_focus_tags_read_own ON public.session_focus_tags
FOR SELECT TO authenticated USING (
  user_id = (SELECT auth.uid())
  AND public.is_session_participant(session_id)
);

-- Completed sessions the caller participated in. Missing, unfinished and
-- foreign sessions produce the same error, so existence cannot be probed.
CREATE FUNCTION public.assert_focus_tag_session_eligible(p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.session_participants sp
      JOIN public.sessions s ON s.id = sp.session_id
     WHERE sp.session_id = p_session_id
       AND sp.user_id = (SELECT auth.uid())
       AND s.completed
  ) THEN
    RAISE EXCEPTION 'Focus tag unavailable' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- p_expected_version null  => create only when the caller has no row yet.
-- p_expected_version n     => change only the caller's row at revision n.
-- p_tag null               => No tag (the row is kept; its revision advances).
-- Every conflict is PT409 (HTTP 409), never a retryable serialization failure,
-- and nothing is ever overwritten without a matching revision.
CREATE FUNCTION public.set_session_focus_tag(p_session_id uuid, p_tag text, p_expected_version bigint)
RETURNS TABLE (session_id uuid, user_id uuid, tag text, version bigint, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_tag IS NOT NULL AND p_tag NOT IN ('work', 'study', 'creative', 'reading', 'planning', 'other') THEN
    RAISE EXCEPTION 'Unknown focus tag' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version IS NOT NULL AND (p_expected_version < 1 OR p_expected_version > 9007199254740991) THEN
    RAISE EXCEPTION 'Expected version must be a positive safe integer' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_focus_tag_session_eligible(p_session_id);
  IF p_expected_version IS NULL THEN
    RETURN QUERY
      INSERT INTO public.session_focus_tags AS t (session_id, user_id, tag)
      VALUES (p_session_id, caller, p_tag)
      ON CONFLICT ON CONSTRAINT session_focus_tags_pkey DO NOTHING
      RETURNING t.session_id, t.user_id, t.tag, t.version, t.updated_at;
  ELSE
    RETURN QUERY
      UPDATE public.session_focus_tags AS t
         SET tag = p_tag,
             updated_at = pg_catalog.now(),
             version = pg_catalog.nextval('public.session_focus_tag_revision_seq'::regclass)
       WHERE t.session_id = p_session_id
         AND t.user_id = caller
         AND t.version = p_expected_version
      RETURNING t.session_id, t.user_id, t.tag, t.version, t.updated_at;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Focus tag changed elsewhere' USING ERRCODE = 'PT409';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.assert_focus_tag_session_eligible(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_session_focus_tag(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_session_focus_tag(uuid, text, bigint) TO authenticated;

-- Calendar read: same signature, same top-level columns, same totals. Each
-- session gains the caller's own tag and revision. The join is on BOTH the
-- session and the caller, so a partner's metadata can never be attached.
-- A cleared tag keeps its revision; a never-tagged session has null for both.
CREATE OR REPLACE FUNCTION public.get_focus_calendar(month_start date, tz text default 'UTC')
RETURNS TABLE (day date, solo_seconds bigint, duo_seconds bigint, solo_rounds bigint, duo_rounds bigint, sessions jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if month_start is null or month_start <> pg_catalog.date_trunc('month', month_start)::date then
    raise exception 'Expected first day of month' using errcode = '22023';
  end if;
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = tz) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;
  return query
    select (s.ended_at at time zone tz)::date,
      coalesce(sum(s.actual_focus) filter (where other.user_id is null), 0)::bigint,
      coalesce(sum(s.actual_focus) filter (where other.user_id is not null), 0)::bigint,
      count(*) filter (where other.user_id is null), count(*) filter (where other.user_id is not null),
      jsonb_agg(jsonb_build_object('id', s.id, 'focus_seconds', s.actual_focus, 'world', s.world,
        'ended_at', s.ended_at, 'is_duo', other.user_id is not null,
        'partner_name', coalesce(p.display_name, p.username, 'Partner'),
        'private_tag', ft.tag, 'private_tag_version', ft.version) order by s.ended_at desc, s.id)
    from public.session_participants mine
    join public.sessions s on s.id = mine.session_id and s.completed
    left join lateral (
      select sp.user_id from public.session_participants sp
      where sp.session_id = s.id and sp.user_id <> caller order by sp.user_id limit 1
    ) other on true
    left join public.profiles p on p.id = other.user_id
    left join public.session_focus_tags ft on ft.session_id = s.id and ft.user_id = caller
    where mine.user_id = caller
      and s.ended_at >= (month_start::timestamp at time zone tz)
      and s.ended_at < ((month_start + interval '1 month')::timestamp at time zone tz)
    group by (s.ended_at at time zone tz)::date order by 1;
end $$;
