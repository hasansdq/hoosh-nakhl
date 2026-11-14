// Snapshot existing values (including BLOB bytes) and detect ANY row mutation.
// Run inside the migration's write transaction so concurrent writers cannot
// race the comparison. New schema columns are allowed; business rows are not.
import { createHash } from 'node:crypto';
const quote = (name) => '"' + String(name).replaceAll('"', '""') + '"';
const tables = async (db) => (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_nakhl_migrations' ORDER BY name")).rows.map(r => String(r.name));
const columns = async (db, table) => (await db.execute(`PRAGMA table_info(${quote(table)})`)).rows.map(r => String(r.name));
async function digest(db, table, cols) {
  const result = await db.execute(`SELECT ${cols.map(quote).join(',')} FROM ${quote(table)}`);
  const rows = result.rows.map(row => JSON.stringify(cols.map(col => {
    const value = row[col];
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return ['blob', Buffer.from(value instanceof ArrayBuffer ? value : value.buffer, value.byteOffset ?? 0, value.byteLength).toString('hex')];
    return [typeof value, value == null ? null : String(value)];
  }))).sort();
  const hash = createHash('sha256');
  for (const row of rows) hash.update(row).update('\n');
  return `${rows.length}:${hash.digest('hex')}`;
}
export async function snapshotData(db) {
  const snapshot = new Map();
  for (const table of await tables(db)) {
    const cols = await columns(db, table);
    snapshot.set(table, { cols, digest: await digest(db, table, cols) });
  }
  return snapshot;
}
export async function assertDataUnchanged(db, snapshot) {
  const current = await tables(db);
  for (const [table, before] of snapshot) {
    if (!current.includes(table)) throw new Error(`Data preservation: table removed: ${table}`);
    const cols = await columns(db, table);
    if (before.cols.some(c => !cols.includes(c))) throw new Error(`Data preservation: column removed: ${table}`);
    if (await digest(db, table, before.cols) !== before.digest) throw new Error(`Data preservation: rows added, removed or changed in ${table}`);
  }
  for (const table of current.filter(t => !snapshot.has(t))) {
    if (Number((await db.execute(`SELECT COUNT(*) AS n FROM ${quote(table)}`)).rows[0].n) !== 0) throw new Error(`Data preservation: new table contains data: ${table}`);
  }
}
