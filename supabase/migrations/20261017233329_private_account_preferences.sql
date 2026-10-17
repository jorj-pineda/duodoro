CREATE FUNCTION public.valid_account_preference(p_key text, p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE item jsonb; label text; names text[] := ARRAY[]::text[];
BEGIN
  IF p_key IS NULL OR p_value IS NULL THEN RETURN false; END IF;
  IF p_key = 'pet' THEN RETURN p_value = 'null'::jsonb OR (jsonb_typeof(p_value) = 'string' AND p_value #>> '{}' IN ('cat','dog','dragon','rabbit')); END IF;
  IF p_key IN ('name_cat','name_dog','name_dragon','name_rabbit') THEN
    IF p_value = 'null'::jsonb THEN RETURN true; END IF;
    IF jsonb_typeof(p_value) <> 'string' THEN RETURN false; END IF;
    label := p_value #>> '{}';
    RETURN char_length(label) BETWEEN 1 AND 24 AND label = btrim(label) AND label !~ '[[:cntrl:]]'
      AND label !~ U&'[\202A-\202E\2066-\2069]' AND label !~ '\s{2}' AND label !~ U&'[\00A0\1680\2000-\200A\2028-\2029\202F\205F\3000\FEFF]';
  END IF;
  IF p_key = 'quiet_focus' THEN RETURN jsonb_typeof(p_value) = 'boolean'; END IF;
  IF p_key = 'daily_goal' THEN RETURN jsonb_typeof(p_value) = 'number' AND p_value IN ('25','30','50','60','90','120','180','240'); END IF;
  IF p_key <> 'presets' OR jsonb_typeof(p_value) <> 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p_value) > 5 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(item) <> 'object' THEN RETURN false; END IF;
    IF NOT (item ?& ARRAY['name','mode','focus','break']) OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 4 OR jsonb_typeof(item->'name') <> 'string'
      OR jsonb_typeof(item->'mode') <> 'string' OR jsonb_typeof(item->'focus') <> 'number' OR jsonb_typeof(item->'break') <> 'number' THEN RETURN false; END IF;
    label := item->>'name';
    IF char_length(label) NOT BETWEEN 1 AND 24 OR label <> btrim(label)
      OR (SELECT sum(CASE WHEN ascii(ch) > 65535 THEN 2 ELSE 1 END) FROM regexp_split_to_table(label,'') ch) > 24
      OR lower(label) = ANY(names) OR item->>'mode' NOT IN ('pomodoro','flow')
      OR (item->>'focus')::numeric NOT BETWEEN 5 AND 120 OR (item->>'focus')::numeric % 5 <> 0
      OR (item->>'break')::numeric NOT BETWEEN 1 AND 30 OR (item->>'break')::numeric % 1 <> 0 THEN RETURN false; END IF;
    names := array_append(names, lower(label));
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.valid_account_preference(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valid_account_preference(text,jsonb) TO service_role;

CREATE TABLE public.account_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (user_id,key),
  CHECK (public.valid_account_preference(key,value))
);
ALTER TABLE public.account_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.account_preferences TO authenticated;
GRANT ALL ON public.account_preferences TO service_role;
CREATE POLICY account_preferences_read_own ON public.account_preferences FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Separate revisions prevent one setting from overwriting another device's
-- unrelated changes. Explicit null/empty/default values keep their rows.
CREATE FUNCTION public.set_account_preference(p_key text,p_value jsonb,p_expected_version bigint)
RETURNS SETOF public.account_preferences LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := (SELECT auth.uid()); payload jsonb := coalesce(p_value,'null'::jsonb);
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.valid_account_preference(p_key,payload) OR p_expected_version < 1 OR p_expected_version >= 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid preference' USING ERRCODE = '22023';
  END IF;
  IF p_expected_version IS NULL THEN
    RETURN QUERY INSERT INTO public.account_preferences AS p (user_id,key,value) VALUES (caller,p_key,payload)
      ON CONFLICT ON CONSTRAINT account_preferences_pkey DO NOTHING RETURNING p.*;
  ELSE
    RETURN QUERY UPDATE public.account_preferences AS p SET value=payload,version=p.version+1
      WHERE p.user_id=caller AND p.key=p_key AND p.version=p_expected_version RETURNING p.*;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preference changed elsewhere' USING ERRCODE = 'PT409'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_account_preference(text,jsonb,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_account_preference(text,jsonb,bigint) TO authenticated;
