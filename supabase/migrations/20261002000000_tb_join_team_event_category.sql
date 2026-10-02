-- La page joueur affiche le type d'événement (École, Entreprise, Anniversaire…)
-- dans son en-tête : tb_join_team renvoie donc aussi tb_events.category.
-- Le type de retour change : il faut recréer la fonction (DROP puis CREATE).
DROP FUNCTION IF EXISTS public.tb_join_team(uuid, text);

CREATE FUNCTION public.tb_join_team(p_event_id uuid, p_code text)
 RETURNS TABLE(team_id uuid, team_name text, team_number integer, event_name text, event_status text, event_theme text, event_video_url text, event_video_enabled boolean, event_category text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT t.id, t.name, t.number, e.name, e.status, e.theme, e.video_url, e.video_enabled, e.category
  FROM tb_teams t
  JOIN tb_events e ON e.id = t.event_id
  WHERE t.event_id = p_event_id
    AND upper(t.access_code) = upper(p_code);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Code équipe invalide';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tb_join_team(uuid, text) TO anon, authenticated;
