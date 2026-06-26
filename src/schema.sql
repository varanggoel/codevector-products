-- Products table.
-- id is a monotonic identity column: it gives us a guaranteed-unique,
-- always-increasing tiebreaker so the sort order is *total* (no ties).
CREATE TABLE IF NOT EXISTS products (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT          NOT NULL,
  category    TEXT          NOT NULL,
  price       NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index for "newest first" across ALL categories.
-- It matches the query's ORDER BY exactly, so Postgres can walk the index
-- and stop after LIMIT rows -- no full scan, no sort step.
CREATE INDEX IF NOT EXISTS idx_products_created_id
  ON products (created_at DESC, id DESC);

-- Index for "newest first WITHIN a category".
-- Leading column = category so the equality filter narrows the scan, then the
-- same (created_at DESC, id DESC) ordering is served straight from the index.
CREATE INDEX IF NOT EXISTS idx_products_cat_created_id
  ON products (category, created_at DESC, id DESC);
