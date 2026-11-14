-- 0007: Customer metadata snapshots on orders (phone + name).
-- ---------------------------------------------------------------------------
-- Rationale (owner directive): the admin orders view and the Baran invoice
-- feed must carry the customer's phone number and full name exactly as they
-- were at order time. Storing snapshots on the Order row keeps historical
-- orders truthful even if the customer later edits their profile.
--
-- Safety: purely additive — two nullable columns, no table rebuild, no data
-- loss. Existing rows keep NULL; readers fall back to the live User record
-- (`order.customerPhone ?? order.user.phone`), and a one-shot backfill is
-- performed in code on first read of the admin orders feed (see
-- src/app/api/admin/orders/route.ts) so old orders display correctly too.
--
-- Applies identically on Cloudflare D1 (wrangler d1 migrations apply)
-- and Docker/VPS (docker/migrate.mjs — forward-only, transactional).

ALTER TABLE "Order" ADD COLUMN "customerPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerName" TEXT;
