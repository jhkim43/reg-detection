// seed-v11 AC-008 / T-V11-011 — GET /api/reports route integration tests.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import Database from "better-sqlite3";
import { NextRequest } from "next/server";

const require = createRequire(import.meta.url);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-reports-route-"));
const sqlitePath = path.join(tempDir, "route.sqlite");
process.env.DB_TYPE = "sqlite";
process.env.SQLITE_PATH = sqlitePath;

const { GET } = require("./route.ts") as {
  GET: (req: NextRequest) => Promise<Response>;
};

const dbIndex = require("../../../db") as { getDb: () => unknown };
dbIndex.getDb();

const sqlite = new Database(sqlitePath);
sqlite.pragma("foreign_keys = ON");

// fixture — user A + user B 각각 character + npc
type Fixture = { userId: string; characterId: string; channelId: string; npcId: string };
function seed(suffix: string): Fixture {
  const userId = `00000000-0000-0000-0000-${suffix}aaaaaaaa`;
  const characterId = `00000000-0000-0000-0000-${suffix}bbbbbbbb`;
  const channelId = `00000000-0000-0000-0000-${suffix}cccccccc`;
  const npcId = `00000000-0000-0000-0000-${suffix}dddddddd`;

  sqlite.prepare("INSERT INTO users (id, login_id, nickname, password_hash) VALUES (?, ?, ?, ?)").run(
    userId, `login-${suffix}`, `nick-${suffix}`, "hash",
  );
  sqlite.prepare("INSERT INTO characters (id, user_id, name, appearance) VALUES (?, ?, ?, ?)").run(
    characterId, userId, `char-${suffix}`, "{}",
  );
  sqlite.prepare("INSERT INTO channels (id, name, owner_id) VALUES (?, ?, ?)").run(
    channelId, `ch-${suffix}`, userId,
  );
  sqlite.prepare(
    `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(npcId, channelId, `npc-${suffix}`, 1, 1, "{}", "{}");

  return { userId, characterId, channelId, npcId };
}

function insertReport(opts: {
  characterId: string;
  npcId: string | null;
  title?: string;
  bodyMarkdown: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}): string {
  const id = randomUUID();
  sqlite.prepare(
    `INSERT INTO agent_reports (id, character_id, npc_id, title, body_markdown, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.characterId,
    opts.npcId,
    opts.title ?? null,
    opts.bodyMarkdown,
    opts.metadata == null ? null : JSON.stringify(opts.metadata),
    opts.createdAt ?? new Date().toISOString(),
  );
  return id;
}

function buildRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: "GET", headers });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test("(1) x-user-id 누락 → 401 unauthorized", async () => {
  const res = await GET(buildRequest("http://localhost/api/reports"));
  assert.equal(res.status, 401);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "unauthorized");
});

test("(2) user에 character 없음 → 404 character_not_found", async () => {
  const orphanUserId = "00000000-0000-0000-0000-orphandeadbeef".slice(0, 36);
  sqlite.prepare("INSERT INTO users (id, login_id, nickname, password_hash) VALUES (?, ?, ?, ?)").run(
    orphanUserId, "orphan", "Orphan", "hash",
  );
  const res = await GET(buildRequest("http://localhost/api/reports", { "x-user-id": orphanUserId }));
  assert.equal(res.status, 404);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "character_not_found");
});

test("(3) 정상 GET (npcId 미지정) → 200 + character 전체 보고서 desc", async () => {
  const fx = seed("31");
  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "first", createdAt: "2026-05-01T00:00:00Z" });
  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "second", createdAt: "2026-05-29T00:00:00Z" });

  const res = await GET(buildRequest("http://localhost/api/reports", { "x-user-id": fx.userId }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { reports: Array<{ bodyMarkdown: string; creatorNpcName: string | null }> };
  assert.equal(body.reports.length, 2);
  assert.equal(body.reports[0].bodyMarkdown, "second"); // desc
  assert.equal(body.reports[0].creatorNpcName, "npc-31");
});

test("(4) npcId 지정 → 그 NPC 보고서만", async () => {
  const fx = seed("32");
  // 다른 NPC 추가
  const otherNpcId = randomUUID();
  sqlite.prepare(
    `INSERT INTO npcs (id, channel_id, name, position_x, position_y, appearance, openclaw_config)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(otherNpcId, fx.channelId, "other-npc", 2, 2, "{}", "{}");

  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "from-32-npc" });
  insertReport({ characterId: fx.characterId, npcId: otherNpcId, bodyMarkdown: "from-other-npc" });

  const res = await GET(buildRequest(
    `http://localhost/api/reports?npcId=${fx.npcId}`,
    { "x-user-id": fx.userId },
  ));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { reports: Array<{ npcId: string; bodyMarkdown: string }> };
  assert.equal(body.reports.length, 1);
  assert.equal(body.reports[0].npcId, fx.npcId);
  assert.equal(body.reports[0].bodyMarkdown, "from-32-npc");
});

test("(5) 다른 user의 보고서는 안 나옴 (scope 격리)", async () => {
  const fxA = seed("33");
  const fxB = seed("34");
  insertReport({ characterId: fxA.characterId, npcId: fxA.npcId, bodyMarkdown: "user-A-report" });
  insertReport({ characterId: fxB.characterId, npcId: fxB.npcId, bodyMarkdown: "user-B-report" });

  const res = await GET(buildRequest("http://localhost/api/reports", { "x-user-id": fxA.userId }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { reports: Array<{ bodyMarkdown: string }> };
  assert.equal(body.reports.length, 1);
  assert.equal(body.reports[0].bodyMarkdown, "user-A-report");
});

test("(6) limit query 동작 (clamp는 service 측에서)", async () => {
  const fx = seed("35");
  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "r1" });
  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "r2" });
  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "r3" });

  // limit=1 → 1건
  const res1 = await GET(buildRequest("http://localhost/api/reports?limit=1", { "x-user-id": fx.userId }));
  const body1 = (await res1.json()) as { reports: unknown[] };
  assert.equal(body1.reports.length, 1);

  // limit=100 → service에서 50으로 clamp되지만 실제 3건만 있으므로 3건
  const res100 = await GET(buildRequest("http://localhost/api/reports?limit=100", { "x-user-id": fx.userId }));
  const body100 = (await res100.json()) as { reports: unknown[] };
  assert.equal(body100.reports.length, 3);
});
