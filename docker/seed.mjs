#!/usr/bin/env node
// Explicit admin bootstrap for a completely empty installation only.
// No menu, settings, coupons, users or orders are seeded, in any profile.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { createClient } from "@libsql/client";

const DB_PATH = process.env.NAKHL_SQLITE_PATH;
const DATA_DIR = process.env.NAKHL_DATA_DIR ?? "/app/data";

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

async function main() {
  const client = createClient({ url: `file:${DB_PATH}` });

  // Explicit first-install administration only. Never load demo SQL/settings.
  if (process.env.NAKHL_BOOTSTRAP_ADMIN !== "1") {
    console.log("[seed] disabled; no database records changed");
    client.close();
    return;
  }
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_nakhl_migrations'");
  for (const { name } of tables.rows) {
    const quoted = String(name).replace(/"/g, '""');
    if (Number((await client.execute(`SELECT COUNT(*) AS n FROM "${quoted}"`)).rows[0].n) > 0) {
      client.close();
      throw new Error("Admin bootstrap is allowed only on an entirely empty installation; existing data preserved");
    }
  }

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
