// T-F02 — server-db.js (CJS)의 nanobotAgentSessions schema 정의 정합성.
// schema.ts (TS) 정의와 컬럼 shape가 일치하고, SQLite 모드에서 실제로
// INSERT/SELECT가 동작하는지 검증한다.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

function setupSqliteServerDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-server-db-nano-"));
  const sqlitePath = path.join(tempDir, "nano.sqlite");

  process.env.DB_TYPE = "sqlite";
  process.env.SQLITE_PATH = sqlitePath;

  const modulePath = require.resolve("./server-db.js");
  delete require.cache[modulePath];

  return require("./server-db.js") as {
    db: unknown;
    schema: Record<string, unknown>;
    ensureSqliteCompatibility: (sqlite: Database.Database) => void;
  };
}

test("server-db schema exports nanobotAgentSessions (CJS parity with schema.ts)", () => {
  const { schema } = setupSqliteServerDb();
  assert.ok(schema.nanobotAgentSessions, "schema.nanobotAgentSessions should be exported");
});

test("ensureSqliteCompatibility creates nanobot_agent_sessions table + indexes", () => {
  const { ensureSqliteCompatibility } = setupSqliteServerDb();

  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  // RBAC bootstrap이 npcs 테이블을 요구하므로 minimal stub 생성
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      login_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE channels (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      owner_id TEXT
    );
    CREATE TABLE npcs (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position_x INTEGER NOT NULL,
      position_y INTEGER NOT NULL,
      appearance TEXT NOT NULL,
      openclaw_config TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      channel_id TEXT NOT NULL,
      npc_id TEXT NOT NULL,
      assigner_id TEXT NOT NULL,
      npc_task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);

  ensureSqliteCompatibility(sqlite);

  const tableRow = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nanobot_agent_sessions'")
    .get();
  assert.ok(tableRow, "nanobot_agent_sessions table should be created");

  const columns = sqlite.prepare("PRAGMA table_info(nanobot_agent_sessions)").all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>;
  const columnNames = columns.map((c) => c.name).sort();
  assert.deepEqual(columnNames, [
    "aborted_at",
    "agent_id",
    "id",
    "last_chunk_at",
    "npc_id",
    "session_key",
    "started_at",
    "timeout_ms",
    "total_tokens",
  ]);

  const timeoutCol = columns.find((c) => c.name === "timeout_ms");
  assert.equal(timeoutCol?.notnull, 1);
  assert.equal(timeoutCol?.dflt_value, "180000");

  const indexes = sqlite.prepare("PRAGMA index_list(nanobot_agent_sessions)").all() as Array<{ name: string; unique: number }>;
  const uniqueIdx = indexes.find((i) => i.name === "nanobot_agent_sessions_agent_session_unique");
  assert.ok(uniqueIdx, "unique index on (agent_id, session_key) should exist");
  assert.equal(uniqueIdx?.unique, 1);
});

test("nanobot_agent_sessions INSERT/SELECT cycle works with all columns", () => {
  const { ensureSqliteCompatibility } = setupSqliteServerDb();
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, login_id TEXT NOT NULL, nickname TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, owner_id TEXT);
    CREATE TABLE npcs (id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL, name TEXT NOT NULL, position_x INTEGER NOT NULL, position_y INTEGER NOT NULL, appearance TEXT NOT NULL, openclaw_config TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL, npc_id TEXT NOT NULL, assigner_id TEXT NOT NULL, npc_task_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL);
    INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config) VALUES ('npc-1', 'ch-1', 'Alice', 0, 0, '{}', '{}');
  `);
  ensureSqliteCompatibility(sqlite);

  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO nanobot_agent_sessions (id, npc_id, agent_id, session_key, started_at, last_chunk_at, timeout_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("sess-1", "npc-1", "npc-1", "agent:npc-1:greeting", now, now, 180000);

  const row = sqlite.prepare("SELECT * FROM nanobot_agent_sessions WHERE id = ?").get("sess-1") as Record<string, unknown>;
  assert.equal(row.agent_id, "npc-1");
  assert.equal(row.session_key, "agent:npc-1:greeting");
  assert.equal(row.timeout_ms, 180000);
  assert.equal(row.aborted_at, null);
});

test("unique index rejects duplicate (agent_id, session_key)", () => {
  const { ensureSqliteCompatibility } = setupSqliteServerDb();
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, login_id TEXT NOT NULL, nickname TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, owner_id TEXT);
    CREATE TABLE npcs (id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL, name TEXT NOT NULL, position_x INTEGER NOT NULL, position_y INTEGER NOT NULL, appearance TEXT NOT NULL, openclaw_config TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY NOT NULL, channel_id TEXT NOT NULL, npc_id TEXT NOT NULL, assigner_id TEXT NOT NULL, npc_task_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL);
    INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config) VALUES ('npc-1', 'ch-1', 'Alice', 0, 0, '{}', '{}');
  `);
  ensureSqliteCompatibility(sqlite);

  const now = new Date().toISOString();
  sqlite.prepare(
    "INSERT INTO nanobot_agent_sessions (id, npc_id, agent_id, session_key, started_at) VALUES (?, ?, ?, ?, ?)",
  ).run("sess-1", "npc-1", "npc-1", "agent:npc-1:k", now);

  assert.throws(() => {
    sqlite.prepare(
      "INSERT INTO nanobot_agent_sessions (id, npc_id, agent_id, session_key, started_at) VALUES (?, ?, ?, ?, ?)",
    ).run("sess-2", "npc-1", "npc-1", "agent:npc-1:k", now);
  }, /UNIQUE/i);
});
