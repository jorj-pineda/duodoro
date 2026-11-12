-- Keep the agreed instant until the other participant accepts a replacement.
ALTER TABLE public.focus_dates
  ADD COLUMN proposed_starts_at timestamptz,
  ADD COLUMN reschedule_by uuid,
  ADD CONSTRAINT focus_date_replacement_valid CHECK (
    (proposed_starts_at IS NULL AND reschedule_by IS NULL) OR
    (proposed_starts_at IS NOT NULL AND reschedule_by IS NOT NULL
      AND isfinite(proposed_starts_at) AND reschedule_by IN (proposer_id, recipient_id))
  );

CREATE FUNCTION public.reschedule_focus_date(p_id uuid, p_expected_version bigint, p_action text, p_starts_at timestamptz DEFAULT NULL)
RETURNS SETOF public.focus_dates LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := (SELECT auth.uid()); d public.focus_dates;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 OR p_expected_version >= 9007199254740991
    OR p_action IS NULL OR p_action NOT IN ('propose','accept','decline','withdraw') THEN
    RAISE EXCEPTION 'Invalid reschedule request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM public.focus_dates WHERE id = p_id AND caller IN (proposer_id,recipient_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Focus date unavailable' USING ERRCODE = 'P0002'; END IF;
  IF d.version <> p_expected_version OR d.status <> 'accepted' OR d.starts_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'Focus date changed elsewhere' USING ERRCODE = 'PT409';
  END IF;
  IF p_action IN ('propose','accept') AND NOT EXISTS (
    SELECT 1 FROM public.friendships f WHERE f.status = 'accepted' AND
      ((f.requester_id = d.proposer_id AND f.addressee_id = d.recipient_id) OR
       (f.requester_id = d.recipient_id AND f.addressee_id = d.proposer_id))
  ) THEN RAISE EXCEPTION 'Friend unavailable' USING ERRCODE = 'P0002'; END IF;
  IF p_action = 'propose' THEN
    IF d.proposed_starts_at IS NOT NULL THEN RAISE EXCEPTION 'Focus date changed elsewhere' USING ERRCODE = 'PT409'; END IF;
    IF p_starts_at IS NULL OR NOT pg_catalog.isfinite(p_starts_at) OR p_starts_at <= pg_catalog.now()
      OR p_starts_at > pg_catalog.now() + interval '90 days' OR p_starts_at = d.starts_at THEN
      RAISE EXCEPTION 'Choose a different future time within 90 days' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY UPDATE public.focus_dates SET proposed_starts_at = p_starts_at, reschedule_by = caller, version = version + 1
      WHERE id = p_id RETURNING *;
  ELSE
    IF d.proposed_starts_at IS NULL OR (p_action = 'withdraw' AND caller <> d.reschedule_by)
      OR (p_action IN ('accept','decline') AND caller = d.reschedule_by) THEN
      RAISE EXCEPTION 'Focus date changed elsewhere' USING ERRCODE = 'PT409';
    END IF;
    IF p_action = 'accept' AND (d.proposed_starts_at <= pg_catalog.now() OR d.proposed_starts_at > pg_catalog.now() + interval '90 days') THEN
      RAISE EXCEPTION 'Choose a different future time within 90 days' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY UPDATE public.focus_dates SET
      starts_at = CASE WHEN p_action = 'accept' THEN proposed_starts_at ELSE starts_at END,
      proposed_starts_at = NULL, reschedule_by = NULL, version = version + 1 WHERE id = p_id RETURNING *;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.reschedule_focus_date(uuid,bigint,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_focus_date(uuid,bigint,text,timestamptz) TO authenticated;
