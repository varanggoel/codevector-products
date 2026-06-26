import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';
import { encodeCursor, decodeCursor } from './cursor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

// Serve the optional browse UI (bonus).
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => res.json({ ok: true }));

// List the distinct categories -- handy for the filter dropdown in the UI.
app.get('/api/categories', async (_req, res) => {
  try {
    const { rows } = await query('SELECT DISTINCT category FROM products ORDER BY category');
    res.json({ categories: rows.map((r) => r.category) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  }
});

// The main endpoint: newest-first, optional category filter, keyset paginated.
//
//   GET /api/products?limit=20&category=Books&cursor=<opaque>
//
// Response: { items: [...], nextCursor: <opaque|null> }
// Pass nextCursor back as ?cursor= to fetch the following page.
app.get('/api/products', async (req, res) => {
  // 1. Validate inputs.
  let limit = parseInt(req.query.limit, 10);
  if (Number.isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const category = typeof req.query.category === 'string' && req.query.category.length
    ? req.query.category
    : null;

  let cursor;
  try {
    cursor = decodeCursor(req.query.cursor);
  } catch {
    return res.status(400).json({ error: 'invalid cursor' });
  }

  // 2. Build the query. Parameters are numbered as we push them so the SQL
  //    stays injection-safe regardless of which filters are present.
  const params = [];
  const where = [];

  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }

  if (cursor) {
    // Row-value comparison: (created_at, id) < (cursorCreatedAt, cursorId).
    // Postgres expands this to exactly:
    //   created_at < c  OR  (created_at = c AND id < i)
    // which is precisely "strictly after the last row I saw" in DESC order.
    params.push(cursor.createdAt);
    const cIdx = params.length;
    params.push(cursor.id);
    const iIdx = params.length;
    where.push(`(created_at, id) < ($${cIdx}::timestamptz, $${iIdx}::bigint)`);
  }

  // Fetch one extra row to detect whether a further page exists.
  params.push(limit + 1);
  const limitIdx = params.length;

  const sql = `
    SELECT id, name, category, price, created_at, updated_at
    FROM products
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT $${limitIdx}
  `;

  // 3. Run it and shape the response.
  try {
    const { rows } = await query(sql, params);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

    res.json({ items, nextCursor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

// Clean shutdown so Render/Neon connections are released promptly.
process.on('SIGTERM', () => server.close(() => pool.end()));
