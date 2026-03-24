-- Migration: Create transactions table
-- Date: 2026-03-24

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  
  source TEXT NOT NULL DEFAULT 'nfl.com',
  source_url TEXT,
  source_id TEXT,
  
  transaction_date DATE NOT NULL,
  team_key VARCHAR(10),
  team_name TEXT,
  
  player_name TEXT NOT NULL,
  position VARCHAR(10),
  
  transaction_type_raw TEXT NOT NULL,
  transaction_type_normalized VARCHAR(50) NOT NULL,
  details TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_source_transaction UNIQUE (source, source_id, transaction_date, player_name)
);

CREATE INDEX IF NOT EXISTS idx_transactions_team_date ON transactions(team_key, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type_normalized);

CREATE OR REPLACE FUNCTION update_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_transactions_updated_at();

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON transactions
  FOR SELECT
  USING (true);