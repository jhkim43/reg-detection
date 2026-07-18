// seed-v10 AC-002 / T-V13 — internal-npc-handler unit tests (6 cases).
//
// 실 SQLite + lazy db init. writeNanobotAgentFiles / deleteNanobotAgentWorkspace는
// deps.writeFiles / deps.deleteWorkspace로 inject (spy).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "internal-npc-handler-"));
const sqlitePath = path.join(tempDir, "handler.sqlite");
process.env.DB_TYPE = "sqlite";
process.env.SQLITE_PATH = sqlitePath;

const { spawnSubAgent, deleteNpcInternal } = require("./internal-npc-handler.ts") as typeof import("./internal-npc-handler");

const dbIndex = require("../db") as { getDb: () => unknown };
dbIndex.getDb();

const sqlite = new Database(sqlitePath);
sqlite.pragma("foreign_keys = ON");

type Fixture = {
  channelId: string;
  parentNpcId: string;
  parentAgentId: string;
  ownerUserId: string;
};

function seedFixture(suffix: string): Fixture {
  const ownerUserId = `00000000-0000-0000-0000-${suffix}aaaaaaaa`;
  const channelId = `00000000-0000-0000-0000-${suffix}bbbbbbbb`;
  const parentNpcId = `00000000-0000-0000-0000-${suffix}cccccccc`;
  const parentAgentId = `agent-parent-${suffix}`;

  sqlite.prepare("INSERT INTO users (id, login_id, nickname, password_hash) VALUES (?, ?, ?, ?)").run(
    ownerUserId, `login-${suffix}`, `nick-${suffix}`, "hash",
  );
  sqlite.prepare("INSERT INTO channels (id, name, owner_id) VALUES (?, ?, ?)").run(
    channelId, `ch-${suffix}`, ownerUserId,
  );
  sqlite.prepare(
    `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(parentNpcId, channelId, `parent-${suffix}`, 5, 5, "{}", JSON.stringify({ agentId: parentAgentId }));

  return { channelId, parentNpcId, parentAgentId, ownerUserId };
}

function makeSpies() {
  const writeCalls: Array<{ agentId: string; files: ReadonlyArray<{ name: string; content: string }> }> = [];
  const deleteCalls: Array<{ agentId: string }> = [];
  const emitCalls: Array<{ channelId: string; event: string; payload: unknown }> = [];

  return {
    writeCalls,
    deleteCalls,
    emitCalls,
    writeFiles: async (agentId: string, files: ReadonlyArray<{ name: string; content: string }>) => {
      writeCalls.push({ agentId, files });
      return { workspacePath: `/tmp/workspace-${agentId}`, written: files.map((f) => f.name) };
    },
    deleteWorkspace: async (agentId: string) => {
      deleteCalls.push({ agentId });
      return { workspacePath: `/tmp/workspace-${agentId}`, deleted: true };
    },
    emit: (channelId: string, event: "npc:added" | "npc:removed", payload: unknown) => {
      emitCalls.push({ channelId, event, payload });
    },
  };
}

// ─── spawnSubAgent ─────────────────────────────────────────────────────────────

test("(1) spawnSubAgent → npcs insert + parent_agent_id 포함 + socket emit", async () => {
  const fx = seedFixture("01");
  const spies = makeSpies();

  const result = await spawnSubAgent(
    {
      ownerUserId: fx.ownerUserId,
      channelId: fx.channelId,
      name: "Sub Agent",
      agentId: "agent-sub-01",
      parentAgentId: fx.parentAgentId,
      identity: "I am a sub-agent",
      soul: "Soul body",
    },
    { emit: spies.emit, writeFiles: spies.writeFiles, deleteWorkspace: spies.deleteWorkspace },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.statusCode, 201);
    assert.equal(result.npc.parentAgentId, fx.parentAgentId);
    assert.equal(result.npc.openclawConfig.agentId, "agent-sub-01");
  }

  const row = sqlite.prepare("SELECT parent_agent_id, position_x FROM npcs WHERE channel_id = ? AND name = ?")
    .get(fx.channelId, "Sub Agent") as { parent_agent_id: string; position_x: number };
  assert.equal(row.parent_agent_id, fx.parentAgentId);
  assert.equal(row.position_x, 6); // parent.x(5) + 1

  assert.equal(spies.emitCalls.length, 1);
  assert.equal(spies.emitCalls[0].event, "npc:added");
  assert.equal(spies.emitCalls[0].channelId, fx.channelId);
});

test("(2) spawnSubAgent + writeNanobotAgentFiles 호출 검증 (AGENTS.md + SOUL.md)", async () => {
  // seed-v10 옵션 B1: identity는 AGENTS.md의 # Identity 섹션으로 흡수. nanobot
  // BOOTSTRAP_FILES가 AGENTS.md를 system prompt로 자동 read하므로 sub-agent도 같은 매핑.
  const fx = seedFixture("02");
  const spies = makeSpies();

  await spawnSubAgent(
    {
      ownerUserId: fx.ownerUserId,
      channelId: fx.channelId,
      name: "Sub Agent 02",
      agentId: "agent-sub-02",
      parentAgentId: fx.parentAgentId,
      identity: "ID body",
      soul: "SOUL body",
    },
    { emit: spies.emit, writeFiles: spies.writeFiles, deleteWorkspace: spies.deleteWorkspace },
  );

  assert.equal(spies.writeCalls.length, 1);
  assert.equal(spies.writeCalls[0].agentId, "agent-sub-02");
  const fileNames = spies.writeCalls[0].files.map((f) => f.name);
  assert.ok(fileNames.includes("AGENTS.md"));
  assert.ok(fileNames.includes("SOUL.md"));
  const agentsFile = spies.writeCalls[0].files.find((f) => f.name === "AGENTS.md");
  assert.equal(agentsFile?.content, "# Identity\nID body");
});

test("(3) parent NPC 없으면 parent_npc_not_found 404", async () => {
  const fx = seedFixture("03");
  const spies = makeSpies();

  const result = await spawnSubAgent(
    {
      ownerUserId: fx.ownerUserId,
      channelId: fx.channelId,
      name: "Sub Agent 03",
      agentId: "agent-sub-03",
      parentAgentId: "agent-does-not-exist",
      identity: "x",
      soul: "y",
    },
    { emit: spies.emit, writeFiles: spies.writeFiles, deleteWorkspace: spies.deleteWorkspace },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 404);
    assert.equal(result.errorCode, "parent_npc_not_found");
  }
  // 실패 시 mirror write / emit 호출되면 안 됨
  assert.equal(spies.writeCalls.length, 0);
  assert.equal(spies.emitCalls.length, 0);
});

// ─── deleteNpcInternal ─────────────────────────────────────────────────────────

test("(4) deleteNpcInternal → cascade: sub-agent 자식 함께 삭제", async () => {
  const fx = seedFixture("04");
  const spies = makeSpies();

  // sub-agent 1, sub-agent 2 (parent_agent_id = fx.parentAgentId)
  const sub1Id = `00000000-0000-0000-0000-04eeeeeeeeee`;
  const sub2Id = `00000000-0000-0000-0000-04ffffffffff`;
  sqlite.prepare(
    `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config, parent_agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sub1Id, fx.channelId, "sub-1", 6, 5, "{}", JSON.stringify({ agentId: "agent-sub1" }), fx.parentAgentId);
  sqlite.prepare(
    `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config, parent_agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sub2Id, fx.channelId, "sub-2", 7, 5, "{}", JSON.stringify({ agentId: "agent-sub2" }), fx.parentAgentId);

  const result = await deleteNpcInternal(fx.parentNpcId, {
    emit: spies.emit,
    writeFiles: spies.writeFiles,
    deleteWorkspace: spies.deleteWorkspace,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.statusCode, 200);
    assert.equal(result.deletedCount, 3, "parent + 2 children = 3");
  }

  const remaining = sqlite.prepare("SELECT id FROM npcs WHERE id IN (?, ?, ?)")
    .all(fx.parentNpcId, sub1Id, sub2Id);
  assert.equal(remaining.length, 0);
});

test("(5) deleteNpcInternal → deleteNanobotAgentWorkspace 호출 (deskrpg mirror only)", async () => {
  const fx = seedFixture("05");
  const spies = makeSpies();

  const result = await deleteNpcInternal(fx.parentNpcId, {
    emit: spies.emit,
    writeFiles: spies.writeFiles,
    deleteWorkspace: spies.deleteWorkspace,
  });

  assert.equal(result.ok, true);
  assert.equal(spies.deleteCalls.length, 1);
  assert.equal(spies.deleteCalls[0].agentId, fx.parentAgentId);
});

test("(6) deleteNpcInternal → socket npc:deleted emit", async () => {
  const fx = seedFixture("06");
  const spies = makeSpies();

  await deleteNpcInternal(fx.parentNpcId, {
    emit: spies.emit,
    writeFiles: spies.writeFiles,
    deleteWorkspace: spies.deleteWorkspace,
  });

  assert.ok(spies.emitCalls.some((c) => c.event === "npc:removed" && c.channelId === fx.channelId),
    "must emit npc:deleted on parent channel");
  const deletedEmit = spies.emitCalls.find((c) => c.event === "npc:removed");
  assert.deepEqual((deletedEmit?.payload as { npcId: string }), { npcId: fx.parentNpcId });
});
