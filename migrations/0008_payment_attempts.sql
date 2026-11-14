-- Empty bookkeeping table only; existing orders are not backfilled or modified.
CREATE TABLE "PaymentAttempt" (
 "authority" TEXT NOT NULL PRIMARY KEY,
 "orderId" TEXT NOT NULL,
 "merchantId" TEXT NOT NULL,
 "sandbox" BOOLEAN NOT NULL DEFAULT false,
 "amountToman" INTEGER NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PaymentAttempt_orderId_idx" ON "PaymentAttempt"("orderId");
