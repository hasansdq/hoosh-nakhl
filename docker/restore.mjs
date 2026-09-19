#!/usr/bin/env node
/**
 * Nakhl Restaurant — database restore (Docker / VPS)
 * ---------------------------------------------------
 * Replaces the live SQLite database with a snapshot produced by
 * scripts/backup.mjs (VACUUM INTO output). Designed to run inside a
 * one-off container while the app container is STOPPED (see
 * docker/restore.sh), so no process holds the database open:
 *
 *   docker compose stop app
 *   docker compose run --rm --entrypoint node app \
 *     scripts/restore.mjs /app/data/backups/nakhl-2025-… .db
 *   docker compose start app
 *
 * Safety rails:
 *  • refuses to run when NAKHL_SQLITE_PATH is unset;
 *  • verifies the snapshot actually contains the Nakhl schema
 *    (AdminUser + MenuItem tables) before overwriting anything;
 *  • keeps a one-time copy of the previous database next to it
 *    (nakhl.db.pre-restore) so a bad restore is itself restorable.
 *
 * Usage: node scripts/restore.mjs <path-to-snapshot.db>
 */

import { copyFile, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";

const DB_PATH = process.env.NAKHL_SQLITE_PATH;

function fatal(message) {
  console.error(`[restore] ✗ ${message}`);
  process.exit(1);
}

if (!DB_PATH) fatal("NAKHL_SQLITE_PATH is not set");

const snapshotPath = process.argv[2];
if (!snapshotPath) fatal("usage: node scripts/restore.mjs <path-to-snapshot.db>");

async function tableExists(client, name) {
  const r = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [name],
  });
  return Number(r.rows[0]?.n ?? 0) > 0;
}

async function main() {
  const info = await stat(snapshotPath).catch(() => null);
  if (!info || !info.isFile()) fatal(`snapshot not found: ${snapshotPath}`);

  // verify the snapshot really is a Nakhl database before touching anything
  const check = createClient({ url: `file:${snapshotPath}` });
  const hasAdmin = await tableExists(check, "AdminUser");
  const hasMenu = await tableExists(check, "MenuItem");
  check.close();
  if (!hasAdmin || !hasMenu) {
    fatal("snapshot does not look like a Nakhl database (AdminUser/MenuItem missing) — aborting");
  }

  // refuse to restore while another process (the app container) holds the
  // database open — a half-restored live DB would corrupt data
  if (await stat(DB_PATH).then(() => true, () => false)) {
    try {
      const probe = createClient({ url: `file:${DB_PATH}` });
      await probe.execute("PRAGMA schema_version");
      probe.close();
    } catch {
      fatal(
        "the live database is locked by another process — stop the app first: " +
          "docker compose stop app",
      );
    }
  }

  const previousExists = await stat(DB_PATH).then(() => true, () => false);
  if (previousExists) {
    const safetyCopy = `${DB_PATH}.pre-restore`;
    await unlink(safetyCopy).catch(() => {});
    await copyFile(DB_PATH, safetyCopy);
    console.log(`[restore] previous database saved as ${safetyCopy}`);
  }

  await copyFile(snapshotPath, DB_PATH);
  // drop WAL/SHM sidecars of the old database so it starts clean
  await unlink(`${DB_PATH}-wal`).catch(() => {});
  await unlink(`${DB_PATH}-shm`).catch(() => {});

  // sanity-open the restored file and re-enable WAL
  const client = createClient({ url: `file:${DB_PATH}` });
  const journal = await client.execute("PRAGMA journal_mode=WAL");
  const admins = Number(
    (await client.execute("SELECT COUNT(*) AS n FROM AdminUser")).rows[0]?.n ?? 0,
  );
  const items = Number(
    (await client.execute("SELECT COUNT(*) AS n FROM MenuItem")).rows[0]?.n ?? 0,
  );
  client.close();

  console.log(`[restore] ✓ database restored from ${snapshotPath}`);
  console.log(`[restore]   journal_mode=${journal.rows[0]?.[0]}  admins=${admins}  menuItems=${items}`);
  console.log("[restore] you can start the app container now");
}

main().catch((e) => fatal(e.stack ?? e.message));
