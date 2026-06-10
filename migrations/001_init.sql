-- ============================================================
-- Enigma Escape Game — Schéma v1.0
-- Executer dans le SQL Editor de votre nouveau projet Supabase
-- ============================================================

-- Salles d'évasion
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  duration_minutes int NOT NULL DEFAULT 60,
  min_players int NOT NULL DEFAULT 2,
  max_players int NOT NULL DEFAULT 6,
  extra_player_price_xof int NOT NULL DEFAULT 0,
  color text DEFAULT '#7c6af7',
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Créneaux horaires par salle
CREATE TABLE time_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_time text NOT NULL,
  is_active boolean DEFAULT true,
  UNIQUE(room_id, start_time)
);

-- Tarifs : prix de base par nombre de joueurs (min_players à max_players)
CREATE TABLE pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_count int NOT NULL,
  price_xof int NOT NULL,
  is_active boolean DEFAULT true,
  UNIQUE(room_id, player_count)
);

-- Bons cadeaux
CREATE TABLE vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  initial_amount_xof int NOT NULL,
  remaining_amount_xof int NOT NULL,
  is_active boolean DEFAULT true,
  sold_by text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Tickets vendus
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text UNIQUE NOT NULL,
  room_id uuid REFERENCES rooms(id),
  room_name text NOT NULL,
  session_date date NOT NULL,
  time_slot text NOT NULL,
  num_players int NOT NULL,
  base_price_xof int NOT NULL,
  extra_price_xof int NOT NULL DEFAULT 0,
  discount_xof int NOT NULL DEFAULT 0,
  total_price_xof int NOT NULL,
  payment_especes_xof int NOT NULL DEFAULT 0,
  payment_mobile_xof int NOT NULL DEFAULT 0,
  payment_voucher_xof int NOT NULL DEFAULT 0,
  voucher_id uuid REFERENCES vouchers(id),
  operator_name text NOT NULL,
  notes text DEFAULT '',
  status text NOT NULL DEFAULT 'confirmed',
  created_at timestamptz DEFAULT now()
);

-- Dépenses
CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount_xof int NOT NULL,
  category text NOT NULL,
  description text DEFAULT '',
  operator_name text NOT NULL,
  receipt_ref text DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  validated_by text,
  validated_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Fond de caisse journalier
CREATE TABLE daily_fund (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date UNIQUE NOT NULL DEFAULT CURRENT_DATE,
  opening_fund_xof int NOT NULL DEFAULT 0,
  closing_fund_xof int,
  notes text DEFAULT '',
  operator_name text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- ── Politique RLS : accès complet via anon key (kiosque local) ──────────────
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_fund ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON rooms FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON time_slots FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON pricing_rules FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON vouchers FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON tickets FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON expenses FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON daily_fund FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── Données de démo (optionnel — supprimer avant production) ────────────────
INSERT INTO rooms (name, description, duration_minutes, min_players, max_players, extra_player_price_xof, color, sort_order)
VALUES
  ('L''Antre du Dragon',  'Magie et mystère dans un donjon médiéval', 60, 2, 5, 3000, '#e85d75', 1),
  ('La Station Abandon',  'Survie dans une station spatiale hantée',   75, 2, 6, 2500, '#22d3ee', 2),
  ('Le Laboratoire Maudit','Virus zombie, 60 min pour trouver le vaccin', 60, 3, 8, 2000, '#4ade80', 3);

-- Créneaux pour chaque salle
INSERT INTO time_slots (room_id, start_time)
SELECT id, s FROM rooms, unnest(ARRAY['10:00','12:00','14:00','16:00','18:00']) s
WHERE name = 'L''Antre du Dragon';

INSERT INTO time_slots (room_id, start_time)
SELECT id, s FROM rooms, unnest(ARRAY['10:00','13:00','16:00','19:00']) s
WHERE name = 'La Station Abandon';

INSERT INTO time_slots (room_id, start_time)
SELECT id, s FROM rooms, unnest(ARRAY['09:00','11:00','14:00','17:00']) s
WHERE name = 'Le Laboratoire Maudit';

-- Tarifs pour L'Antre du Dragon
INSERT INTO pricing_rules (room_id, player_count, price_xof)
SELECT r.id, p.n, p.price FROM rooms r,
  (VALUES (2,10000),(3,14000),(4,18000),(5,22000)) p(n,price)
WHERE r.name = 'L''Antre du Dragon';

-- Tarifs pour La Station Abandon
INSERT INTO pricing_rules (room_id, player_count, price_xof)
SELECT r.id, p.n, p.price FROM rooms r,
  (VALUES (2,12000),(3,16000),(4,20000),(5,24000),(6,28000)) p(n,price)
WHERE r.name = 'La Station Abandon';

-- Tarifs pour Le Laboratoire Maudit
INSERT INTO pricing_rules (room_id, player_count, price_xof)
SELECT r.id, p.n, p.price FROM rooms r,
  (VALUES (3,15000),(4,19000),(5,23000),(6,27000),(7,31000),(8,35000)) p(n,price)
WHERE r.name = 'Le Laboratoire Maudit';
