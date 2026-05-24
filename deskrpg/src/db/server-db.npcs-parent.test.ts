// seed-v10 AC-005 / T-V05 — npcs.parent_agent_id schema 정합성 + ALTER 멱등 + INSERT/SELECT.
// PostgreSQL ↔ SQLite parity 검증 + ensureSqliteCompatibility의 ALTER 안전성.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

type ServerDbModule = {
  ensureSqliteBaseSchema: (sqlite: Database.Database) => void;
  ensureSqliteCompatibility: (sqlite: Database.Database) => void;
  schema: Record<string, unknown>;
};

function setupSqliteServerDb(): ServerDbModule {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-npcs-parent-"));
  const sqlitePath = path.join(tempDir, "parent.sqlite");
  process.env.DB_TYPE = "sqlite";
  process.env.SQLITE_PATH = sqlitePath;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const modulePath = require.resolve("./server-db.js");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  delete (require as unknown as { cache: Record<string, unknown> }).cache[modulePath];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./server-db.js") as ServerDbModule;
}

function bootstrapBaseSchema(sqlite: Database.Database, mod: ServerDbModule): void {
  sqlite.pragma("foreign_keys = ON");
  mod.ensureSqliteBaseSchema(sqlite);
}

// ─── 1. schema.ts ↔ server-db.js parity ────────────────────────────────────────

test("schema.npcs definition includes parentAgentId column (PostgreSQL parity)", () => {
  const { schema } = setupSqliteServerDb();
  const npcsTable = schema.npcs as { parentAgentId?: unknown };
  assert.ok(npcsTable, "schema.npcs must be exported");
  assert.ok(
    "parentAgentId" in npcsTable,
    "schema.npcs must include parentAgentId column (AC-005)",
  );
});

test("schema.ts source includes parent_agent_id column (sanity)", () => {
  // Static check — schema.ts(TypeScript)와 server-db.js(CJS) 두 파일 모두 parent_agent_id를
  // 정의해야 함. server-db.js는 위 schema.npcs.parentAgentId로 확인. schema.ts는 grep으로.
  const schemaTsPath = path.join(__dirname, "schema.ts");
  const src = fs.readFileSync(schemaTsPath, "utf8");
  assert.match(src, /parentAgentId.*text.*parent_agent_id/, "schema.ts must declare parentAgentId");
  assert.match(src, /idx_npcs_parent_agent_id/, "schema.ts must declare parent_agent_id index");
});

// ─── 2. ensureSqliteCompatibility — 멱등 ALTER ─────────────────────────────────

test("ensureSqliteCompatibility creates npcs.parent_agent_id column + index", () => {
  const mod = setupSqliteServerDb();
  const sqlite = new Database(":memory:");
  bootstrapBaseSchema(sqlite, mod);

  mod.ensureSqliteCompatibility(sqlite);

  const columns = sqlite.prepare("PRAGMA table_info(npcs)").all() as Array<{ name: string }>;
  const colNames = columns.map((c) => c.name).sort();
  assert.ok(colNames.includes("parent_agent_id"), "parent_agent_id column must exist");

  const indexes = sqlite.prepare("PRAGMA index_list(npcs)").all() as Array<{ name: string }>;
  const indexNames = indexes.map((i) => i.name);
  assert.ok(
    indexNames.includes("idx_npcs_parent_agent_id"),
    "idx_npcs_parent_agent_id must exist",
  );
});

test("ensureSqliteCompatibility is idempotent (run twice — no error, column stays)", () => {
  const mod = setupSqliteServerDb();
  const sqlite = new Database(":memory:");
  bootstrapBaseSchema(sqlite, mod);

  mod.ensureSqliteCompatibility(sqlite);
  mod.ensureSqliteCompatibility(sqlite); // 두 번째 호출도 throw 없어야 함

  const columns = sqlite.prepare("PRAGMA table_info(npcs)").all() as Array<{ name: string }>;
  const parentCols = columns.filter((c) => c.name === "parent_agent_id");
  assert.equal(parentCols.length, 1, "parent_agent_id must remain exactly one column");
});

// ─── 3. INSERT + SELECT round-trip ─────────────────────────────────────────────

test("npcs INSERT/SELECT round-trip with parent_agent_id (NOT NULL = sub-agent)", () => {
  const mod = setupSqliteServerDb();
  const sqlite = new Database(":memory:");
  bootstrapBaseSchema(sqlite, mod);
  mod.ensureSqliteCompatibility(sqlite);

  // FK satisfaction: users + channels 선행 생성 (channels.owner_id → users.id NOT NULL)
  sqlite
    .prepare(`INSERT INTO users (id, login_id, nickname, password_hash) VALUES (?, ?, ?, ?)`)
    .run("u-1", "owner", "Owner", "hash");
  sqlite
    .prepare(`INSERT INTO channels (id, name, owner_id) VALUES (?, ?, ?)`)
    .run("ch-1", "test-channel", "u-1");

  // parent NPC (사용자가 hire) — parent_agent_id NULL
  sqlite
    .prepare(
      `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("parent-1", "ch-1", "Parent NPC", 1, 1, "{}", '{"agentId":"agent-parent-1"}');

  // sub-agent — parent_agent_id = "agent-parent-1"
  sqlite
    .prepare(
      `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config, parent_agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("sub-1", "ch-1", "Sub Agent", 2, 2, "{}", '{"agentId":"agent-sub-1"}', "agent-parent-1");

  const parentRow = sqlite.prepare("SELECT * FROM npcs WHERE id = ?").get("parent-1") as { parent_agent_id: string | null };
  assert.equal(parentRow.parent_agent_id, null, "parent NPC must have parent_agent_id = NULL");

  const subRow = sqlite.prepare("SELECT * FROM npcs WHERE id = ?").get("sub-1") as { parent_agent_id: string | null };
  assert.equal(subRow.parent_agent_id, "agent-parent-1", "sub-agent must have parent_agent_id set");

  // application layer cascade lookup: parent의 agentId로 자식들 찾기
  const children = sqlite
    .prepare("SELECT id FROM npcs WHERE parent_agent_id = ? ORDER BY id")
    .all("agent-parent-1") as Array<{ id: string }>;
  assert.deepEqual(children.map((c) => c.id), ["sub-1"]);
});
