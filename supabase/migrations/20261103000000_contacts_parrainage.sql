-- ============================================================
-- Module Contacts + parrainage des joueurs
-- ------------------------------------------------------------
-- 1. Contacts : liste unifiée (admin) des abonnés — comptes joueurs
--    créés sur enigma.ci — et des personnes ayant réservé sur le site,
--    dédoublonnés par e-mail (sinon par téléphone).
--    contact_optouts : adresses désinscrites des envois (lien en pied
--    de chaque e-mail) ; elles ne reçoivent plus rien.
--    contact_messages / contact_message_recipients : historique des
--    e-mails et messages WhatsApp envoyés depuis le module.
-- 2. Parrainage : chaque joueur partage un lien / QR code portant son
--    code joueur. Un nouvel inscrit via ce lien devient son filleul.
--    Le filleul est « validé » à sa première partie (première clé
--    enregistrée à l'accueil) — ou dès l'inscription selon le réglage.
--    Chaque filleul validé rapporte des points au parrain ; à chaque
--    seuil atteint, un coupon cadeau (table vouchers) est créé pour lui.
--    Réglages dans site_settings, clé « parrainage ».
-- Rien n'est modifié dans les données existantes.
-- ============================================================

-- ── Réglages du parrainage (modifiables dans Admin › Contacts) ──
INSERT INTO public.site_settings (key, value, updated_at, updated_by)
VALUES ('parrainage', jsonb_build_object(
  'enabled', true,
  'points_par_filleul', 1,
  'seuil_points', 5,
  'coupon_montant_xof', 15000,
  'coupon_validite_jours', 90,
  'validation', 'premiere_partie'   -- ou 'inscription'
), now(), 'migration')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.referral_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', true, 'points_par_filleul', 1, 'seuil_points', 5,
    'coupon_montant_xof', 15000, 'coupon_validite_jours', 90, 'validation', 'premiere_partie'
  ) || coalesce((SELECT value FROM public.site_settings WHERE key = 'parrainage'), '{}'::jsonb);
$$;

-- ── Tables du parrainage ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referrals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  referee_id   uuid NOT NULL UNIQUE REFERENCES public.players(id) ON DELETE CASCADE,
  code_used    text,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'rejected')),
  points       integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  note         text,
  CHECK (referrer_id <> referee_id)
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id);

CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  voucher_id  uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  points_used integer NOT NULL CHECK (points_used > 0),
  amount_xof  integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_rewards_referrer_idx ON public.referral_rewards (referrer_id);

