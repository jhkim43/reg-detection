// seed-v10 AC-001 / T-V10 — /api/internal/tasks POST route tests (4 cases).
//
// 실 SQLite + lazy db init으로 e2e처럼 route handler 호출.
// _internal/emit forward는 어차피 catch silent (서버 listen 안 함) — result 영향 없음.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import Database from "better-sqlite3";
import { NextRequest } from "next/server";

const require = createRequire(import.meta.url);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "internal-tasks-route-"));
const sqlitePath = path.join(tempDir, "route.sqlite");
process.env.DB_TYPE = "sqlite";
process.env.SQLITE_PATH = sqlitePath;
process.env.INTERNAL_RPC_SECRET = "test-secret";

const { POST } = require("./route.ts") as {
  POST: (req: NextRequest) => Promise<Response>;
};

const dbIndex = require("../../../../db") as { getDb: () => unknown };
dbIndex.getDb();

const sqlite = new Database(sqlitePath);
sqlite.pragma("foreign_keys = ON");

// fixture
const ownerUserId = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const channelId = "00000000-0000-0000-0000-bbbbbbbbbbbb";
const npcId = "00000000-0000-0000-0000-cccccccccccc";
const characterId = "00000000-0000-0000-0000-dddddddddddd";

sqlite.prepare("INSERT INTO users (id, login_id, nickname, password_hash) VALUES (?, ?, ?, ?)").run(
  ownerUserId, "owner", "Owner", "hash",
);
sqlite.prepare("INSERT INTO channels (id, name, owner_id) VALUES (?, ?, ?)").run(
  channelId, "ch", ownerUserId,
);
sqlite.prepare("INSERT INTO characters (id, user_id, name, appearance) VALUES (?, ?, ?, ?)").run(
  characterId, ownerUserId, "char", "{}",
);
sqlite.prepare(
  `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
).run(npcId, channelId, "npc", 1, 1, "{}", "{}");

function buildRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/internal/tasks", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test("(1) no x-deskrpg-internal-secret → 401", async () => {
  const res = await POST(buildRequest({
    channelId, npcId, npcTaskId: "t1", title: "x",
    status: "in_progress", action: "create",
    assignerCharacterId: characterId, ownerUserId,
  }));
  assert.equal(res.status, 401);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "unauthorized");
});

test("(2) missing required field (no channelId) → 400 missing_required_field", async () => {
  const res = await POST(buildRequest(
    { npcId, npcTaskId: "t2", title: "x",
      status: "in_progress", action: "create",
      assignerCharacterId: characterId, ownerUserId },
    { "x-deskrpg-internal-secret": "test-secret" },
  ));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { errorCode: string; field?: string };
  assert.equal(body.errorCode, "missing_required_field");
  assert.equal(body.field, "channelId");
});

test("(3) action=create + valid body → 201 + body shape", async () => {
  const res = await POST(buildRequest(
    { channelId, npcId, npcTaskId: "t3-create", title: "valid",
      status: "in_progress", action: "create",
      assignerCharacterId: characterId, ownerUserId },
    { "x-deskrpg-internal-secret": "test-secret" },
  ));
  assert.equal(res.status, 201);
  const body = (await res.json()) as { id: string; status: string };
  assert.ok(body.id, "id must be returned");
  assert.equal(body.status, "in_progress");

  const row = sqlite.prepare("SELECT status FROM tasks WHERE npc_task_id = ?")
    .get("t3-create") as { status: string };
  assert.equal(row.status, "in_progress");
});

test("(4) channelId not found → 404 channel_not_found (route reflects handler error)", async () => {
  const res = await POST(buildRequest(
    {
      channelId: "00000000-0000-0000-0000-deadbeefdead",
      npcId, npcTaskId: "t4", title: "x",
      status: "in_progress", action: "create",
      assignerCharacterId: characterId, ownerUserId,
    },
    { "x-deskrpg-internal-secret": "test-secret" },
  ));
  assert.equal(res.status, 404);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "channel_not_found");
});
