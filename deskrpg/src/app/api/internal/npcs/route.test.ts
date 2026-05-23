// seed-v10 AC-002 / T-V16 — npcs POST + DELETE route tests (5 cases).
//
// 단일 sqlite DB로 POST/DELETE 통합. fixture 격리는 row id로.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import Database from "better-sqlite3";
import { NextRequest } from "next/server";

const require = createRequire(import.meta.url);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "internal-npcs-route-"));
const sqlitePath = path.join(tempDir, "route.sqlite");
process.env.DB_TYPE = "sqlite";
process.env.SQLITE_PATH = sqlitePath;
process.env.INTERNAL_RPC_SECRET = "test-secret";

const { POST } = require("./route.ts") as {
  POST: (req: NextRequest) => Promise<Response>;
};
const { DELETE } = require("./[id]/route.ts") as {
  DELETE: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};

const dbIndex = require("../../../../db") as { getDb: () => unknown };
dbIndex.getDb();

const sqlite = new Database(sqlitePath);
sqlite.pragma("foreign_keys = ON");

const ownerUserId = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const channelId = "00000000-0000-0000-0000-bbbbbbbbbbbb";
const parentNpcId = "00000000-0000-0000-0000-cccccccccccc";
const parentAgentId = "agent-parent-route";

sqlite.prepare("INSERT INTO users (id, login_id, nickname, password_hash) VALUES (?, ?, ?, ?)").run(
  ownerUserId, "owner", "Owner", "hash",
);
sqlite.prepare("INSERT INTO channels (id, name, owner_id) VALUES (?, ?, ?)").run(
  channelId, "ch", ownerUserId,
);
sqlite.prepare(
  `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
).run(parentNpcId, channelId, "parent", 5, 5, "{}", JSON.stringify({ agentId: parentAgentId }));

function postReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/internal/npcs", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function deleteReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/internal/npcs/x", {
    method: "DELETE",
    headers,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test("(1) POST 401 (no secret)", async () => {
  const res = await POST(postReq({
    ownerUserId, channelId, name: "s", agentId: "a1", parentAgentId, identity: "i", soul: "s",
  }));
  assert.equal(res.status, 401);
});

test("(2) POST 201 정상 spawn", async () => {
  const res = await POST(postReq(
    { ownerUserId, channelId, name: "sub-route-2", agentId: "agent-route-2",
      parentAgentId, identity: "ID", soul: "SOUL" },
    { "x-deskrpg-internal-secret": "test-secret" },
  ));
  assert.equal(res.status, 201);
  const body = (await res.json()) as { npc: { parentAgentId: string; openclawConfig: { agentId: string } } };
  assert.equal(body.npc.parentAgentId, parentAgentId);
  assert.equal(body.npc.openclawConfig.agentId, "agent-route-2");
});

test("(3) POST 404 parent 없음", async () => {
  const res = await POST(postReq(
    { ownerUserId, channelId, name: "orphan", agentId: "agent-route-3",
      parentAgentId: "no-such-parent", identity: "x", soul: "y" },
    { "x-deskrpg-internal-secret": "test-secret" },
  ));
  assert.equal(res.status, 404);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "parent_npc_not_found");
});

test("(4) DELETE 401 (no secret)", async () => {
  const res = await DELETE(deleteReq(), { params: Promise.resolve({ id: parentNpcId }) });
  assert.equal(res.status, 401);
});

test("(5) DELETE 200 + deletedCount (cascade 호출 검증)", async () => {
  // 별도 fixture: child sub-agent 1개 추가
  const subParentId = "00000000-0000-0000-0000-eeeeeeeeeeee";
  const subParentAgentId = "agent-cascade-parent";
  const subChildId = "00000000-0000-0000-0000-ffffffffffff";
  sqlite.prepare(
    `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(subParentId, channelId, "cas-parent", 10, 10, "{}", JSON.stringify({ agentId: subParentAgentId }));
  sqlite.prepare(
    `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config, parent_agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(subChildId, channelId, "cas-child", 11, 10, "{}", JSON.stringify({ agentId: "agent-cas-child" }), subParentAgentId);

  const res = await DELETE(
    deleteReq({ "x-deskrpg-internal-secret": "test-secret" }),
    { params: Promise.resolve({ id: subParentId }) },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success: boolean; deletedCount: number };
  assert.equal(body.success, true);
  assert.equal(body.deletedCount, 2, "parent + 1 child = 2");

  const remaining = sqlite.prepare("SELECT id FROM npcs WHERE id IN (?, ?)").all(subParentId, subChildId);
  assert.equal(remaining.length, 0);
});
