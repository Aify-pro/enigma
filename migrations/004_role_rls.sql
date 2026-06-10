-- ============================================================
-- Enigma — Migration v1.3 : RLS par rôle (admin / staff)
-- Exécuter après 003_auth_rls.sql
--
-- Logique :
--   admin → accès complet à tout
--   staff → lecture des données nécessaires à la caisse
--           + écriture tickets / ticket_items / expenses
-- ============================================================

-- Fonction helper : retourne le rôle depuis le JWT
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    lower(auth.jwt() -> 'user_metadata' ->> 'role'),
    'staff'
  )
$$;

CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.user_role() = 'admin'
$$;

-- ── Supprimer les politiques auth_all existantes ──────────────
DROP POLICY IF EXISTS "auth_all" ON rooms;
DROP POLICY IF EXISTS "auth_all" ON time_slots;
DROP POLICY IF EXISTS "auth_all" ON pricing_rules;
DROP POLICY IF EXISTS "auth_all" ON vouchers;
DROP POLICY IF EXISTS "auth_all" ON tickets;
DROP POLICY IF EXISTS "auth_all" ON expenses;
DROP POLICY IF EXISTS "auth_all" ON daily_fund;
DROP POLICY IF EXISTS "auth_all" ON products;
DROP POLICY IF EXISTS "auth_all" ON ticket_items;

-- ── rooms : lecture staff, écriture admin ────────────────────
CREATE POLICY "rooms_read"  ON rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "rooms_write" ON rooms FOR ALL    TO authenticated USING (auth.is_admin()) WITH CHECK (auth.is_admin());

-- ── time_slots : lecture staff, écriture admin ───────────────
CREATE POLICY "slots_read"  ON time_slots FOR SELECT TO authenticated USING (true);
CREATE POLICY "slots_write" ON time_slots FOR ALL    TO authenticated USING (auth.is_admin()) WITH CHECK (auth.is_admin());

-- ── pricing_rules : lecture staff, écriture admin ────────────
CREATE POLICY "pricing_read"  ON pricing_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "pricing_write" ON pricing_rules FOR ALL    TO authenticated USING (auth.is_admin()) WITH CHECK (auth.is_admin());

-- ── products : lecture staff, écriture admin ─────────────────
CREATE POLICY "products_read"  ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_write" ON products FOR ALL    TO authenticated USING (auth.is_admin()) WITH CHECK (auth.is_admin());

-- ── vouchers : lecture + update solde staff (caisse), admin full
CREATE POLICY "vouchers_select" ON vouchers FOR SELECT TO authenticated USING (true);
CREATE POLICY "vouchers_update" ON vouchers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "vouchers_insert" ON vouchers FOR INSERT TO authenticated WITH CHECK (auth.is_admin());
CREATE POLICY "vouchers_delete" ON vouchers FOR DELETE TO authenticated USING (auth.is_admin());

-- ── tickets : staff peut créer + lire, admin full ────────────
CREATE POLICY "tickets_select" ON tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "tickets_insert" ON tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tickets_update" ON tickets FOR UPDATE TO authenticated USING (auth.is_admin());
CREATE POLICY "tickets_delete" ON tickets FOR DELETE TO authenticated USING (auth.is_admin());

-- ── ticket_items : idem tickets ──────────────────────────────
CREATE POLICY "items_select" ON ticket_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "items_insert" ON ticket_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "items_delete" ON ticket_items FOR DELETE TO authenticated USING (auth.is_admin());

-- ── expenses : staff INSERT, admin full ──────────────────────
CREATE POLICY "exp_select" ON expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "exp_insert" ON expenses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "exp_update" ON expenses FOR UPDATE TO authenticated USING (auth.is_admin());
CREATE POLICY "exp_delete" ON expenses FOR DELETE TO authenticated USING (auth.is_admin());

-- ── daily_fund : admin uniquement ────────────────────────────
CREATE POLICY "fund_all" ON daily_fund FOR ALL TO authenticated USING (auth.is_admin()) WITH CHECK (auth.is_admin());
