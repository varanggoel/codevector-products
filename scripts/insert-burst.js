import { pool, query } from '../src/db.js';

// Demonstrates requirement #2: insert a burst of brand-new products (newest of
// all) WHILE a client is paging. With keyset pagination the client's cursor is
// anchored to an older row, so these new rows appear only at the top of page 1
// -- they never duplicate or push past the client's current position.
//
//   npm run insert-burst            # inserts 50 new products
//   npm run insert-burst -- 200     # inserts 200

const n = parseInt(process.argv[2] || '50', 10);

const CATEGORIES = [
  'Electronics', 'Books', 'Clothing', 'Home', 'Toys',
  'Sports', 'Beauty', 'Grocery', 'Automotive', 'Garden',
];

async function main() {
  const { rows } = await query(
    `
    INSERT INTO products (name, category, price, created_at, updated_at)
    SELECT
      'BURST product #' || g,
      ($2::text[])[1 + floor(random() * array_length($2::text[], 1))::int],
      round((random() * 490 + 10)::numeric, 2),
      now(), now()
    FROM generate_series(1, $1) AS g
    RETURNING id
    `,
    [n, CATEGORIES],
  );
  console.log(`Inserted ${rows.length} fresh products at the top of the list.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
