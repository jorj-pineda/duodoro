-- A request is not consent. Only the named recipient may accept a pending
-- request; neither an INSERT nor a later status rewrite may forge acceptance.
DROP POLICY friendships_insert ON public.friendships;
CREATE POLICY friendships_insert ON public.friendships FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = (SELECT auth.uid())
    AND addressee_id <> (SELECT auth.uid())
    AND status = 'pending'
  );

DROP POLICY friendships_accept ON public.friendships;
CREATE POLICY friendships_accept ON public.friendships FOR UPDATE TO authenticated
  USING (addressee_id = (SELECT auth.uid()) AND status = 'pending')
  WITH CHECK (addressee_id = (SELECT auth.uid()) AND status = 'accepted');
