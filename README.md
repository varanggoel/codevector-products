# Products backend

A small Node.js service for browsing a large product catalog (~200k rows): list products
**newest first**, **filter by category**, and **paginate** through them. The design goal is
that paging stays **fast at any depth** and **correct even while products are being added or
updated** underneath you.

**Stack:** Node.js (Express) + Postgres (Neon). A minimal static browse UI is served by the
same app.

---

## The core idea: keyset pagination

The list is ordered by `(created_at DESC, id DESC)`. Instead of `OFFSET / LIMIT`, each page
returns a **cursor** pointing at the last row the client saw, and the next page asks for rows
strictly after it:

```sql
SELECT id, name, category, price, created_at, updated_at
FROM products
WHERE (created_at, id) < ($cursor_created_at, $cursor_id)   -- the "seek"
ORDER BY created_at DESC, id DESC
LIMIT $n;
```

This single decision is what keeps the service both fast and correct. Everything below is why.

## Why it stays fast

`OFFSET 100000 LIMIT 20` makes Postgres **walk and discard 100,000 rows** before returning 20,
so it gets slower the deeper you page (`O(offset)`).

Keyset pagination does an **index seek** instead. With an index on `(created_at DESC, id DESC)`,
the `WHERE (created_at, id) < (...)` jumps straight to the cursor position and reads the next
`LIMIT` rows — cost is `O(page size)`, so page 1 and page 10,000 are equally fast.

Indexes (see `src/schema.sql`):

- `(created_at DESC, id DESC)` — newest-first across all categories.
- `(category, created_at DESC, id DESC)` — newest-first **within** a category; the equality on
  `category` narrows the scan and the rest of the index already provides the sort order, so
  there's no separate sort step.

Because the index order matches the `ORDER BY` exactly, Postgres returns rows directly from the
index and stops after `LIMIT` rows.

## Why it stays correct while data changes

`OFFSET` counts **positions**, not rows. If 50 new products are inserted at the top while you're
between page 1 and page 2, every existing row shifts down by 50 — so `OFFSET 20` now points 50
rows earlier than before. You **re-see** rows (duplicates), and the symmetric case on delete
**skips** rows.

A keyset cursor anchors on a **value, not a position**: *"give me rows that come after this
specific `(created_at, id)`."* Newly inserted rows are newer, so they sort **above** the cursor
and just appear at the top of page 1 next time — they can never appear inside a later page the
client is already walking. So:

- **No duplicates** — every page asks for rows strictly `<` the previous page's last row.
- **No misses** — `id` is a unique, monotonic tiebreaker, so the ordering is **total**; there
  are no ties for the boundary to land ambiguously between.

### Why sort by `created_at` and not `updated_at`

"Newest first" is about creation, and `created_at` is **immutable**. Sorting by `updated_at`
would let an *update* move a row to a new position mid-scan — exactly the dup/miss bug we're
avoiding. Sorting on an immutable key gives each browsing session a stable, snapshot-like view.
An update changes a product's *contents* in place (you'll see fresh data if it's still ahead of
your cursor) without reordering the list.

### A precision detail

`pg` returns `timestamptz` as a JS `Date` (millisecond precision), while Postgres stores
microseconds. A naive cursor round-trip could lose sub-millisecond precision and mis-place the
boundary. The seed truncates `created_at` to the **second** so the ISO round-trip is exact; `id`
is the real tiebreaker anyway, so correctness never depends on timestamp resolution.

---

## Seeding the data (`scripts/seed.js`)

Generates 200,000 products with a single **set-based** `INSERT ... SELECT FROM
generate_series(...)`. Everything happens **inside Postgres** — no per-row round trips, no JS
loop. Each row gets a random category, a random price, and a `created_at` spread randomly across
the last 365 days.

```bash
npm run seed              # creates schema + 200k rows (skips if already populated)
npm run seed -- --reset   # truncate and rebuild
```

`scripts/insert-burst.js` inserts a batch of brand-new products on demand — useful for watching
the "no duplicates while paging" behavior live:

```bash
npm run insert-burst          # 50 new products at the top of the list
npm run insert-burst -- 200   # 200
```

---

## API

| Method | Path              | Notes                                                        |
|--------|-------------------|--------------------------------------------------------------|
| GET    | `/api/products`   | `?limit=20&category=Books&cursor=<opaque>` → `{ items, nextCursor }` |
| GET    | `/api/categories` | distinct categories, for the filter dropdown                 |
| GET    | `/health`         | `{ ok: true }`                                               |
| GET    | `/`               | static browse UI                                             |

Paging: call `/api/products`, then pass the returned `nextCursor` back as `?cursor=`. When
`nextCursor` is `null`, you've reached the end. `limit` is clamped to 1–100. The cursor is opaque
(base64url) so clients can't construct invalid seek positions.

---

## Running locally

```bash
cp .env.example .env        # set DATABASE_URL to your Postgres connection string
npm install
npm run seed
npm start                   # http://localhost:3000
```

To see the consistency property in action: load page 1 in the UI, run `npm run insert-burst`
(adds 50 brand-new products), then keep clicking **Load more** — you'll never see a duplicate or
a gap. The new rows only show up when you **Reset** back to the top.

---

## Deployment

Runs on any Node host with a Postgres database. The included `render.yaml` describes a free
Render web service; set `DATABASE_URL` to a Postgres connection string (e.g. Neon) and run the
seed once against that database.
