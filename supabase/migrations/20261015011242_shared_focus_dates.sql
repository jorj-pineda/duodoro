CREATE TABLE public.focus_dates (
  id uuid PRIMARY KEY,
  proposer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL CHECK (isfinite(starts_at)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  version bigint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (proposer_id <> recipient_id)
);
CREATE INDEX focus_dates_proposer_upcoming ON public.focus_dates(proposer_id, starts_at);
CREATE INDEX focus_dates_recipient_upcoming ON public.focus_dates(recipient_id, starts_at);
CREATE INDEX focus_dates_proposer_created ON public.focus_dates(proposer_id, created_at);
ALTER TABLE public.focus_dates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.focus_dates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.focus_dates TO authenticated;
GRANT ALL ON public.focus_dates TO service_role;
CREATE POLICY focus_dates_participants ON public.focus_dates FOR SELECT TO authenticated
  USING (proposer_id = (SELECT auth.uid()) OR recipient_id = (SELECT auth.uid()));

-- A caller-generated request ID makes retrying a lost creation response safe.
-- Terminal rows stay in place so neither retries nor old revisions revive them.
CREATE FUNCTION public.propose_focus_date(p_id uuid, p_recipient_id uuid, p_starts_at timestamptz)
RETURNS SETOF public.focus_dates LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := (SELECT auth.uid()); existing public.focus_dates; lock_id uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL OR p_recipient_id IS NULL OR p_recipient_id = caller OR p_starts_at IS NULL
    OR NOT pg_catalog.isfinite(p_starts_at) THEN
    RAISE EXCEPTION 'Invalid focus date' USING ERRCODE = '22023';
  END IF;
  -- Serialize both participants' limits, in a stable order across crossed invites.
  FOR lock_id IN SELECT x FROM unnest(ARRAY[caller,p_recipient_id]) x ORDER BY x LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('focus-date:' || lock_id::text, 0));
  END LOOP;
  SELECT * INTO existing FROM public.focus_dates WHERE id = p_id;
  IF FOUND THEN
    IF existing.proposer_id <> caller OR existing.recipient_id <> p_recipient_id OR existing.starts_at <> p_starts_at THEN
      RAISE EXCEPTION 'Focus date request changed' USING ERRCODE = 'PT409';
    END IF;
    RETURN NEXT existing; RETURN;
  END IF;
  IF p_starts_at <= pg_catalog.now() OR p_starts_at > pg_catalog.now() + interval '90 days' THEN
    RAISE EXCEPTION 'Choose a future time within 90 days' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.friendships f WHERE f.status = 'accepted' AND
    ((f.requester_id = caller AND f.addressee_id = p_recipient_id) OR (f.addressee_id = caller AND f.requester_id = p_recipient_id))) THEN
    RAISE EXCEPTION 'Friend unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM public.focus_dates WHERE proposer_id = caller AND created_at > pg_catalog.now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'Daily proposal limit reached. Try tomorrow.' USING ERRCODE = 'PT429';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[caller,p_recipient_id]) u WHERE
    (SELECT count(*) FROM public.focus_dates d WHERE (d.proposer_id = u OR d.recipient_id = u)
      AND d.status IN ('pending','accepted') AND d.starts_at > pg_catalog.now()) >= 10) THEN
    RAISE EXCEPTION 'Upcoming date limit reached' USING ERRCODE = 'PT429';
  END IF;
  RETURN QUERY INSERT INTO public.focus_dates (id,proposer_id,recipient_id,starts_at)
    VALUES (p_id,caller,p_recipient_id,p_starts_at) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.propose_focus_date(uuid,uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_focus_date(uuid,uuid,timestamptz) TO authenticated;

CREATE FUNCTION public.respond_focus_date(p_id uuid, p_expected_version bigint, p_status text)
RETURNS SETOF public.focus_dates LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := (SELECT auth.uid()); current_date_row public.focus_dates;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 OR p_expected_version >= 9007199254740991
    OR p_status IS NULL OR p_status NOT IN ('accepted','declined','cancelled') THEN
    RAISE EXCEPTION 'Invalid focus date response' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO current_date_row FROM public.focus_dates WHERE id = p_id AND
    (proposer_id = caller OR recipient_id = caller) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Focus date unavailable' USING ERRCODE = 'P0002'; END IF;
  IF current_date_row.version <> p_expected_version OR current_date_row.status NOT IN ('pending','accepted') THEN
    RAISE EXCEPTION 'Focus date changed elsewhere' USING ERRCODE = 'PT409';
  END IF;
  IF p_status <> 'cancelled' THEN
    IF caller <> current_date_row.recipient_id OR current_date_row.status <> 'pending' OR current_date_row.starts_at <= pg_catalog.now() THEN
      RAISE EXCEPTION 'Focus date response unavailable' USING ERRCODE = 'PT409';
    END IF;
    IF p_status = 'accepted' AND NOT EXISTS (SELECT 1 FROM public.friendships f WHERE f.status = 'accepted' AND
      ((f.requester_id = caller AND f.addressee_id = current_date_row.proposer_id) OR
       (f.addressee_id = caller AND f.requester_id = current_date_row.proposer_id))) THEN
      RAISE EXCEPTION 'Friend unavailable' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN QUERY UPDATE public.focus_dates SET status = p_status, version = version + 1
    WHERE id = p_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.respond_focus_date(uuid,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_focus_date(uuid,bigint,text) TO authenticated;
