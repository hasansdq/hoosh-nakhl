-- Baran accounting software integration (api/ApiServiceBaran)
-- ---------------------------------------------------------------------------
-- • MenuItem/Category/Order/User gain nullable Baran linkage columns
--   (nullable = fully backward compatible; unique indexes allow NULLs).
-- • New tables: BaranSyncLog (per-call API report) and BaranAsset
--   (product pictures received via SENDPics, matched by file name).
-- Applies identically on Cloudflare D1 (wrangler d1 migrations apply)
-- and Docker/VPS (docker/migrate.mjs — forward-only, transactional).

-- MenuItem — link to Baran product (ProductId)
ALTER TABLE "MenuItem" ADD COLUMN "baranProductId" INTEGER;
ALTER TABLE "MenuItem" ADD COLUMN "baranPictureName" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN "baranUnit" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN "baranSyncedAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_baranProductId_key" ON "MenuItem"("baranProductId");

-- Category — link to Baran group (sub-group or main-group per setting)
ALTER TABLE "Category" ADD COLUMN "baranGroupId" INTEGER;
ALTER TABLE "Category" ADD COLUMN "baranMainGroupId" INTEGER;

-- CreateIndex
CREATE INDEX "Category_baranGroupId_idx" ON "Category"("baranGroupId");

-- Order — numeric factor number for Baran + "confirmed received" flag
ALTER TABLE "Order" ADD COLUMN "baranFactorNumber" INTEGER;
ALTER TABLE "Order" ADD COLUMN "baranSentAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "Order_baranFactorNumber_key" ON "Order"("baranFactorNumber");
CREATE INDEX "Order_baranSentAt_idx" ON "Order"("baranSentAt");

-- User — numeric customer id for Baran (must be > 500000 per the docs)
ALTER TABLE "User" ADD COLUMN "baranCustomerId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "User_baranCustomerId_key" ON "User"("baranCustomerId");

-- CreateTable (BaranSyncLog)
CREATE TABLE "BaranSyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "method" TEXT NOT NULL,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "okCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "BaranSyncLog_createdAt_idx" ON "BaranSyncLog"("createdAt");

-- CreateTable (BaranAsset)
CREATE TABLE "BaranAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "linkedMenuItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "BaranAsset_fileName_key" ON "BaranAsset"("fileName");
CREATE INDEX "BaranAsset_linkedMenuItemId_idx" ON "BaranAsset"("linkedMenuItemId");