-- ── Tables des contacts ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_optouts (
  email      text PRIMARY KEY,           -- toujours en minuscules
  source     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  subject          text,
  body             text NOT NULL,
  recipients_count integer NOT NULL DEFAULT 0,
  sent_count       integer NOT NULL DEFAULT 0,
  failed_count     integer NOT NULL DEFAULT 0,
  skipped_count    integer NOT NULL DEFAULT 0,
  sent_by          text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_message_recipients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES public.contact_messages(id) ON DELETE CASCADE,
  name        text,
  email       text,
  phone       text,
  status      text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error       text,
  provider_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_message_recipients_msg_idx ON public.contact_message_recipients (message_id);

-- ── Accès ───────────────────────────────────────────────────
ALTER TABLE public.referrals                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_optouts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_message_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY referrals_admin ON public.referrals FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY referrals_own_read ON public.referrals FOR SELECT TO authenticated USING (referrer_id = auth.uid());
CREATE POLICY referral_rewards_admin ON public.referral_rewards FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY referral_rewards_own_read ON public.referral_rewards FOR SELECT TO authenticated USING (referrer_id = auth.uid());
CREATE POLICY contact_optouts_admin ON public.contact_optouts FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY contact_messages_admin ON public.contact_messages FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY contact_message_recipients_admin ON public.contact_message_recipients FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.referrals, public.referral_rewards, public.contact_optouts,
              public.contact_messages, public.contact_message_recipients FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.referrals, public.referral_rewards, public.contact_optouts,
              public.contact_messages, public.contact_message_recipients TO authenticated;

-- ── Attribution des coupons ─────────────────────────────────
-- Solde de points = points des filleuls validés − points déjà convertis.
-- Tant que le solde atteint le seuil, un coupon est créé.
CREATE OR REPLACE FUNCTION public.referral_award(p_referrer uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.referral_settings();
  seuil int := greatest(1, coalesce((s->>'seuil_points')::int, 5));
  montant int := greatest(0, coalesce((s->>'coupon_montant_xof')::int, 0));
  validite int := coalesce((s->>'coupon_validite_jours')::int, 0);
  solde int;
  created int := 0;
  v_code text;
  v_id uuid;
  v_name text;
BEGIN
  IF montant <= 0 THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('referral_award:' || p_referrer::text));
  SELECT display_name INTO v_name FROM public.players WHERE id = p_referrer;
  LOOP
    SELECT coalesce((SELECT sum(points) FROM public.referrals WHERE referrer_id = p_referrer AND status = 'validated'), 0)
         - coalesce((SELECT sum(points_used) FROM public.referral_rewards WHERE referrer_id = p_referrer), 0)
      INTO solde;
    EXIT WHEN solde < seuil;
    LOOP
      v_code := 'PAR-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4)) || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.vouchers WHERE code = v_code);
    END LOOP;
    INSERT INTO public.vouchers (code, type, initial_amount_xof, remaining_amount_xof, is_active, sold_by, notes,
                                 valid_from, valid_until, max_uses, used_count)
    VALUES (v_code, 'amount', montant, montant, true, 'parrainage',
            'Coupon parrainage — ' || coalesce(v_name, 'joueur'),
            current_date, CASE WHEN validite > 0 THEN current_date + validite END, 1, 0)
    RETURNING id INTO v_id;
    INSERT INTO public.referral_rewards (referrer_id, voucher_id, points_used, amount_xof)
    VALUES (p_referrer, v_id, seuil, montant);
    created := created + 1;
  END LOOP;
  RETURN created;
END $$;

-- Valide le parrainage en attente d'un filleul et attribue les coupons.
CREATE OR REPLACE FUNCTION public.referral_validate(p_referee uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.referral_settings();
  r record;
BEGIN
  IF NOT coalesce((s->>'enabled')::boolean, true) THEN RETURN; END IF;
  UPDATE public.referrals
     SET status = 'validated', validated_at = now(),
         points = greatest(0, coalesce((s->>'points_par_filleul')::int, 1))
   WHERE referee_id = p_referee AND status = 'pending'
  RETURNING referrer_id INTO r;
  IF FOUND THEN PERFORM public.referral_award(r.referrer_id); END IF;
END $$;

REVOKE ALL ON FUNCTION public.referral_award(uuid), public.referral_validate(uuid) FROM PUBLIC, anon, authenticated;

-- ── Inscription : rattacher le filleul à son parrain ─────────
-- Reprend handle_new_player à l'identique et ajoute le parrainage
-- (code « parrain » transmis par le formulaire d'inscription).
-- Le parrainage ne doit jamais faire échouer une inscription.
CREATE OR REPLACE FUNCTION public.handle_new_player()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
  v_referrer uuid;
begin
  if coalesce(new.raw_app_meta_data->>'role','') in ('admin','staff','sync') then return new; end if;

  insert into public.players(id, display_name, phone, player_code)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)), new.raw_user_meta_data->>'phone',
          'ENG-' || upper(substr(md5(new.id::text),1,4)))
  on conflict (id) do nothing;

  -- Fixe explicitement le role='user' dans app_metadata pour ce compte "joueur" (site public).
  -- Empeche tout code cote client qui utiliserait un defaut fallback ('staff') a tort
  -- de traiter un simple visiteur inscrit comme un membre du staff.
  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role','user')
  where id = new.id
    and coalesce(raw_app_meta_data->>'role','') = '';

  -- Parrainage
  begin
    v_code := upper(trim(coalesce(new.raw_user_meta_data->>'parrain', '')));
    if v_code <> '' and coalesce((public.referral_settings()->>'enabled')::boolean, true) then
      select id into v_referrer from public.players where upper(player_code) = v_code and id <> new.id;
      if v_referrer is not null and exists (select 1 from public.players where id = new.id) then
        insert into public.referrals(referrer_id, referee_id, code_used)
        values (v_referrer, new.id, v_code)
        on conflict (referee_id) do nothing;
        if public.referral_settings()->>'validation' = 'inscription' then
          perform public.referral_validate(new.id);
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'parrainage ignoré pour %: %', new.id, sqlerrm;
  end;

  return new;
