#!/usr/bin/env node
// Prove schema changes roll back when recording a migration fails, and that
// restarting after recovery does not apply a completed migration twice.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";

const temp = await mkdtemp(join(tmpdir(), "nakhl-migration-test-"));
const dbPath = join(temp, "test.db");
const migrations = join(temp, "migrations");
const runner = join(dirname(fileURLToPath(import.meta.url)), "migrate.mjs");
const run = () => spawnSync(process.execPath, [runner], {
  env: { ...process.env, NAKHL_SQLITE_PATH: dbPath, NAKHL_MIGRATIONS_DIR: migrations },
  encoding: "utf8",
});
let client;
try {
  await mkdir(migrations);
  await writeFile(join(migrations, "0001_test.sql"), 'CREATE TABLE preserved (id INTEGER PRIMARY KEY);');
  client = createClient({ url: `file:${dbPath}` });
  await client.executeMultiple(`
    CREATE TABLE _nakhl_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TRIGGER reject_record BEFORE INSERT ON _nakhl_migrations
    BEGIN SELECT RAISE(ABORT, 'forced recording failure'); END;
  `);
  client.close();
  const failed = run();
  assert.notEqual(failed.status, 0, "forced recording failure must stop boot");
  client = createClient({ url: `file:${dbPath}` });
  assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name='preserved'")).rows.length, 0, "DDL must roll back with the completion record");
  assert.equal((await client.execute("SELECT * FROM _nakhl_migrations")).rows.length, 0);
  await client.execute("DROP TRIGGER reject_record");
  client.close();
  for (let i = 0; i < 2; i++) {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
  }
  client = createClient({ url: `file:${dbPath}` });
  assert.equal((await client.execute("SELECT * FROM preserved")).rows.length, 0);
  assert.equal((await client.execute("SELECT * FROM _nakhl_migrations")).rows.length, 1);
  console.log("PASS: failed completion record rolls back schema; recovery and restart apply migration once.");
} finally {
  client?.close();
  await rm(temp, { recursive: true, force: true });
}
