/**
 * Nakhl Restaurant — D1 admin bootstrap (Cloudflare path)
 * --------------------------------------------------------
 * Creates the first administrator account on a Cloudflare D1 database
 * (local Miniflare or remote) from ENVIRONMENT credentials — never from
 * anything committed to the repository.
 *
 * Usage:
 *   ADMIN_USERNAME=myadmin ADMIN_PASSWORD='strong-pass' \
 *     bun run db:admin:local     # → wrangler d1 execute DB --local
 *   ADMIN_USERNAME=myadmin ADMIN_PASSWORD='strong-pass' \
 *     bun run db:admin:remote    # → wrangler d1 execute DB --remote
 *
 * Behaviour (mirrors docker/seed.mjs exactly):
 *   • If ANY admin already exists → prints "preserved" and exits 0
 *     (redeploys never touch live credentials).
 *   • ADMIN_PASSWORD missing/short → a strong random password is generated,
 *     used, and printed ONCE to stdout (nothing is written to the repo).
 *   • Password hashing mirrors src/lib/auth.ts (scrypt, 16-byte hex salt,
 *     64-byte key, "salt:hash").
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const MODE = process.argv[2] === "--remote" ? "remote" : "local";
const FLAG = MODE === "remote" ? "--remote" : "--local";

const username = process.env.ADMIN_USERNAME || "nakhl-admin";
let password = process.env.ADMIN_PASSWORD;
let generated = false;
if (!password || password.length < 8) {
  if (password) console.warn("⚠ ADMIN_PASSWORD کوتاه‌تر از ۸ کاراکتر است — رمز تصادفی قوی ساخته می‌شود");
  password = crypto.randomBytes(12).toString("base64url");
  generated = true;
}

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function d1(sql: string): string {
  return execFileSync("bunx", ["wrangler", "d1", "execute", "DB", FLAG, "--command", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

try {
  const countOut = d1('SELECT COUNT(*) AS n FROM "AdminUser"');
  const match = countOut.match(/\|\s*n\s*\|\s*(\d+)/);
  const count = match ? Number(match[1]) : 0;
  if (count > 0) {
    console.log(`[admin] ✓ ${count} ادمین موجود دارد — حفظ شد، دست زده نشد (${MODE})`);
    process.exit(0);
  }

  const id = `admin-${crypto.randomBytes(8).toString("hex")}`;
  const hash = hashPassword(password);
  d1(
    `INSERT INTO "AdminUser" ("id", "username", "passwordHash", "displayName", "failedAttempts") ` +
      `VALUES ('${id.replaceAll("'", "''")}', '${username.replaceAll("'", "''")}', ` +
      `'${hash}', 'مدیر رستوران نخل', 0)`,
  );
  console.log(`[admin] ✓ ادمین ساخته شد (${MODE}): ${username}`);
  if (generated) {
    console.log(`[admin] ⚠ ADMIN_PASSWORD تنظیم نشده بود — رمز تصادفی (فقط همین‌جا نمایش داده می‌شود):`);
    console.log(`[admin]   ${password}`);
    console.log(`[admin]   آن را یادداشت کنید و بلافاصله از پنل /nk-admin رمز جدیدی انتخاب کنید.`);
  } else {
    console.log(`[admin]   (رمز از ADMIN_PASSWORD env خوانده شد — آن را از محیط حذف کنید)`);
  }
} catch (e) {
  console.error(`[admin] ✗ خطا در ساخت ادمین روی D1 (${MODE}):`, e instanceof Error ? e.message : e);
  process.exit(1);
}
