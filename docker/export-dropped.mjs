#!/usr/bin/env node
/**
 * Nakhl Restaurant — pre-upgrade export of structures a migration will DROP
 * -------------------------------------------------------------------------
 * Called by docker/update.sh (step 0) before any container is replaced.
 * Probes the CURRENT database for the tables/columns that the next upgrade
 * intentionally deletes (see the manifest below) and writes a human-readable
 * JSON export to the persistent volume, next to the machine backups:
 *
 *   $NAKHL_DATA_DIR/pre-upgrade-dropped-<YYYY-MM-DD>.json   (mode 0600)
 *
 * This is a READ-ONLY safety net on top of the full binary backup: it makes
 * the deleted reservations / scheduled delivery times readable and re-
 * importable by hand, forever, even after the schema no longer has a place
 * for them. Exits 0 when there is nothing to export or the export succeeded;
 * exits 1 only on a real I/O error (the caller warns and continues — the
 * full backup from step 1 still covers recovery).
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const DB_PATH = process.env.NAKHL_SQLITE_PATH;
const DATA_DIR = process.env.NAKHL_DATA_DIR ?? "/app/data";

// Manifest — structures the upcoming migration deletes BY DESIGN.
// Keep in sync with docker/upgrade-test.mjs (STRUCTURAL_CHANGES).
const DROPPED_TABLES = ["Reservation"];
const DROPPED_COLUMNS = { Order: ["scheduledFor"] };

function fatal(msg) {
  console.error(`[export-dropped] ✗ ${msg}`);
  process.exit(1);
}
if (!DB_PATH) fatal("NAKHL_SQLITE_PATH is not set");

async function main() {
  const client = createClient({ url: `file:${DB_PATH}` });
  const out = { exportedAt: new Date().toISOString(), tables: {}, columns: {} };

  for (const table of DROPPED_TABLES) {
    const exists = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`,
    );
    if (exists.rows.length === 0) continue;
    const rows = await client.execute(`SELECT * FROM "${table}" ORDER BY "createdAt"`);
    out.tables[table] = rows.rows;
    console.log(`[export-dropped] جدول ${table}: ${rows.rows.length} ردیف برای خروجی ثبت شد`);
  }

  for (const [table, cols] of Object.entries(DROPPED_COLUMNS)) {
    const info = await client.execute(`PRAGMA table_info("${table}")`);
    const present = info.rows.map((r) => String(r.name)).filter((c) => cols.includes(c));
    if (present.length === 0) continue;
    const colSel = ["id", ...present].map((c) => `"${c}"`).join(", ");
    const rows = await client.execute(`SELECT ${colSel} FROM "${table}" ORDER BY "id"`);
    if (rows.rows.length === 0) continue;
    out.columns[table] = { droppedColumns: present, rows: rows.rows };
    console.log(`[export-dropped] ستون‌های ${table}.${present.join(",")}: ${rows.rows.length} ردیف ثبت شد`);
  }

  const nothing = Object.keys(out.tables).length === 0 && Object.keys(out.columns).length === 0;
  if (nothing) {
    console.log("[export-dropped] چیزی برای خروجی نیست — این دیتابیس ساختارهای حذف‌شونده را ندارد");
    client.close();
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const file = join(DATA_DIR, `pre-upgrade-dropped-${stamp}.json`);
  await writeFile(file, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
  console.log(`[export-dropped] ✓ خروجی JSON نوشته شد: ${file} (0600)`);
  client.close();
}

main().catch((e) => fatal(e.stack ?? e.message));
