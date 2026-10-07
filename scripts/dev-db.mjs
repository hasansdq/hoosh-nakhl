#!/usr/bin/env node
/**
 * Nakhl Restaurant — dev database bootstrap (local `next dev`)
 * ------------------------------------------------------------
 * Creates/updates the local SQLite database (db/nakhl.db) using the SAME
 * operational scripts the Docker container runs at boot:
 *
 *   1. docker/migrate.mjs  — forward-only migrations (migrations/*.sql)
 *   2. docker/seed.mjs     — idempotent seed + admin bootstrap
 *
 * Everything is idempotent: re-running never overwrites edited menu rows,
 * settings or admin accounts (INSERT OR IGNORE + "admin exists → skip").
 *
 * Dev admin account (only used when NO admin exists yet — export before
 * running on a fresh database; otherwise a strong random password is
 * generated and printed once):
 *   ADMIN_USERNAME=rayantech ADMIN_PASSWORD='…' bun run db:setup
 *
 * Usage:  bun run db:setup
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbDir = join(root, "db");
mkdirSync(dbDir, { recursive: true });

const env = {
  ...process.env,
  NAKHL_SQLITE_PATH: process.env.NAKHL_SQLITE_PATH ?? join(dbDir, "nakhl.db"),
  NAKHL_MIGRATIONS_DIR: join(root, "migrations"),
  NAKHL_SEED_DIR: join(root, "seed"),
  NAKHL_DATA_DIR: dbDir,
  // dev profile: OTP dev codes visible in API responses (sandbox/testing only!)
  NAKHL_SEED_PROFILE: process.env.NAKHL_SEED_PROFILE ?? "dev",
};

const steps = [
  ["docker/migrate.mjs", "migrations"],
  ["docker/seed.mjs", "seed + admin bootstrap"],
];

for (const [script, label] of steps) {
  const result = spawnSync(process.execPath, [join(root, script)], {
    stdio: "inherit",
    env,
    cwd: root,
  });
  if (result.status !== 0) {
    console.error(`[dev-db] ✗ ${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

console.log(`[dev-db] ✓ dev database ready (${env.NAKHL_SQLITE_PATH})`);
