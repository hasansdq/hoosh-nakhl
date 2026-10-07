-- Nakhl AI upgrade — conversation history sidebar + order-context awareness
-- ---------------------------------------------------------------------------
-- • ChatSession gains a nullable `title` column: auto-generated from the first
--   user message (server-side, ~48 chars) and editable by the user via
--   PATCH /api/chat/session. NULL = legacy rows → UI falls back to
--   «گفتگو …» + date label.
-- Applies identically on Cloudflare D1 (wrangler d1 migrations apply)
-- and Docker/VPS (docker/migrate.mjs — forward-only, transactional).

ALTER TABLE "ChatSession" ADD COLUMN "title" TEXT;
