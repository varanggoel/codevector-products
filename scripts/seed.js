import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOTAL = parseInt(process.env.SEED_COUNT || '200000', 10);
const RESET = process.argv.includes('--reset');

const CATEGORIES = [
  'Electronics', 'Books', 'Clothing', 'Home', 'Toys',
  'Sports', 'Beauty', 'Grocery', 'Automotive', 'Garden',
];

async function main() {
  // 1. Make sure the table + indexes exist.
  const schema = await readFile(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');
  await query(schema);

  if (RESET) {
    console.log('Resetting products table...');
    await query('TRUNCATE products RESTART IDENTITY');
  }

  const { rows: [{ count }] } = await query('SELECT count(*)::int AS count FROM products');
  if (count > 0 && !RESET) {
    console.log(`Table already has ${count} rows. Use "npm run seed -- --reset" to rebuild.`);
    await pool.end();
    return;
  }

  console.log(`Seeding ${TOTAL.toLocaleString()} products in a single set-based INSERT...`);
  const started = Date.now();

  // The whole dataset is generated *inside Postgres* with generate_series.
  // No per-row round trips, no JS loop -- one statement builds all 200k rows.
  //
  //  - created_at is spread randomly across the last 365 days and truncated to
  //    the second (keeps the keyset cursor round-trip exact to the millisecond).
  //  - The LATERAL subselect computes one random timestamp per row, reused for
  //    both created_at and updated_at.
  await query(
    `
    INSERT INTO products (name, category, price, created_at, updated_at)
    SELECT
      'Product #' || g,
      ($2::text[])[1 + floor(random() * array_length($2::text[], 1))::int],
      round((random() * 490 + 10)::numeric, 2),
      t.ts,
      t.ts
    FROM generate_series(1, $1) AS g
    CROSS JOIN LATERAL (
      SELECT date_trunc('second', now() - (random() * 365 * 24 * 3600) * interval '1 second') AS ts
    ) AS t
    `,
    [TOTAL, CATEGORIES],
  );

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const { rows: [{ count: final }] } = await query('SELECT count(*)::int AS count FROM products');
  console.log(`Done. ${final.toLocaleString()} rows in ${secs}s.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
