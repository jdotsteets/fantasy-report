ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS fantasy_impact_label text,
  ADD COLUMN IF NOT EXISTS fantasy_impact_confidence numeric;
