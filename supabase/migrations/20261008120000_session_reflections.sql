-- ─────────────────────────────────────────────────────────────────────────────
-- Private session reflections
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One optional plain-text note per participant per saved, completed focus
-- session. Notes are readable only by their author. Partners, friends and
-- other accounts get no access, and the notes feed no totals, goals, streaks,
-- milestones or companion growth.
--
-- Writes go only through the narrow RPCs below. Each one derives the owner
-- from auth.uid(), requires a completed session the caller participated in,
-- and checks an expected version so a stale tab cannot overwrite a newer note.

CREATE TABLE public.session_reflections (
  session_id     uuid NOT NULL,
  user_id        uuid NOT NULL,
  reflection_text text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, user_id),
  -- Deleting a session, a participant link, or an account removes the note.
  CONSTRAINT session_reflections_participant_fk
    FOREIGN KEY (session_id, user_id)
    REFERENCES public.session_participants (session_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT session_reflections_version_positive CHECK (version > 0),
  -- Stored text is already normalized by the client: LF line endings, no
  -- leading or trailing whitespace, at least one non-whitespace character,
  -- at most 500 code points, and no control characters other than tab and
  -- newline. The whitespace class below mirrors JavaScript's \s exactly.
  CONSTRAINT session_reflections_text_valid CHECK (
    char_length(reflection_text) <= 500
    AND reflection_text ~ '^[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff](.*[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff])?$'
    AND reflection_text !~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f\r]'
  )
);

ALTER TABLE public.session_reflections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_reflections FROM anon, authenticated;
GRANT SELECT ON public.session_reflections TO authenticated;
GRANT ALL ON public.session_reflections TO service_role;

-- Own rows only, and only for sessions the caller still participates in.
-- is_session_participant() is SECURITY DEFINER, so this policy does not
-- reference its own table.
CREATE POLICY session_reflections_read_own ON public.session_reflections
FOR SELECT TO authenticated USING (
  user_id = (SELECT auth.uid())
  AND public.is_session_participant(session_id)
);

-- Shared validation for the write RPCs. Errors use 22023 with fixed messages
-- so the client can show the same guidance it shows for local validation.
CREATE FUNCTION public.check_session_reflection_text(p_text text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF p_text IS NULL OR p_text !~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' THEN
    RAISE EXCEPTION 'Reflection cannot be blank' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(p_text) > 500 THEN
    RAISE EXCEPTION 'Reflection must be 500 characters or fewer' USING ERRCODE = '22023';
  END IF;
  IF p_text ~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f\r]' THEN
    RAISE EXCEPTION 'Reflection must be plain text with line feed line endings' USING ERRCODE = '22023';
  END IF;
  IF p_text ~ '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
     OR p_text ~ '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$' THEN
    RAISE EXCEPTION 'Reflection must not start or end with whitespace' USING ERRCODE = '22023';
  END IF;
END $$;

-- Completed sessions the caller participated in. Every other case (missing,
-- not completed, not a participant) returns the same error, so callers cannot
-- probe for other people's sessions.
CREATE FUNCTION public.assert_reflection_session_eligible(p_session_id uuid)
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
    RAISE EXCEPTION 'Session reflection unavailable' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE FUNCTION public.create_session_reflection(p_session_id uuid, p_text text)
RETURNS TABLE (session_id uuid, user_id uuid, reflection_text text, created_at timestamptz, updated_at timestamptz, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  PERFORM public.check_session_reflection_text(p_text);
  PERFORM public.assert_reflection_session_eligible(p_session_id);
  -- Creation never replaces an existing note. A stale client that believes
  -- none exists gets a conflict instead of an overwrite.
  RETURN QUERY
    INSERT INTO public.session_reflections AS r (session_id, user_id, reflection_text)
    VALUES (p_session_id, caller, p_text)
    ON CONFLICT ON CONSTRAINT session_reflections_pkey DO NOTHING
    RETURNING r.session_id, r.user_id, r.reflection_text, r.created_at, r.updated_at, r.version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reflection already exists' USING ERRCODE = '23505';
  END IF;
END $$;

CREATE FUNCTION public.update_session_reflection(p_session_id uuid, p_text text, p_expected_version bigint)
RETURNS TABLE (session_id uuid, user_id uuid, reflection_text text, created_at timestamptz, updated_at timestamptz, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  PERFORM public.check_session_reflection_text(p_text);
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Expected version is required' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_reflection_session_eligible(p_session_id);
  RETURN QUERY
    UPDATE public.session_reflections AS r
       SET reflection_text = p_text,
           updated_at = pg_catalog.now(),
           version = r.version + 1
     WHERE r.session_id = p_session_id
       AND r.user_id = caller
       AND r.version = p_expected_version
    RETURNING r.session_id, r.user_id, r.reflection_text, r.created_at, r.updated_at, r.version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reflection changed elsewhere' USING ERRCODE = '40001';
  END IF;
END $$;

CREATE FUNCTION public.delete_session_reflection(p_session_id uuid, p_expected_version bigint)
RETURNS TABLE (session_id uuid, user_id uuid, deleted_version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Expected version is required' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_reflection_session_eligible(p_session_id);
  RETURN QUERY
    DELETE FROM public.session_reflections AS r
     WHERE r.session_id = p_session_id
       AND r.user_id = caller
       AND r.version = p_expected_version
    RETURNING r.session_id, r.user_id, r.version;
  IF NOT FOUND THEN
    -- A zero-row delete is a conflict, never silent success.
    RAISE EXCEPTION 'Reflection changed elsewhere' USING ERRCODE = '40001';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.check_session_reflection_text(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_reflection_session_eligible(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_session_reflection(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_session_reflection(uuid, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_session_reflection(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_session_reflection(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_session_reflection(uuid, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_session_reflection(uuid, bigint) TO authenticated;
