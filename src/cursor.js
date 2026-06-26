// A cursor is an opaque, base64url-encoded pointer to "the last row the client
// already saw". It carries the two values that define our total sort order:
// created_at (the primary sort key) and id (the unique tiebreaker).
//
// Because the cursor is anchored to *actual row values* -- not a numeric offset
// -- inserts and deletes elsewhere in the list cannot shift the client's
// position. That is what makes paging both correct (no dupes / no skips) and
// fast (no rows are counted or thrown away to reach a deep page).

export function encodeCursor(createdAt, id) {
  // createdAt comes back from pg as a JS Date; toISOString() is a stable,
  // round-trippable text form that Postgres parses straight back to timestamptz.
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${id}`).toString('base64url');
}

export function decodeCursor(raw) {
  if (!raw) return null;
  let decoded;
  try {
    decoded = Buffer.from(String(raw), 'base64url').toString('utf8');
  } catch {
    throw new Error('invalid cursor');
  }
  const sep = decoded.lastIndexOf('|');
  if (sep === -1) throw new Error('invalid cursor');

  const createdAt = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);

  if (Number.isNaN(Date.parse(createdAt)) || !/^\d+$/.test(id)) {
    throw new Error('invalid cursor');
  }
  return { createdAt, id };
}
