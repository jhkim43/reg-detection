// seed-v10 AC-001 / T-V08 — internal-task-handler unit tests (5 cases).
//
// 실제 SQLite + drizzle ORM으로 handleTaskEvent end-to-end 검증.
// fixture(users/characters/channels/npcs)는 raw SQL로 seeded — handler가 tasks
// 테이블 op만 수행하면 ok. socket emit은 captured array로 검증.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "internal-task-handler-"));
const sqlitePath = path.join(tempDir, "handler.sqlite");
process.env.DB_TYPE = "sqlite";
process.env.SQLITE_PATH = sqlitePath;

// db/index.ts proxy — lazy getDb(). 첫 access 시 SQLITE_PATH 기준 init.
// require → tsx가 ts transform. import meta가 cjs target이라 top-level await 불가.
const { handleTaskEvent } = require("./internal-task-handler.ts") as typeof import("./internal-task-handler");

// fixture seeding 전에 base schema/ALTER가 적용된 sqlite 파일이 존재해야 함.
// db/index.ts 내부 helper로 schema 생성.
const dbIndex = require("../db") as { getDb: () => unknown };
dbIndex.getDb(); // lazy init → ensureSqliteBaseSchema + ensureSqliteCompatibility 호출됨

const sqlite = new Database(sqlitePath);
sqlite.pragma("foreign_keys = ON");

// fixture: 각 케이스마다 distinct channel/npc/character ID로 격리.
type Fixture = {
  channelId: string;
  npcId: string;
  characterId: string;
  ownerUserId: string;
};

