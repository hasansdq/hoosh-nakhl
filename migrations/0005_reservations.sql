-- Table reservations (رزرو میز)
-- ---------------------------------------------------------------------------
-- New Reservation model — customer-facing table booking with admin workflow
-- (PENDING → CONFIRMED → SEATED / CANCELED / NO_SHOW).
-- Applies identically on Cloudflare D1 (wrangler d1 migrations apply)
-- and Docker/VPS (docker/migrate.mjs — forward-only, transactional).

-- CreateTable
CREATE TABLE "Reservation" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "code"        TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "guestName"   TEXT NOT NULL,
    "guestPhone"  TEXT NOT NULL,
    "partySize"   INTEGER NOT NULL,
    "slotStart"   DATETIME NOT NULL,
    "slotLabel"   TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'PENDING',
    "tableNumber" INTEGER,
    "note"        TEXT,
    "canceledAt"  DATETIME,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_code_key" ON "Reservation" ("code");

-- CreateIndex
CREATE INDEX "Reservation_slotStart_idx" ON "Reservation" ("slotStart");

-- CreateIndex
CREATE INDEX "Reservation_userId_createdAt_idx" ON "Reservation" ("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Reservation_status_slotStart_idx" ON "Reservation" ("status", "slotStart");
