-- ============================================================
-- Enigma Escape Game — Migration v1.1 : Produits & Articles
-- Executer après 001_init.sql dans le SQL Editor de Supabase
-- ============================================================

-- Catalogue de produits vendus en salle (boissons, snacks…)
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price_xof int NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'autre',  -- 'boisson' | 'snack' | 'autre'
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Lignes d'articles vendus rattachées à un ticket
CREATE TABLE ticket_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  name text NOT NULL,          -- copie du nom au moment de la vente
  qty int NOT NULL DEFAULT 1,
  unit_price_xof int NOT NULL,
  total_xof int NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON products     FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON ticket_items FOR ALL TO anon USING (true) WITH CHECK (true);

-- Produits de démo (optionnel)
INSERT INTO products (name, price_xof, category, sort_order) VALUES
  ('Eau minérale',    500,  'boisson', 1),
  ('Coca-Cola',       750,  'boisson', 2),
  ('Jus de fruit',    700,  'boisson', 3),
  ('Chocolat',        500,  'snack',   4),
  ('Chips',           600,  'snack',   5),
  ('Barres céréales', 400,  'snack',   6);
