-- Pending requests reveal public identity through an explicit projection,
-- never the live presence columns in profiles.
DROP POLICY profiles_read_known ON public.profiles;
CREATE POLICY profiles_read_known ON public.profiles FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid()) OR EXISTS (
      SELECT 1 FROM public.friendships f WHERE f.status = 'accepted' AND
        ((f.requester_id = (SELECT auth.uid()) AND f.addressee_id = profiles.id) OR
         (f.addressee_id = (SELECT auth.uid()) AND f.requester_id = profiles.id))
    )
  );

CREATE FUNCTION public.get_friend_requests()
RETURNS TABLE (id uuid, requester_id uuid, username text, discriminator text, display_name text, is_premium boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT f.id, p.id, p.username, p.discriminator, p.display_name, coalesce(p.is_premium,false)
    FROM public.friendships f JOIN public.profiles p ON p.id = f.requester_id
    WHERE f.addressee_id = (SELECT auth.uid()) AND f.status = 'pending'
    ORDER BY f.created_at, f.id;
END $$;
REVOKE ALL ON FUNCTION public.get_friend_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_friend_requests() TO authenticated;
