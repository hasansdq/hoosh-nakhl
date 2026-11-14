#!/usr/bin/env node
/**
 * Nakhl Restaurant — pre-deploy UPGRADE test (Docker / VPS)
 * ----------------------------------------------------------------
 * Simulates a REAL production upgrade on a database that already contains
 * live orders, then proves the new migration(s) preserved every row.
 *
 *   1. builds a throwaway SQLite database at the PREVIOUS schema state
 *      (all migrations except the newest ones — run through the REAL
 *      docker/migrate.mjs, so the tracking table matches production);
 *   2. seeds realistic data: users, addresses, categories, menu items,
 *      coupons, three orders (paid + pending + confirmed) with items and
 *      status logs, a review, chat session/messages, and — when the base
 *      schema still has them — reservations and a scheduled delivery time;
 *   3. snapshots a SHA-256 digest of every preserved table;
 *   4. applies the remaining migration(s) via the REAL docker/migrate.mjs
 *      (the exact runner the container entrypoint uses);
 *   5. verifies: row counts + digests unchanged, dropped structures gone,
 *      new columns present, foreign_key_check clean.
 *
 * Usage (from the repo root, or inside the container):
 *   node docker/upgrade-test.mjs [--keep]
 *     --keep  keep the temporary database for manual inspection
 *
 * Exit codes: 0 = upgrade is data-safe ✓ · 1 = DATA LOSS DETECTED — do NOT deploy.
 *
 * NOTE for future migrations: when a migration intentionally drops tables or
 * columns, extend STRUCTURAL_CHANGES below so this harness keeps matching
 * reality (everything not listed there MUST survive bit-for-bit).
 */
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import os from "node:os";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = process.env.NAKHL_MIGRATIONS_DIR ?? join(SCRIPT_DIR, "..", "migrations");
const MIGRATE_SCRIPT = join(SCRIPT_DIR, "migrate.mjs");
const KEEP = process.argv.includes("--keep");
const LEGACY6 = process.argv.includes("--legacy-6");

// ============================================================================
// Per-upgrade expectations — THE ONLY section to touch when a new destructive
// migration lands. Everything not mentioned here must survive unchanged.
// ============================================================================
const STRUCTURAL_CHANGES = {
  // tables the upgrade intentionally DROPS (data is lost by design):
  droppedTables: [],
  // columns the upgrade intentionally drops, per table:
  droppedColumns: {},
  // columns the upgrade ADDS, per table (checked for existence only):
  addedColumns: { Category: ["dinnerOnly"], Order: ["customerPhone", "customerName"] },
};

// tables whose data must survive the upgrade bit-for-bit:
const PRESERVED_TABLES = [
  "AdminUser", "User", "Address", "Session", "Category", "MenuItem",
  "Coupon", "Order", "OrderItem", "OrderStatusLog",
  "ChatSession", "ChatMessage", "Review", "AuditLog", "Reservation",
];

function fatal(msg) {
  console.error(`\n[upgrade-test] ✗ ${msg}`);
  process.exit(1);
}
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Run the REAL migrate.mjs against a chosen migrations dir + database. */
function runMigrator(sqlitePath, migrationsDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MIGRATE_SCRIPT], {
      env: { ...process.env, NAKHL_SQLITE_PATH: sqlitePath, NAKRL_DATA_DIR: undefined, NAKHL_MIGRATIONS_DIR: migrationsDir },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`migrate.mjs exited ${code}`))));
    child.on("error", reject);
  });
}

