CREATE SEQUENCE public.weekly_focus_plan_revision_seq AS bigint
  MINVALUE 1 MAXVALUE 9007199254740991 NO CYCLE;
REVOKE ALL ON SEQUENCE public.weekly_focus_plan_revision_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.weekly_focus_plan_revision_seq TO service_role;

CREATE TABLE public.weekly_focus_plans (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  task_ids uuid[] NOT NULL DEFAULT '{}',
  version bigint NOT NULL DEFAULT pg_catalog.nextval('public.weekly_focus_plan_revision_seq'::regclass),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start),
  CHECK (cardinality(task_ids) <= 3 AND coalesce(array_ndims(task_ids), 1) = 1 AND array_position(task_ids, NULL) IS NULL),
  CHECK (version BETWEEN 1 AND 9007199254740991)
);
ALTER TABLE public.weekly_focus_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weekly_focus_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.weekly_focus_plans TO authenticated;
GRANT ALL ON public.weekly_focus_plans TO service_role;
CREATE POLICY weekly_focus_plans_read_own ON public.weekly_focus_plans
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- One complete replacement, never an optimistic local assignment. Clearing
-- keeps the row and advances its revision to prevent stale editors reviving it.
CREATE FUNCTION public.set_weekly_focus_plan(p_week_start date, p_task_ids uuid[], p_expected_version bigint)
RETURNS SETOF public.weekly_focus_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := (SELECT auth.uid());
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_week_start IS NULL OR extract(isodow FROM p_week_start) <> 1
     OR p_task_ids IS NULL OR cardinality(p_task_ids) > 3
     OR coalesce(array_ndims(p_task_ids), 1) <> 1 OR array_position(p_task_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid weekly plan' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version IS NOT NULL AND (p_expected_version < 1 OR p_expected_version > 9007199254740991) THEN
    RAISE EXCEPTION 'Invalid revision' USING ERRCODE = '22023';
  END IF;
  -- Count also rejects duplicate IDs. Room goals, shared goals, and another
  -- account's goals all produce the same error, without disclosing existence.
  IF (SELECT count(*) FROM public.tasks t WHERE t.id = ANY(p_task_ids)
        AND t.owner_id = caller AND t.room_code IS NULL AND NOT coalesce(t.is_shared, false)) <> cardinality(p_task_ids) THEN
    RAISE EXCEPTION 'Personal goal unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS NULL THEN
    RETURN QUERY INSERT INTO public.weekly_focus_plans AS p (user_id, week_start, task_ids)
      VALUES (caller, p_week_start, p_task_ids)
      ON CONFLICT ON CONSTRAINT weekly_focus_plans_pkey DO NOTHING RETURNING p.*;
  ELSE
    RETURN QUERY UPDATE public.weekly_focus_plans AS p SET task_ids = p_task_ids,
      version = pg_catalog.nextval('public.weekly_focus_plan_revision_seq'::regclass), updated_at = pg_catalog.now()
      WHERE p.user_id = caller AND p.week_start = p_week_start AND p.version = p_expected_version RETURNING p.*;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Weekly plan changed elsewhere' USING ERRCODE = 'PT409'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_weekly_focus_plan(date, uuid[], bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_weekly_focus_plan(date, uuid[], bigint) TO authenticated;
