-- Revisions are opaque optimistic-concurrency tokens, never reused after deletion.
-- Bound them to the largest integer JavaScript can represent exactly.
CREATE SEQUENCE public.session_reflection_revision_seq AS bigint
  MINVALUE 1 MAXVALUE 9007199254740991 NO CYCLE;
REVOKE ALL ON SEQUENCE public.session_reflection_revision_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.session_reflection_revision_seq TO service_role;
SELECT pg_catalog.setval('public.session_reflection_revision_seq'::regclass,
  GREATEST(COALESCE((SELECT MAX(version) FROM public.session_reflections), 0) + 1, 1), false);
ALTER TABLE public.session_reflections ALTER COLUMN version
  SET DEFAULT pg_catalog.nextval('public.session_reflection_revision_seq'::regclass);

CREATE OR REPLACE FUNCTION public.update_session_reflection(p_session_id uuid, p_text text, p_expected_version bigint)
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
           version = pg_catalog.nextval('public.session_reflection_revision_seq'::regclass)
     WHERE r.session_id = p_session_id
       AND r.user_id = caller
       AND r.version = p_expected_version
    RETURNING r.session_id, r.user_id, r.reflection_text, r.created_at, r.updated_at, r.version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reflection changed elsewhere' USING ERRCODE = 'PT409';
  END IF;
END $$;

-- Optimistic conflicts are HTTP 409, not retryable serialization failures.
CREATE OR REPLACE FUNCTION public.delete_session_reflection(p_session_id uuid, p_expected_version bigint)
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
    RAISE EXCEPTION 'Reflection changed elsewhere' USING ERRCODE = 'PT409';
  END IF;
END $$;

