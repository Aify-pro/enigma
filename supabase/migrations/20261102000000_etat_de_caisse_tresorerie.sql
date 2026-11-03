-- ============================================================
-- État de caisse réel : comptes de trésorerie, transferts,
-- pointage des lignes et contrôles (comptages) de caisse.
-- ------------------------------------------------------------
-- 1. caisse_regulations devient la table des « mouvements manuels »
--    de trésorerie : chaque mouvement est rattaché à un compte
--    (caisse, mobile_money, banque). S'il a un compte de contrepartie,
--    c'est un transfert entre deux comptes (ex. banque → caisse).
--    Les lignes existantes restent sur la caisse (valeur par défaut) :
--    aucun chiffre ne change à l'application de la migration.
-- 2. tresorerie_pointages : une ligne du journal est « pointée »
--    quand elle a été vérifiée (relevé bancaire, historique Wave,
--    comptage). La clé identifie l'écriture : table:id:compte:sens.
-- 3. tresorerie_controles : comptage réel d'un compte à une date,
--    comparé au solde théorique calculé par l'application.
-- Accès : réservé aux administrateurs, comme caisse_regulations.
-- ============================================================

ALTER TABLE public.caisse_regulations
  ADD COLUMN IF NOT EXISTS account         text NOT NULL DEFAULT 'caisse',
  ADD COLUMN IF NOT EXISTS counter_account text,
  ADD COLUMN IF NOT EXISTS reference       text;

ALTER TABLE public.caisse_regulations
  ADD CONSTRAINT caisse_regulations_account_check
    CHECK (account IN ('caisse', 'mobile_money', 'banque')),
  ADD CONSTRAINT caisse_regulations_counter_account_check
    CHECK (counter_account IS NULL
           OR (counter_account IN ('caisse', 'mobile_money', 'banque') AND counter_account <> account)),
  ADD CONSTRAINT caisse_regulations_direction_check
    CHECK (direction IN ('credit', 'debit')),
  ADD CONSTRAINT caisse_regulations_amount_check
    CHECK (amount_xof > 0);

COMMENT ON COLUMN public.caisse_regulations.account IS
  'Compte mouvementé : caisse, mobile_money ou banque. direction credit = entrée sur ce compte, debit = sortie.';
COMMENT ON COLUMN public.caisse_regulations.counter_account IS
  'Renseigné pour un transfert : l''écriture inverse est passée sur ce compte.';

CREATE TABLE IF NOT EXISTS public.tresorerie_pointages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_key  text NOT NULL UNIQUE,
  account    text NOT NULL CHECK (account IN ('caisse', 'mobile_money', 'banque')),
  pointe_le  timestamptz NOT NULL DEFAULT now(),
  pointe_par text,
  note       text
);

CREATE TABLE IF NOT EXISTS public.tresorerie_controles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date NOT NULL,
  account             text NOT NULL CHECK (account IN ('caisse', 'mobile_money', 'banque')),
  montant_compte_xof  integer NOT NULL,
  solde_theorique_xof integer NOT NULL,
  note                text,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tresorerie_controles_date_idx ON public.tresorerie_controles (date);

ALTER TABLE public.tresorerie_pointages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tresorerie_controles ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_manage_pointages ON public.tresorerie_pointages
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admin_manage_controles ON public.tresorerie_controles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.tresorerie_pointages, public.tresorerie_controles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tresorerie_pointages, public.tresorerie_controles TO authenticated;
