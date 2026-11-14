// Isolated tests only. Never read NAKHL_SQLITE_PATH from the host.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { snapshotData, assertDataUnchanged } from './data-integrity.mjs';
const dir = dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'nakhl-preservation-'));
const dbPath = join(temp, 'test.db');
const migrations = join(temp, 'migrations');
const env = {...process.env, NAKHL_SQLITE_PATH: dbPath, NAKHL_MIGRATIONS_DIR: migrations, NAKHL_DATA_DIR: temp};
const run = script => spawnSync(process.execPath, [join(dir, script)], {env, encoding:'utf8'});
let db;
try {
  await mkdir(migrations);
  db = createClient({url:`file:${dbPath}`});
  await db.executeMultiple(`CREATE TABLE business (id TEXT PRIMARY KEY, value BLOB); INSERT INTO business VALUES ('real', x'0102');`);
  const before = await snapshotData(db);
  // A failed migration must leave neither changed data nor a completion record.
  for (const sql of [
    "INSERT INTO business VALUES ('demo', x'0304');",
    "DELETE FROM business;",
    "UPDATE business SET value=x'0304';", // same-length BLOB substitution
    "DROP TABLE business;",
    "ALTER TABLE business DROP COLUMN value;",
    "CREATE TABLE demo (id TEXT); INSERT INTO demo VALUES ('sample');",
  ]) {
    await writeFile(join(migrations,'0001_bad.sql'), sql);
    const result = run('migrate.mjs');
    assert.notEqual(result.status, 0, `Unsafe migration accepted: ${sql}`);
    await assertDataUnchanged(db, before);
    assert.equal((await db.execute('SELECT * FROM _nakhl_migrations')).rows.length, 0);
  }
  await writeFile(join(migrations,'0001_bad.sql'), 'ALTER TABLE business ADD COLUMN optional TEXT;');
  for (let i=0;i<3;i++) {
    const result = run('migrate.mjs');
    assert.equal(result.status, 0, result.stderr);
    const seed = run('seed.mjs');
    assert.equal(seed.status, 0, seed.stderr);
    await assertDataUnchanged(db, before);
  }
  // Even an explicit bootstrap cannot insert accounts into a populated site.
  env.NAKHL_BOOTSTRAP_ADMIN='1';
  assert.notEqual(run('seed.mjs').status, 0);
  await assertDataUnchanged(db, before);
  console.log('PASS: insertion/deletion/update/drop rejected and rolled back; additive upgrade and repeated startup preserve every value; bootstrap refuses populated data.');
} finally { db?.close(); await rm(temp,{recursive:true,force:true}); }
