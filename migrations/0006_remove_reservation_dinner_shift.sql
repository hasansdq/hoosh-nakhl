-- Data-preserving replacement for installations which have not applied 0006.
-- Keep Reservation and Order.scheduledFor as archival data; current app ignores them.
-- Already-applied installations are not replayed or restored by this file.
ALTER TABLE "Category" ADD COLUMN "dinnerOnly" BOOLEAN NOT NULL DEFAULT false;