function seedFixture(suffix: string): Fixture {
  const ownerUserId = `00000000-0000-0000-0000-${suffix}aaaaaaaa`;
  const channelId = `00000000-0000-0000-0000-${suffix}bbbbbbbb`;
  const npcId = `00000000-0000-0000-0000-${suffix}cccccccc`;
  const characterId = `00000000-0000-0000-0000-${suffix}dddddddd`;

  sqlite.prepare("INSERT INTO users (id, login_id, nickname, password_hash) VALUES (?, ?, ?, ?)").run(
    ownerUserId,
    `login-${suffix}`,
    `nick-${suffix}`,
    "hash",
  );
  sqlite.prepare("INSERT INTO channels (id, name, owner_id) VALUES (?, ?, ?)").run(
    channelId,
    `ch-${suffix}`,
    ownerUserId,
  );
  sqlite.prepare("INSERT INTO characters (id, user_id, name, appearance) VALUES (?, ?, ?, ?)").run(
    characterId,
    ownerUserId,
    `char-${suffix}`,
    "{}",
  );
  sqlite
    .prepare(
      `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(npcId, channelId, `npc-${suffix}`, 1, 1, "{}", "{}");

  return { channelId, npcId, characterId, ownerUserId };
}

type EmitCall = { channelId: string; payload: unknown };
function makeEmitCapture() {
  const calls: EmitCall[] = [];
  const emit = (channelId: string, payload: unknown) => {
    calls.push({ channelId, payload });
  };
  return { calls, emit };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test("(1) action=create → tasks insert + socket emit", async () => {
  const fx = seedFixture("01");
  const { calls, emit } = makeEmitCapture();

  const result = await handleTaskEvent(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      npcTaskId: "task-1",
      title: "First task",
      summary: "doing thing",
      status: "in_progress",
      action: "create",
      assignerCharacterId: fx.characterId,
      ownerUserId: fx.ownerUserId,
    },
    { emit },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.statusCode, 201);
    assert.ok(result.task.id, "task.id must be returned");
  }

  const row = sqlite
    .prepare("SELECT status, summary, title FROM tasks WHERE npc_id = ? AND npc_task_id = ?")
    .get(fx.npcId, "task-1") as { status: string; summary: string; title: string };
  assert.equal(row.status, "in_progress");
  assert.equal(row.title, "First task");

  assert.equal(calls.length, 1, "emit must be called exactly once");
  assert.equal(calls[0].channelId, fx.channelId);
  assert.deepEqual(
    (calls[0].payload as { npcTaskId: string; action: string }),
    {
      taskId: row && (calls[0].payload as { taskId: string }).taskId,
      npcId: fx.npcId,
      npcTaskId: "task-1",
      status: "in_progress",
      action: "create",
    },
  );
});

test("(2) action=create + npcTaskId 중복 → onConflictDoUpdate (status reset, no throw)", async () => {
  const fx = seedFixture("02");
  const { emit } = makeEmitCapture();

  // 1st: create → in_progress
  const r1 = await handleTaskEvent(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      npcTaskId: "dup-1",
      title: "v1",
      status: "in_progress",
      action: "create",
      assignerCharacterId: fx.characterId,
      ownerUserId: fx.ownerUserId,
    },
    { emit },
  );
  assert.equal(r1.ok, true);

  // 2nd: same npcTaskId → onConflictDoUpdate (title/status overwrite, no error)
  const r2 = await handleTaskEvent(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      npcTaskId: "dup-1",
      title: "v2",
      status: "backlog",
      action: "create",
      assignerCharacterId: fx.characterId,
      ownerUserId: fx.ownerUserId,
    },
    { emit },
  );
  assert.equal(r2.ok, true);

  const rows = sqlite
    .prepare("SELECT title, status FROM tasks WHERE npc_id = ? AND npc_task_id = ?")
    .all(fx.npcId, "dup-1") as Array<{ title: string; status: string }>;
  assert.equal(rows.length, 1, "must remain exactly one row (idempotent)");
  assert.equal(rows[0].title, "v2");
  assert.equal(rows[0].status, "backlog");
});

test("(3) action=update → status 갱신", async () => {
  const fx = seedFixture("03");
  const { emit } = makeEmitCapture();

  await handleTaskEvent(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      npcTaskId: "task-3",
      title: "Update target",
      status: "backlog",
      action: "create",
      assignerCharacterId: fx.characterId,
      ownerUserId: fx.ownerUserId,
    },
    { emit },
  );

  const result = await handleTaskEvent(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      npcTaskId: "task-3",
      title: "Update target",
      summary: "progressed",
      status: "in_progress",
      action: "update",
      assignerCharacterId: fx.characterId,
      ownerUserId: fx.ownerUserId,
    },
    { emit },
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.statusCode, 200);

  const row = sqlite
    .prepare("SELECT status, summary FROM tasks WHERE npc_id = ? AND npc_task_id = ?")
    .get(fx.npcId, "task-3") as { status: string; summary: string };
  assert.equal(row.status, "in_progress");
  assert.equal(row.summary, "progressed");
});

test("(4) action=complete → completedAt + socket emit with status=completed", async () => {
  const fx = seedFixture("04");
  const { calls, emit } = makeEmitCapture();

  await handleTaskEvent(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      npcTaskId: "task-4",
      title: "Will complete",
      status: "in_progress",
      action: "create",
      assignerCharacterId: fx.characterId,
      ownerUserId: fx.ownerUserId,
    },
    { emit },
  );
  calls.length = 0;

  const result = await handleTaskEvent(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      npcTaskId: "task-4",
      title: "Will complete",
      status: "completed",
      action: "complete",
      assignerCharacterId: fx.characterId,
      ownerUserId: fx.ownerUserId,
    },
    { emit },
  );
  assert.equal(result.ok, true);

  const row = sqlite
    .prepare("SELECT status, completed_at FROM tasks WHERE npc_id = ? AND npc_task_id = ?")
    .get(fx.npcId, "task-4") as { status: string; completed_at: string | null };
  assert.equal(row.status, "completed");
  assert.ok(row.completed_at, "completedAt must be set");

  assert.equal(calls.length, 1);
  assert.equal((calls[0].payload as { status: string; action: string }).status, "completed");
  assert.equal((calls[0].payload as { action: string }).action, "complete");
});

test("(5) ownerUserId가 channel.ownerId 아니면 403 forbidden_channel", async () => {
  const fx = seedFixture("05");
  const { calls, emit } = makeEmitCapture();

  const result = await handleTaskEvent(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      npcTaskId: "task-5",
      title: "Should be rejected",
      status: "in_progress",
      action: "create",
      assignerCharacterId: fx.characterId,
      ownerUserId: "00000000-0000-0000-0000-deadbeefdead", // 다른 user
    },
    { emit },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 403);
    assert.equal(result.errorCode, "forbidden_channel");
  }

  const rows = sqlite
    .prepare("SELECT id FROM tasks WHERE npc_id = ? AND npc_task_id = ?")
    .all(fx.npcId, "task-5");
  assert.equal(rows.length, 0, "rejected request must not write");
  assert.equal(calls.length, 0, "rejected request must not emit");
});
