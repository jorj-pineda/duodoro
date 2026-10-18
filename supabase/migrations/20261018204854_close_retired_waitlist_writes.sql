-- This legacy collection endpoint is retired. Keep its data and the trusted
-- account-deletion service's access without exposing a public write surface.
DROP POLICY IF EXISTS waitlist_insert ON public.waitlist;
REVOKE ALL ON TABLE public.waitlist FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.waitlist TO service_role;
