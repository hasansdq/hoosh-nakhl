#!/usr/bin/env node
/**
 * Nakhl Restaurant — first-boot seeder (Docker / VPS)
 * ---------------------------------------------------
 * Applies the idempotent SQL seeds to the local SQLite database, then
 * bootstraps the administrator account under strict data-preservation rules:
 *
 *  1. seed/seed-core.sql      — categories, menu, coupons (INSERT OR IGNORE:
 *                               existing rows — including anything the admin
 *                               has edited — are never overwritten).
 *     The embedded demo-admin INSERT is filtered out here; admin creation is
 *     env-driven so VPS operators control their own credentials.
 *  2. seed/settings-<profile>.sql — default settings rows (INSERT OR IGNORE;
 *     admin changes made in the panel always win).
 *  3. Admin bootstrap — ONLY when the AdminUser table is completely empty:
 *       • ADMIN_USERNAME (default "nakhl-admin") + ADMIN_PASSWORD from env,
 *       • or a strong random password generated on first boot and written to
 *         $NAKHL_DATA_DIR/initial-admin-credentials.txt (readable by the
 *         container user only — chmod 0600).
 *     If ANY admin already exists, this step is skipped and the existing
 *     credentials (password hash, sessions, lockout state) are preserved
 *     untouched — this is what makes redeploys lossless.
 *
 * Password hashing mirrors src/lib/auth.ts exactly (scrypt, 16-byte hex salt,
 * 64-byte key, "salt:hash" format) so the panel login accepts it.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { createClient } from "@libsql/client";

const DB_PATH = process.env.NAKHL_SQLITE_PATH;
const SEED_DIR = process.env.NAKHL_SEED_DIR ?? "/app/seed";
const DATA_DIR = process.env.NAKHL_DATA_DIR ?? "/app/data";
const SEED_PROFILE = (process.env.NAKHL_SEED_PROFILE ?? "prod").toLowerCase(); // prod | dev

function fatal(message) {
  console.error(`[seed] ✗ ${message}`);
  process.exit(1);
}

if (!DB_PATH) fatal("NAKHL_SQLITE_PATH is not set");

/** Hash exactly like src/lib/auth.ts → "salt:scrypthex". */
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/** Remove the demo-admin INSERT lines from seed-core.sql (admin is env-driven here). */
function stripAdminInserts(sql) {
  const needle = 'INSERT OR IGNORE INTO "ADMINUSER"';
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().toUpperCase().startsWith(needle))
    .join("\n");
}

async function main() {
  const client = createClient({ url: `file:${DB_PATH}` });

  // ---- 1. core seed (menu / categories / coupons) ------------------------
  const coreSql = stripAdminInserts(await readFile(join(SEED_DIR, "seed-core.sql"), "utf8"));
  await client.executeMultiple(coreSql);
  console.log("[seed] ✓ core seed applied (INSERT OR IGNORE — existing rows untouched)");

  // ---- 2. settings defaults ----------------------------------------------
  const settingsFile =
    SEED_PROFILE === "dev" ? "settings-dev.sql" : "settings-prod.sql";
  const settingsSql = await readFile(join(SEED_DIR, settingsFile), "utf8");
  await client.executeMultiple(settingsSql);
  console.log(`[seed] ✓ settings defaults applied (${settingsFile} — profile "${SEED_PROFILE}")`);

  // ---- 3. admin bootstrap (only when NO admin exists at all) -------------
  const adminCount = Number(
    (await client.execute("SELECT COUNT(*) AS n FROM AdminUser")).rows[0]?.n ?? 0,
  );

  if (adminCount > 0) {
    console.log(
      `[seed] ✓ admin bootstrap skipped — ${adminCount} existing admin account(s) preserved`,
    );
    client.close();
    return;
  }

  const username = process.env.ADMIN_USERNAME || "nakhl-admin";
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password || password.length < 8) {
    if (password && password.length < 8) {
      console.warn("[seed] ADMIN_PASSWORD shorter than 8 chars — generating a strong one instead");
    }
    // 16 chars from a URL-safe alphabet — strong enough for an admin panel
    password = randomBytes(12).toString("base64url");
    generated = true;
  }

  const id = `admin-${randomBytes(8).toString("hex")}`;
  await client.execute({
    sql: 'INSERT INTO "AdminUser" ("id", "username", "passwordHash", "displayName", "failedAttempts") VALUES (?, ?, ?, ?, 0)',
    args: [id, username, hashPassword(password), "مدیر رستوران نخل"],
  });
  console.log(`[seed] ✓ admin created: ${username}`);

  if (generated) {
    const credentialsFile = join(DATA_DIR, "initial-admin-credentials.txt");
    const body =
      `نخستین ورود مدیر — رستوران نخل\n` +
      `==================================\n` +
      `نام کاربری: ${username}\n` +
      `رمز عبور:  ${password}\n\n` +
      `این فایل فقط یک بار (اولین بوت کانتینر) ساخته می‌شود.\n` +
      `رمز را یادداشت کنید و از پنل مدیریت، رمز جدیدی انتخاب کنید.\n` +
      `مسیر ورود: https://YOUR-DOMAIN/nk-admin\n`;
    await writeFile(credentialsFile, body, { mode: 0o600 });
    console.log(
      `[seed] ⚠ no ADMIN_PASSWORD provided — a random password was generated and saved to ${credentialsFile}`,
    );
    console.log("[seed]   (docker compose exec app cat data/initial-admin-credentials.txt)");
  } else {
    console.log("[seed]   password taken from ADMIN_PASSWORD env (hash stored in the database)");
  }

  client.close();
}

main().catch((e) => fatal(e.stack ?? e.message));