async function columnsOf(client, table) {
  const res = await client.execute(`PRAGMA table_info("${table}")`);
  return res.rows.map((r) => String(r.name));
}
async function tableExists(client, table) {
  const res = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${table.replace(/'/g, "''")}'`,
  );
  return res.rows.length > 0;
}

/** Canonical SHA-256 digest of a table (given column list), ordered by id. */
async function digestTable(client, table, columns) {
  if (columns.length === 0) return { count: 0, digest: "-" };
  const colSel = columns.map((c) => `"${c}"`).join(", ");
  const res = await client.execute(`SELECT ${colSel} FROM "${table}" ORDER BY "id"`);
  const canon = res.rows
    .map((row) => columns.map((c) => {
      const v = row[c];
      if (v == null) return "null";
      if (typeof v === "object" && v.byteLength != null) return `blob:${v.byteLength}`; // BLOB → length only
      return `${typeof v === "number" ? "n" : "s"}:${v}`;
    }).join("\u0001"))
    .join("\u0002");
  return { count: res.rows.length, digest: sha(canon) };
}

async function main() {
  console.log("════════════════════════════════════════════════════════════════");
  console.log("  نخل — تست ارتقای دیتابیس پیش از دیپلوی (شبیه‌سازی کامل)");
  console.log("  pre-deploy upgrade simulation on a populated database");
  console.log("════════════════════════════════════════════════════════════════\n");

  // ---- discover migrations; split into "base" (previous version) + upgrade
  const MIGRATION_FILE_RE = /^\d{4}_.*\.sql$/i;
  const all = (await readdir(MIGRATIONS_DIR)).filter((f) => MIGRATION_FILE_RE.test(f)).sort();
  if (all.length < 2) fatal("need at least 2 migrations to simulate an upgrade");
  const baseFiles = all.slice(0, LEGACY6 ? 6 : 5);
  const upgradeFiles = all.slice(LEGACY6 ? 6 : 5);
  console.log(`[upgrade-test] نسخهٔ فعلی استقرار (base): ${baseFiles[baseFiles.length - 1]}`);
  console.log(`[upgrade-test] مایگریشن تحت تست ارتقا:     ${upgradeFiles.join(", ")}\n`);

  // ---- temp workspace
  const tmp = await mkdtemp(join(os.tmpdir(), "nakhl-upgrade-"));
  const dbPath = join(tmp, "test.db");
  const baseDir = join(tmp, "base-migrations");
  await mkdir(baseDir);
  for (const f of baseFiles) await cp(join(MIGRATIONS_DIR, f), join(baseDir, f));

  try {
    // ---- phase 1: previous deployment state
    await runMigrator(dbPath, baseDir);
    console.log("[upgrade-test] ✓ حالت پایه (نسخهٔ قبلی) ساخته شد\n");

    // Reproduce an already-deployed historical 0006 schema in disposable data.
    if (LEGACY6) {
      const legacy = createClient({ url: `file:${dbPath}` });
      await legacy.executeMultiple('DROP TABLE "Reservation"; ALTER TABLE "Order" DROP COLUMN "scheduledFor";');
      legacy.close();
    }

    // ---- phase 2: seed a busy restaurant database
    const client = createClient({ url: `file:${dbPath}` });
    const now = new Date().toISOString();
    const hasReservations = await tableExists(client, "Reservation");
    const orderCols = await columnsOf(client, "Order");
    const hasScheduledFor = orderCols.includes("scheduledFor");
    console.log(`[upgrade-test] base schema: Reservation=${hasReservations ? "موجود" : "ندارد"}, Order.scheduledFor=${hasScheduledFor ? "موجود" : "ندارد"}`);

    await client.executeMultiple(`
      INSERT INTO "AdminUser" ("id","username","passwordHash","displayName") VALUES ('a1','boss','x:y','مدیر تست');
      INSERT INTO "User" ("id","phone","firstName","lastName","updatedAt") VALUES
        ('u1','989131112223','زهرا','کریمی','${now}'),
        ('u2','989133334445','علی','محمدی','${now}');
      INSERT INTO "Address" ("id","userId","title","fullAddress","postalCode") VALUES
        ('ad1','u1','خانه','رفسنجان، خیابان ابن‌سینا ۱۲','۷۷۳۱۱۱۱۱۱۱'),
        ('ad2','u2','کارگاه','رفسنجان، بلوار شهریار ۳','۷۷۳۲۲۲۲۲۲۲');
      INSERT INTO "Category" ("id","name","slug","sortOrder") VALUES
        ('c1','کباب‌ها','kebab',1), ('c2','خورشت‌ها','khoresh',2);
      INSERT INTO "MenuItem" ("id","name","price","categoryId","updatedAt") VALUES
        ('m1','کباب کوبیده',320000,'c1','${now}'),
        ('m2','جوجه کباب با استخوان',380000,'c1','${now}'),
        ('m3','قورمه‌سبزی',280000,'c2','${now}'),
        ('m4','خورش قیمه',260000,'c2','${now}');
      INSERT INTO "Coupon" ("id","code","title","type","value","updatedAt") VALUES
        ('cp1','NAKHL10','ده درصد تخفیف','PERCENT',10,'${now}'),
        ('cp2','WELCOME','بازگشت مشتری','AMOUNT',50000,'${now}');
      INSERT INTO "Session" ("id","userId","token","expiresAt") VALUES ('s1','u1','tok-abc','2099-01-01T00:00:00.000Z');
      INSERT INTO "ChatSession" ("id","userId","updatedAt") VALUES ('cs1','u1','${now}');
      INSERT INTO "ChatMessage" ("id","sessionId","role","content") VALUES
        ('cm1','cs1','USER','سلام'),
        ('cm2','cs1','ASSISTANT','سلام! به نخل خوش آمدید'),
        ('cm3','cs1','USER','یک کوبیده می‌خوام');
    `);

    // three orders — the payload that must survive the upgrade untouched
    await client.executeMultiple(`
      INSERT INTO "Order" ("id","orderNumber","userId","type","status","address","subtotal","deliveryFee","taxRate","taxAmount","discount","couponCode","total","paymentStatus","paymentAuthority","paidAt","baranFactorNumber","createdAt","updatedAt")
        VALUES ('o1','NK-TEST001','u1','DELIVERY','DELIVERED','رفسنجان، ابن‌سینا ۱۲',640000,50000,0.1,64000,0,NULL,754000,'PAID','AUTH-1','2025-01-02T12:00:00.000Z',1001,'2025-01-02T11:00:00.000Z','2025-01-02T13:00:00.000Z');
      INSERT INTO "Order" ("id","orderNumber","userId","type","status","address","subtotal","deliveryFee","taxRate","taxAmount","discount","couponCode","total","paymentStatus","createdAt","updatedAt")
        VALUES ('o2','NK-TEST002','u2','DELIVERY','PENDING','رفسنجان، شهریار ۳',280000,50000,0.1,28000,0,NULL,358000,'PENDING','2025-01-03T18:00:00.000Z','2025-01-03T18:05:00.000Z');
      INSERT INTO "Order" ("id","orderNumber","userId","type","status","address","subtotal","deliveryFee","taxRate","taxAmount","discount","couponCode","total","paymentStatus","baranSentAt","createdAt","updatedAt")
        VALUES ('o3','NK-TEST003','u1','DELIVERY','CONFIRMED','رفسنجان، ابن‌سینا ۱۲',300000,50000,0.1,30000,30000,'NAKHL10',350000,'PENDING','2025-01-04T19:30:00.000Z','2025-01-04T19:00:00.000Z','2025-01-04T19:10:00.000Z');
    `);
    if (hasScheduledFor) {
      await client.execute(`UPDATE "Order" SET "scheduledFor"='2025-01-05T12:30:00.000Z' WHERE "id"='o2'`);
    }
    await client.executeMultiple(`
      INSERT INTO "OrderItem" ("id","orderId","menuItemId","name","unitPrice","quantity","lineTotal") VALUES
        ('oi1','o1','m1','کباب کوبیده',320000,2,640000),
        ('oi2','o2','m3','قورمه‌سبزی',280000,1,280000),
        ('oi3','o3','m2','جوجه کباب با استخوان',380000,1,380000),
        ('oi4','o3','m4','خورش قیمه',260000,1,260000);
      INSERT INTO "OrderStatusLog" ("id","orderId","status","note","createdAt") VALUES
        ('sl1','o1','PENDING','ثبت شد','2025-01-02T11:00:00.000Z'),
        ('sl2','o1','CONFIRMED','تأیید اپراتور','2025-01-02T11:02:00.000Z'),
        ('sl3','o1','PREPARING','در آشپزخانه','2025-01-02T11:10:00.000Z'),
        ('sl4','o1','DELIVERED','تحویل شد','2025-01-02T13:00:00.000Z'),
        ('sl5','o2','PENDING','ثبت شد','2025-01-03T18:00:00.000Z'),
        ('sl6','o3','PENDING','ثبت شد','2025-01-04T19:00:00.000Z'),
        ('sl7','o3','CONFIRMED','تأیید شد','2025-01-04T19:10:00.000Z');
      INSERT INTO "Review" ("id","userId","orderId","menuItemId","rating","comment","status") VALUES
        ('r1','u1','o1','m1',5,'عالی بود','APPROVED');
      INSERT INTO "AuditLog" ("id","actor","action") VALUES ('al1','boss','TEST_SEED');
    `);
    if (hasReservations) {
      await client.executeMultiple(`
        INSERT INTO "Reservation" ("id","code","userId","guestName","guestPhone","partySize","slotStart","slotLabel","status","tableNumber","updatedAt") VALUES
          ('rz1','RSV-001','u1','زهرا کریمی','09131112223',4,'2025-01-06T20:00:00.000Z','۲۰:۰۰','CONFIRMED',5,'${now}'),
          ('rz2','RSV-002','u2','علی محمدی','09133334445',2,'2025-01-07T21:00:00.000Z','۲۱:۰۰','PENDING',NULL,'${now}');
      `);
      console.log("[upgrade-test] ✓ ۲ رزرو میز + ۱ زمان تحویل زمان‌بندی‌شده seed شد (همه باید حفظ شوند)");
    }
    console.log(`[upgrade-test] ✓ دیتای واقع‌گرایانه seed شد: ۲ کاربر، ۳ سفارش، ${hasReservations ? "۲ رزرو، " : ""}۴ قلم سفارش، ۷ لاگ وضعیت، ۱ نظر\n`);

    // ---- phase 3: snapshot digests of everything that must survive
    const before = {};
    for (const t of PRESERVED_TABLES.filter(t => t !== "Reservation" || hasReservations)) {
      const cols = (await columnsOf(client, t)).filter(
        (c) => !(STRUCTURAL_CHANGES.droppedColumns[t] ?? []).includes(c),
      );
      before[t] = { cols, ...(await digestTable(client, t, cols)) };
    }
    client.close();

    // ---- phase 4: THE UPGRADE — real runner, real migrations dir
    console.log("[upgrade-test] ▶ اعمال مایگریشن ارتقا (همان runner واقعی کانتینر)…\n");
    await runMigrator(dbPath, MIGRATIONS_DIR);

    // ---- phase 5: verify
    const verify = createClient({ url: `file:${dbPath}` });
    let failures = 0;
    const report = [];

    for (const t of PRESERVED_TABLES.filter(t => t !== "Reservation" || hasReservations)) {
      const exists = await tableExists(verify, t);
      if (!exists) {
        report.push(`✗✗✗ جدول ${t} ناپدید شده است!`);
        failures++;
        continue;
      }
      const after = await digestTable(verify, t, before[t].cols);
      const ok = after.count === before[t].count && after.digest === before[t].digest;
      report.push(`${ok ? "✓" : "✗✗✗"} ${t}: ${after.count} ردیف — دیجست ${after.digest} ${ok ? "(ماندگار)" : `≠ ${before[t].digest} — از دست رفته!`}`);
      if (!ok) failures++;
    }

    for (const t of STRUCTURAL_CHANGES.droppedTables) {
      const exists = await tableExists(verify, t);
      report.push(`${!exists ? "✓" : "✗"} جدول ${t} ${!exists ? "طبق دستور حذف شد" : "هنوز موجود است (باید حذف می‌شد)"}`);
      if (exists) failures++;
    }
    for (const [t, cols] of Object.entries(STRUCTURAL_CHANGES.droppedColumns)) {
      const now2 = await columnsOf(verify, t);
      const gone = cols.every((c) => !now2.includes(c));
      report.push(`${gone ? "✓" : "✗"} ستون‌های حذف‌شدهٔ ${t} (${cols.join(", ")}): ${gone ? "حذف شدند" : "هنوز موجودند!"}`);
      if (!gone) failures++;
    }
    for (const [t, cols] of Object.entries(STRUCTURAL_CHANGES.addedColumns)) {
      const now2 = await columnsOf(verify, t);
      const present = cols.every((c) => now2.includes(c));
      report.push(`${present ? "✓" : "✗"} ستون‌های جدید ${t} (${cols.join(", ")}): ${present ? "اضافه شدند" : "یافت نشدند!"}`);
      if (!present) failures++;
    }

    const fk = await verify.execute("PRAGMA foreign_key_check");
    report.push(`${fk.rows.length === 0 ? "✓" : "✗"} foreign_key_check: ${fk.rows.length === 0 ? "پاک — سلامت ارجاعی تأیید شد" : `${fk.rows.length} نقض!`}`);
    if (fk.rows.length > 0) failures++;

    console.log("\n────────────────── گزارش راستی‌آزمایی ──────────────────");
    for (const line of report) console.log("  " + line);
    console.log("─────────────────────────────────────────────────────");

    verify.close();
    if (failures > 0) {
      fatal(`${failures} بررسی شکست خورد — DATA LOSS! تا رفع مشکل دیپلوی نکنید. (دیتابیس آزمایشی: ${KEEP ? dbPath : "حذف شد"})`);
    }
    console.log(`\n[upgrade-test] ✓✓ ارتقا data-safe است: همهٔ سفارش‌ها/اقلام/لاگ‌ها/نظرات سالم ماندند.`);
    console.log(`[upgrade-test] حالا می‌توانید روی VPS: bash docker/update.sh\n`);
  } finally {
    if (!KEEP) await rm(tmp, { recursive: true, force: true }).catch(() => {});
    else console.log(`[upgrade-test] --keep: دیتابیس آزمایشی نگه داشته شد: ${tmp}`);
  }
}

main().catch((e) => fatal(e.stack ?? e.message));
