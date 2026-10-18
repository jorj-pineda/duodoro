-- Normalize invalid legacy values without changing rename cooldowns.
UPDATE public.profiles SET display_name = nullif(left(btrim(display_name),50),'')
  WHERE display_name IS NOT NULL AND
    (char_length(display_name) > 50 OR display_name <> btrim(display_name) OR btrim(display_name) = '');
ALTER TABLE public.profiles ADD CONSTRAINT profiles_display_name_valid CHECK (
  display_name IS NULL OR (char_length(display_name) BETWEEN 1 AND 50 AND display_name = btrim(display_name))
);

-- Enforce the same cooldown for direct REST writes, old setup clients, and
-- the rename RPC. The row lock on UPDATE makes concurrent writes serialize.
CREATE FUNCTION public.guard_profile_display_name()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- OAuth metadata is untrusted too; never let a long provider name make
    -- profile creation fail inside handle_new_user's exception fallback.
    NEW.display_name := nullif(left(btrim(NEW.display_name),50),'');
    RETURN NEW;
  END IF;
  IF NEW.display_name IS NOT DISTINCT FROM OLD.display_name THEN RETURN NEW; END IF;
  IF OLD.display_name_changed_at IS NOT NULL AND OLD.display_name_changed_at + interval '7 days' > now() THEN
    RAISE EXCEPTION 'You can change your display name again on %',
      to_char(OLD.display_name_changed_at + interval '7 days','YYYY-MM-DD');
  END IF;
  NEW.display_name_changed_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_profile_display_name() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER profiles_display_name_guard BEFORE INSERT OR UPDATE OF display_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_display_name();

CREATE OR REPLACE FUNCTION public.change_display_name(new_name text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := (SELECT auth.uid()); current_profile public.profiles; clean text := btrim(new_name);
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF clean IS NULL OR char_length(clean) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Display name must be 1-50 characters' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO current_profile FROM public.profiles WHERE id=caller FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile unavailable' USING ERRCODE = 'P0002'; END IF;
  -- A retry after a lost response must not fail or restart the cooldown.
  IF current_profile.display_name IS DISTINCT FROM clean THEN
    UPDATE public.profiles SET display_name=clean WHERE id=caller RETURNING * INTO current_profile;
  END IF;
  RETURN json_build_object('display_name',current_profile.display_name,'display_name_changed_at',current_profile.display_name_changed_at);
END $$;
REVOKE ALL ON FUNCTION public.change_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_display_name(text) TO authenticated, service_role;
