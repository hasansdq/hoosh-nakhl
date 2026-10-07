-- Remove table reservations + scheduled (pre-order) delivery, add dinner-only shift categories
-- ---------------------------------------------------------------------------
-- Owner directive: the رزرو میز (table reservation) module and the
-- تحویل زمان‌بندی‌شده (scheduled / pre-order delivery) option are removed
-- entirely. New: Category.dinnerOnly — categories whose foods are only
-- orderable during the dinner shift (سرویس شام).
--
-- NOTE: this migration is intentionally DESTRUCTIVE (drops the Reservation
-- table and the Order.scheduledFor column) per explicit owner instruction.
-- Applies identically on Cloudflare D1 (wrangler d1 migrations apply)
-- and Docker/VPS (docker/migrate.mjs — forward-only, transactional).

-- DropTable (module removed)
DROP TABLE IF EXISTS "Reservation";

-- RedefineTables (SQLite: rebuild Order without scheduledFor)
CREATE TABLE "new_Order" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "orderNumber"     TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "type"            TEXT NOT NULL,
    "status"          TEXT NOT NULL,
    "address"         TEXT,
    "note"            TEXT,
    "subtotal"        INTEGER NOT NULL,
    "deliveryFee"     INTEGER NOT NULL DEFAULT 0,
    "taxRate"         REAL NOT NULL DEFAULT 0.1,
    "taxAmount"       INTEGER NOT NULL DEFAULT 0,
    "discount"        INTEGER NOT NULL DEFAULT 0,
    "couponCode"      TEXT,
    "total"           INTEGER NOT NULL,
    "paymentStatus"   TEXT NOT NULL DEFAULT 'PENDING',
    "paymentAuthority" TEXT,
    "paymentRef"      TEXT,
    "paymentCard"     TEXT,
    "paymentError"    TEXT,
    "paidAt"          DATETIME,
    "baranFactorNumber" INTEGER,
    "baranSentAt"     DATETIME,
    "createdAt"       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME NOT NULL,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_couponCode_fkey" FOREIGN KEY ("couponCode") REFERENCES "Coupon" ("code") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" (
    "id", "orderNumber", "userId", "type", "status", "address", "note",
    "subtotal", "deliveryFee", "taxRate", "taxAmount", "discount", "couponCode",
    "total", "paymentStatus", "paymentAuthority", "paymentRef", "paymentCard",
    "paymentError", "paidAt", "baranFactorNumber", "baranSentAt", "createdAt", "updatedAt"
)
SELECT
    "id", "orderNumber", "userId", "type", "status", "address", "note",
    "subtotal", "deliveryFee", "taxRate", "taxAmount", "discount", "couponCode",
    "total", "paymentStatus", "paymentAuthority", "paymentRef", "paymentCard",
    "paymentError", "paidAt", "baranFactorNumber", "baranSentAt", "createdAt", "updatedAt"
FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order" ("orderNumber");
CREATE INDEX "Order_userId_createdAt_idx" ON "Order" ("userId", "createdAt");
CREATE INDEX "Order_status_idx" ON "Order" ("status");
CREATE INDEX "Order_paymentAuthority_idx" ON "Order" ("paymentAuthority");
CREATE INDEX "Order_baranSentAt_idx" ON "Order" ("baranSentAt");
CREATE UNIQUE INDEX "Order_baranFactorNumber_key" ON "Order" ("baranFactorNumber");

-- AlterTable: dinner-only shift flag on categories
ALTER TABLE "Category" ADD COLUMN "dinnerOnly" BOOLEAN NOT NULL DEFAULT false;
