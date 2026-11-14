#!/usr/bin/env node
/**
 * Nakhl Restaurant — SQLite migration runner (Docker / VPS)
 * ---------------------------------------------------------
 * Applies the SQL migrations in $NAKHL_MIGRATIONS_DIR (defaults to
 * /app/migrations — the same files Cloudflare D1 applies via
 * `wrangler d1 migrations apply`) to the local SQLite database at
 * $NAKHL_SQLITE_PATH, tracking applied files in `_nakhl_migrations`.
 *
 * Safety contract (the reason this file exists):
 *  • Forward-only migrations; explicit destructive changes may remove data.
 *  • Each migration and its completion record commit in one transaction; a failed migration
 *    aborts the container boot (fail-fast instead of a half-migrated DB).
 *  • Fully idempotent: re-running on an up-to-date database is a no-op,
 *    which makes container restarts and image redeploys safe.
 *
 * Exits 0 on success / "nothing to do", 1 on any failure.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { snapshotData, assertDataUnchanged } from "./data-integrity.mjs";

const DB_PATH = process.env.NAKHL_SQLITE_PATH;
const MIGRATIONS_DIR = process.env.NAKHL_MIGRATIONS_DIR ?? "/app/migrations";

function fatal(message) {
  console.error(`[migrate] ✗ ${message}`);
  process.exit(1);
}

if (!DB_PATH) fatal("NAKHL_SQLITE_PATH is not set");

const MIGRATION_FILE_RE = /^\d{4}_.*\.sql$/i; // 0001_init.sql, 0002_site_content.sql, …

async function main() {
  const client = createClient({ url: `file:${DB_PATH}` });

  // --- tracking table (d1_migrations-compatible spirit, own namespace) ---
  await client.execute(`
    CREATE TABLE IF NOT EXISTS "_nakhl_migrations" (
      "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
      "name"      TEXT NOT NULL UNIQUE,
      "applied_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Enable WAL once — persistent setting stored in the database file itself,
  // survives restarts and gives concurrent readers during writes.
  const journal = await client.execute("PRAGMA journal_mode=WAL");
  console.log(`[migrate] journal_mode = ${journal.rows[0]?.[0] ?? "?"}`);

  // ---------------------------------------------------------------------------
  // CRITICAL DATA-SAFETY — foreign key enforcement must be OFF while migrating.
  //
  // @libsql/client opens connections with foreign_keys=ON (verified
  // empirically — NOT the raw SQLite default of OFF). At least one migration
  // (0006) rebuilds the Order table using the SQLite copy-drop-rename pattern.
  // With FK enforcement ON, `DROP TABLE "Order"` performs an implicit DELETE
  // that CASCADE-deletes every OrderItem and OrderStatusLog row — silently
  // wiping the details of ALL existing orders on upgrade.
  //
  // PRAGMA foreign_keys is a NO-OP inside a transaction, so it MUST be set
  // here, outside the per-migration BEGIN/COMMIT wrappers. This is the exact
  // approach of the Prisma migration runner for SQLite.
  // ---------------------------------------------------------------------------
  await client.execute("PRAGMA foreign_keys=OFF");
  const fkState = await client.execute("PRAGMA foreign_keys");
  const fkOff = Number(fkState.rows[0]?.foreign_keys ?? fkState.rows[0]?.[0] ?? 1);
  if (fkOff !== 0) {
    fatal(
      "could not disable foreign key enforcement on this connection — refusing to migrate (a table-rebuild migration would cascade-delete order details)",
    );
  }
  console.log("[migrate] foreign_keys = OFF for the migration connection (data-safety)");

  // --- discover + apply pending migrations -------------------------------
  let files = [];
  try {
    files = (await readdir(MIGRATIONS_DIR)).filter((f) => MIGRATION_FILE_RE.test(f)).sort();
  } catch (e) {
    fatal(`cannot read migrations dir ${MIGRATIONS_DIR}: ${e.message}`);
  }
  if (files.length === 0) {
    console.warn(`[migrate] no migration files found in ${MIGRATIONS_DIR}`);
  }

  const applied = new Set(
    (await client.execute('SELECT "name" FROM "_nakhl_migrations"')).rows.map((r) => String(r.name)),
  );

  for (const name of files) {
    if (applied.has(name)) {
      console.log(`[migrate] ✓ ${name} (already applied)`);
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
    console.log(`[migrate] ▶ applying ${name} (${sql.length} bytes)…`);

    const tx = await client.transaction("write");
    try {
      const before = await snapshotData(tx);
      await tx.executeMultiple(sql);
      await assertDataUnchanged(tx, before);
      const violations = await tx.execute("PRAGMA foreign_key_check");
      if (violations.rows.length) throw new Error("foreign_key_check failed before commit");
      await tx.execute({ sql: 'INSERT INTO "_nakhl_migrations" ("name") VALUES (?)', args: [name] });
      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw new Error(`migration ${name} rolled back: ${e.message}`);
    } finally {
      tx.close();
    }

    console.log(`[migrate] ✓ ${name} applied`);
  }

  // ---------------------------------------------------------------------------
  // Post-migration integrity gate: with FK enforcement off, referential damage
  // would not have aborted any statement — verify the final state explicitly
  // before handing the database to the application (fail-fast > subtle rot).
  // ---------------------------------------------------------------------------
  const violations = await client.execute("PRAGMA foreign_key_check");
  if (violations.rows.length > 0) {
    const tableNames = [...new Set(violations.rows.map((r) => String(r.table ?? r[0] ?? "?")))];
    fatal(
      `foreign_key_check reported ${violations.rows.length} violation(s) in: ${tableNames.join(", ")} — ` +
        `restore the latest snapshot with docker/restore.sh before serving traffic`,
    );
  }
  console.log("[migrate] foreign_key_check clean — referential integrity verified");
  await client.execute("PRAGMA foreign_keys=ON");

  const total = (await client.execute('SELECT COUNT(*) AS n FROM "_nakhl_migrations"')).rows[0]?.n;
  console.log(`[migrate] database is up to date (${total} migration(s) applied)`);
  client.close();
}

main().catch((e) => fatal(e.stack ?? e.message));
