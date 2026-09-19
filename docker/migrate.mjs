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
 *  • ONLY forward, additive migrations — never drops or rewrites data.
 *  • Each migration runs once, inside a transaction; a failed migration
 *    aborts the container boot (fail-fast instead of a half-migrated DB).
 *  • Fully idempotent: re-running on an up-to-date database is a no-op,
 *    which makes container restarts and image redeploys safe.
 *
 * Exits 0 on success / "nothing to do", 1 on any failure.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@libsql/client";

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

    try {
      // Wrap in an explicit transaction: either the whole file lands or none
      // of it does. (Our migration files contain plain SQLite DDL/DML — no
      // PRAGMA/BEGIN inside, verified in CI — so wrapping is safe.)
      await client.executeMultiple(`BEGIN;\n${sql}\nCOMMIT;`);
    } catch (e) {
      // make sure a failed transaction is rolled back before we abort
      try {
        await client.execute("ROLLBACK");
      } catch {
        /* already rolled back / no active transaction */
      }
      fatal(`migration ${name} failed: ${e.message}`);
    }

    await client.execute({
      sql: 'INSERT INTO "_nakhl_migrations" ("name") VALUES (?)',
      args: [name],
    });
    console.log(`[migrate] ✓ ${name} applied`);
  }

  const total = (await client.execute('SELECT COUNT(*) AS n FROM "_nakhl_migrations"')).rows[0]?.n;
  console.log(`[migrate] database is up to date (${total} migration(s) applied)`);
  client.close();
}

main().catch((e) => fatal(e.stack ?? e.message));
