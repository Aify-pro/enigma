-- ============================================================
-- Enigma — Migration v1.2 : RLS authentifiée
-- Remplace les politiques anon par authenticated.
-- Après cette migration, seuls les utilisateurs connectés
-- (via Supabase Auth) peuvent lire/écrire les données.
--
-- Étapes :
--   1. Exécuter ce script dans le SQL Editor Supabase
--   2. Aller dans Authentication > Users > Add user
--      pour créer les comptes staff / admin
-- ============================================================

-- Supprimer les anciennes politiques anon
DROP POLICY IF EXISTS "anon_all" ON rooms;
DROP POLICY IF EXISTS "anon_all" ON time_slots;
DROP POLICY IF EXISTS "anon_all" ON pricing_rules;
DROP POLICY IF EXISTS "anon_all" ON vouchers;
DROP POLICY IF EXISTS "anon_all" ON tickets;
DROP POLICY IF EXISTS "anon_all" ON expenses;
DROP POLICY IF EXISTS "anon_all" ON daily_fund;
DROP POLICY IF EXISTS "anon_all" ON products;
DROP POLICY IF EXISTS "anon_all" ON ticket_items;

-- Créer les nouvelles politiques pour utilisateurs authentifiés
CREATE POLICY "auth_all" ON rooms         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON time_slots    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON pricing_rules FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON vouchers      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON tickets       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON expenses      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON daily_fund    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON products      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON ticket_items  FOR ALL TO authenticated USING (true) WITH CHECK (true);