end $function$;

-- ── Première partie : valider le filleul ─────────────────────
CREATE OR REPLACE FUNCTION public.referral_on_key_find()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.player_id IS NOT NULL AND public.referral_settings()->>'validation' = 'premiere_partie' THEN
    BEGIN
      PERFORM public.referral_validate(NEW.player_id);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'parrainage ignoré pour %: %', NEW.player_id, sqlerrm;
    END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.referral_on_key_find() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_referral_on_key_find ON public.key_finds;
CREATE TRIGGER trg_referral_on_key_find AFTER INSERT ON public.key_finds
  FOR EACH ROW EXECUTE FUNCTION public.referral_on_key_find();

-- ── Espace joueur : résumé de son parrainage ─────────────────
CREATE OR REPLACE FUNCTION public.my_referral_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  s jsonb := public.referral_settings();
  p record;
  pts_total int; pts_used int;
BEGIN
  IF uid IS NULL THEN RETURN NULL; END IF;
  SELECT id, player_code, display_name INTO p FROM public.players WHERE id = uid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(sum(points), 0) INTO pts_total FROM public.referrals WHERE referrer_id = uid AND status = 'validated';
  SELECT coalesce(sum(points_used), 0) INTO pts_used FROM public.referral_rewards WHERE referrer_id = uid;
  RETURN jsonb_build_object(
    'code', p.player_code,
    'enabled', coalesce((s->>'enabled')::boolean, true),
    'points_par_filleul', (s->>'points_par_filleul')::int,
    'seuil_points', (s->>'seuil_points')::int,
    'coupon_montant_xof', (s->>'coupon_montant_xof')::int,
    'coupon_validite_jours', (s->>'coupon_validite_jours')::int,
    'validation', s->>'validation',
    'points_total', pts_total,
    'points_solde', pts_total - pts_used,
    'filleuls', coalesce((SELECT jsonb_agg(jsonb_build_object('nom', f.display_name, 'statut', r.status, 'date', r.created_at::date) ORDER BY r.created_at DESC)
                            FROM public.referrals r JOIN public.players f ON f.id = r.referee_id WHERE r.referrer_id = uid), '[]'::jsonb),
    'coupons', coalesce((SELECT jsonb_agg(jsonb_build_object('code', v.code, 'montant', v.initial_amount_xof, 'restant', v.remaining_amount_xof,
                                                             'valide_jusqu_au', v.valid_until, 'actif', v.is_active, 'date', w.created_at::date) ORDER BY w.created_at DESC)
                            FROM public.referral_rewards w LEFT JOIN public.vouchers v ON v.id = w.voucher_id WHERE w.referrer_id = uid), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.my_referral_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_summary() TO authenticated;

-- ── Admin : valider / refuser un filleul à la main ───────────
CREATE OR REPLACE FUNCTION public.admin_referral_set_status(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'réservé aux administrateurs'; END IF;
  IF p_status NOT IN ('validated', 'rejected') THEN RAISE EXCEPTION 'statut invalide'; END IF;
  SELECT * INTO r FROM public.referrals WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'parrainage introuvable'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'ce parrainage est déjà traité'; END IF;
  IF p_status = 'validated' THEN
    UPDATE public.referrals SET note = p_note WHERE id = p_id;
    -- validation manuelle même si le parrainage automatique est désactivé
    UPDATE public.referrals SET status = 'validated', validated_at = now(),
           points = greatest(0, coalesce((public.referral_settings()->>'points_par_filleul')::int, 1))
     WHERE id = p_id;
    PERFORM public.referral_award(r.referrer_id);
  ELSE
    UPDATE public.referrals SET status = 'rejected', note = p_note WHERE id = p_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_set_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_set_status(uuid, text, text) TO authenticated;

-- ── Admin : liste unifiée des contacts ───────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_contacts()
RETURNS TABLE (
  contact_key text, name text, email text, phone text,
  is_subscriber boolean, player_id uuid, player_code text, subscribed_at timestamptz,
  reservations integer, reservations_confirmed integer, last_reservation date, first_seen timestamptz,
  opted_out boolean, filleuls_valides integer, filleuls_en_attente integer, parrain_name text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'réservé aux administrateurs'; END IF;
  RETURN QUERY
  WITH pl AS (
    SELECT p.id, p.display_name, nullif(trim(p.phone), '') AS phone, nullif(lower(trim(u.email)), '') AS email,
           p.player_code, p.created_at
      FROM public.players p LEFT JOIN auth.users u ON u.id = p.id
  ),
  rr AS (
    SELECT r.*, nullif(lower(trim(r.client_email)), '') AS em,
           nullif(regexp_replace(coalesce(r.client_phone, ''), '\D', '', 'g'), '') AS ph
      FROM public.reservation_requests r
  ),
  keyed AS (
    SELECT coalesce(em, 'tel:' || ph) AS k, rr.* FROM rr WHERE coalesce(em, ph) IS NOT NULL
  ),
  resa AS (
    SELECT k,
           (array_agg(client_name ORDER BY created_at DESC))[1] AS name,
           (array_agg(em ORDER BY created_at DESC) FILTER (WHERE em IS NOT NULL))[1] AS email,
           (array_agg(client_phone ORDER BY created_at DESC) FILTER (WHERE ph IS NOT NULL))[1] AS phone,
           count(*)::int AS n,
           count(*) FILTER (WHERE status IN ('confirmed', 'deposit_received'))::int AS n_ok,
           max(session_date) AS last_date,
           min(created_at) AS first_at
      FROM keyed GROUP BY k
  ),
  plk AS (
    SELECT coalesce(pl.email, 'tel:' || nullif(regexp_replace(coalesce(pl.phone, ''), '\D', '', 'g'), ''), 'joueur:' || pl.id::text) AS k, pl.*
      FROM pl
  ),
  ref AS (
    SELECT referrer_id,
           count(*) FILTER (WHERE status = 'validated')::int AS ok,
           count(*) FILTER (WHERE status = 'pending')::int AS wait
      FROM public.referrals GROUP BY referrer_id
  )
  SELECT coalesce(plk.k, resa.k),
         coalesce(plk.display_name, resa.name),
         coalesce(plk.email, resa.email),
         coalesce(plk.phone, resa.phone),
         plk.id IS NOT NULL,
         plk.id, plk.player_code, plk.created_at,
         coalesce(resa.n, 0), coalesce(resa.n_ok, 0), resa.last_date,
         least(plk.created_at, resa.first_at),
         EXISTS (SELECT 1 FROM public.contact_optouts o WHERE o.email = coalesce(plk.email, resa.email)),
         coalesce(ref.ok, 0), coalesce(ref.wait, 0),
         (SELECT pp.display_name FROM public.referrals x JOIN public.players pp ON pp.id = x.referrer_id WHERE x.referee_id = plk.id)
    FROM plk FULL OUTER JOIN resa ON resa.k = plk.k
    LEFT JOIN ref ON ref.referrer_id = plk.id;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_contacts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_contacts() TO authenticated;
