-- One recurring goal per accepted friendship. Accepting explicitly shares daily
-- aggregates, never session history. Unfriending/account deletion removes it.
CREATE TABLE public.shared_daily_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  friendship_id uuid NOT NULL UNIQUE REFERENCES public.friendships(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_minutes integer NOT NULL CHECK (target_minutes IN (25,30,50,60,90,120,180,240)),
  timezone text NOT NULL,
  accepted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shared_daily_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_daily_goals FROM anon, authenticated;
GRANT SELECT, DELETE ON public.shared_daily_goals TO authenticated;
GRANT ALL ON public.shared_daily_goals TO service_role;
CREATE POLICY shared_daily_goals_read ON public.shared_daily_goals
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.friendships f WHERE f.id = friendship_id
    AND f.status = 'accepted' AND auth.uid() IN (f.requester_id, f.addressee_id)
));
CREATE POLICY shared_daily_goals_delete ON public.shared_daily_goals
FOR DELETE TO authenticated USING (EXISTS (
  SELECT 1 FROM public.friendships f WHERE f.id = friendship_id
    AND auth.uid() IN (f.requester_id, f.addressee_id)
));
ALTER PUBLICATION supabase_realtime ADD TABLE public.shared_daily_goals;

CREATE FUNCTION public.create_shared_daily_goal(friend_id uuid, minutes integer, tz text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid(); friendship uuid; result uuid;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = tz) THEN
    RAISE EXCEPTION 'Invalid timezone';
  END IF;
  -- Hold the friendship until commit, so deleting it cannot race goal creation.
  SELECT f.id INTO friendship FROM public.friendships f
    WHERE f.status = 'accepted' AND
      ((f.requester_id = caller AND f.addressee_id = friend_id) OR
       (f.addressee_id = caller AND f.requester_id = friend_id)) FOR SHARE;
  IF friendship IS NULL THEN RAISE EXCEPTION 'Accepted friendship required'; END IF;
  INSERT INTO public.shared_daily_goals(friendship_id, created_by, target_minutes, timezone)
    VALUES (friendship, caller, minutes, tz) RETURNING id INTO result;
  RETURN result;
END $$;

CREATE FUNCTION public.accept_shared_daily_goal(goal_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  UPDATE public.shared_daily_goals g SET accepted = true
    FROM public.friendships f WHERE g.id = goal_id AND f.id = g.friendship_id
      AND f.status = 'accepted' AND auth.uid() IN (f.requester_id, f.addressee_id)
      AND auth.uid() <> g.created_by RETURNING g.id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Goal invitation unavailable'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.update_shared_daily_goal(goal_id uuid, minutes integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  UPDATE public.shared_daily_goals g SET target_minutes = minutes
    FROM public.friendships f WHERE g.id = goal_id AND f.id = g.friendship_id
      AND f.status = 'accepted' AND auth.uid() IN (f.requester_id, f.addressee_id)
      AND g.accepted RETURNING g.id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Accepted goal unavailable'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.get_shared_daily_goals()
RETURNS TABLE (
  id uuid, partner_id uuid, partner_name text, created_by uuid,
  target_minutes integer, timezone text, accepted boolean, day date,
  resets_at timestamptz, my_seconds bigint, partner_seconds bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY
  SELECT g.id, p.id, coalesce(p.display_name, p.username, 'Friend'), g.created_by,
    g.target_minutes, g.timezone, g.accepted, d.today,
    (d.today + 1)::timestamp AT TIME ZONE g.timezone,
    CASE WHEN g.accepted THEN coalesce(t.mine, 0) END,
    CASE WHEN g.accepted THEN coalesce(t.theirs, 0) END
  FROM public.shared_daily_goals g
  JOIN public.friendships f ON f.id = g.friendship_id AND f.status = 'accepted'
    AND caller IN (f.requester_id, f.addressee_id)
  JOIN public.profiles p ON p.id = CASE WHEN f.requester_id = caller THEN f.addressee_id ELSE f.requester_id END
  CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE g.timezone)::date AS today) d
  LEFT JOIN LATERAL (
    SELECT sum(s.actual_focus) FILTER (WHERE sp.user_id = caller)::bigint AS mine,
      sum(s.actual_focus) FILTER (WHERE sp.user_id = p.id)::bigint AS theirs
    FROM public.session_participants sp JOIN public.sessions s ON s.id = sp.session_id
    WHERE g.accepted AND sp.user_id IN (caller, p.id) AND s.completed
      AND s.ended_at >= d.today::timestamp AT TIME ZONE g.timezone
      AND s.ended_at < (d.today + 1)::timestamp AT TIME ZONE g.timezone
  ) t ON true
  ORDER BY g.created_at, g.id;
END $$;

REVOKE ALL ON FUNCTION public.create_shared_daily_goal(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_shared_daily_goal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_shared_daily_goal(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_shared_daily_goals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shared_daily_goal(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_shared_daily_goal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shared_daily_goal(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_daily_goals() TO authenticated;
