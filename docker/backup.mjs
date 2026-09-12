#!/usr/bin/env node
/**
 * Nakhl Restaurant — consistent database snapshots (Docker / VPS)
 * ----------------------------------------------------------------
 * Creates a point-in-time snapshot of the SQLite database using
 * `VACUUM INTO` (an atomic, online, consistent backup — readers/writers
 * keep working). Snapshots land in $NAKHL_DATA_DIR/backups/ on the same
 * persistent volume, with automatic retention pruning
 * (NAKHL_BACKUP_KEEP, default 14).
 *
 * Usage (from the host, see docker/backup.sh):
 *   docker compose exec app node scripts/backup.mjs
 *
 * Exit codes: 0 = ok (or nothing to do), 1 = failure.
 */

import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@libsql/client";

const DB_PATH = process.env.NAKHL_SQLITE_PATH;
const DATA_DIR = process.env.NAKHL_DATA_DIR ?? "/app/data";
const KEEP = Math.max(1, Number(process.env.NAKHL_BACKUP_KEEP ?? 14));

function fatal(message) {
  console.error(`[backup] ✗ ${message}`);
  process.exit(1);
}

if (!DB_PATH) fatal("NAKHL_SQLITE_PATH is not set");

async function main() {
  const info = await stat(DB_PATH).catch(() => null);
  if (!info) {
    console.log("[backup] database file does not exist yet — nothing to back up");
    return;
  }

  const backupsDir = join(DATA_DIR, "backups");
  await mkdir(backupsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = join(backupsDir, `nakhl-${stamp}.db`);

  // VACUUM INTO: consistent snapshot while the app keeps serving traffic.
  const client = createClient({ url: `file:${DB_PATH}` });
  await client.execute({ sql: "VACUUM INTO ?", args: [target] });
  client.close();

  const snapshotInfo = await stat(target);
  const sizeMb = (snapshotInfo.size / (1024 * 1024)).toFixed(2);
  console.log(`[backup] ✓ snapshot written: ${target} (${sizeMb} MB)`);

  // retention pruning — oldest first
  const snapshots = (await readdir(backupsDir))
    .filter((f) => /^nakhl-\d{4}-\d{2}-\d{2}T.*\.db$/.test(f))
    .sort();
  const excess = snapshots.slice(0, Math.max(0, snapshots.length - KEEP));
  for (const name of excess) {
    await unlink(join(backupsDir, name));
    console.log(`[backup] – pruned old snapshot ${name} (keep=${KEEP})`);
  }
  console.log(`[backup] ${snapshots.length - excess.length} snapshot(s) retained in ${backupsDir}`);
}

main().catch((e) => fatal(e.stack ?? e.message));
