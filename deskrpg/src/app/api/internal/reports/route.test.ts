// seed-v11 AC-002 / T-V11-009 — POST /api/internal/reports route integration tests.
//
// 패턴: internal-task-handler/route.test.ts 답습. 실 SQLite + 임시 HTTP listener로
// /_internal/emit 받아 200 반환 → 핸들러가 정상 201 반환.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import Database from "better-sqlite3";
import { NextRequest } from "next/server";

const require = createRequire(import.meta.url);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "internal-reports-route-"));
const sqlitePath = path.join(tempDir, "route.sqlite");
process.env.DB_TYPE = "sqlite";
process.env.SQLITE_PATH = sqlitePath;
process.env.INTERNAL_RPC_SECRET = "test-secret";

// 임시 /_internal/emit listener — ephemeral port, 무조건 200.
const emitReceived: Array<{ method?: string; url?: string; body: unknown }> = [];
let emitServer: http.Server | null = null;

process.env.INTERNAL_HOSTNAME = "127.0.0.1";

test.before(async () => {
  emitServer = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        emitReceived.push({ method: req.method, url: req.url, body: JSON.parse(raw) });
      } catch {
        emitReceived.push({ method: req.method, url: req.url, body: raw });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  const port: number = await new Promise((resolve) => {
    emitServer!.listen(0, "127.0.0.1", () => {
      const addr = emitServer!.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else throw new Error("emit server listen failed");
    });
  });
  process.env.INTERNAL_PORT = String(port);
});

test.after(() => {
  emitServer?.close();
});

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
  return new NextRequest("http://localhost/api/internal/reports", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test("(1) secret 누락 → 401 unauthorized", async () => {
  const res = await POST(buildRequest({
    channel_id: channelId, npc_id: npcId, character_id: characterId, body_markdown: "x",
  }));
  assert.equal(res.status, 401);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "unauthorized");
});

test("(2) 필수 필드 누락 (no body_markdown) → 400 missing_required_field", async () => {
  const res = await POST(buildRequest(
    { channel_id: channelId, npc_id: npcId, character_id: characterId },
    { "x-deskrpg-internal-secret": "test-secret" },
  ));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { errorCode: string; field?: string };
  assert.equal(body.errorCode, "missing_required_field");
  assert.equal(body.field, "bodyMarkdown");
});

test("(3) 정상 → 201 + persisted_report_id (snake_case) + DB row + emit 호출", async () => {
  const beforeEmits = emitReceived.length;
  const res = await POST(buildRequest(
    {
      channel_id: channelId,
      npc_id: npcId,
      character_id: characterId,
      title: "주간 매물 분석",
      body_markdown: "## 요약\n잘 동작",
      creator_sub_agent_label: "리서치담당",
      metadata: { source: "route-test" },
    },
    { "x-deskrpg-internal-secret": "test-secret" },
  ));
  assert.equal(res.status, 201);
  const body = (await res.json()) as { persisted_report_id: string };
  assert.ok(body.persisted_report_id, "persisted_report_id must be returned");

  // DB row 검증 — snake_case → camelCase 변환 정확성
  const row = sqlite
    .prepare("SELECT character_id, npc_id, title, body_markdown, metadata FROM agent_reports WHERE id = ?")
    .get(body.persisted_report_id) as {
      character_id: string;
      npc_id: string;
      title: string;
      body_markdown: string;
      metadata: string;
    };
  assert.equal(row.character_id, characterId);
  assert.equal(row.npc_id, npcId);
  assert.equal(row.title, "주간 매물 분석");
  const meta = JSON.parse(row.metadata) as Record<string, unknown>;
  assert.equal(meta.creatorSubAgentLabel, "리서치담당");
  assert.equal(meta.source, "route-test");

  // emit 호출 검증 — payload 형식
  assert.ok(emitReceived.length > beforeEmits, "emit forwarded");
  const last = emitReceived[emitReceived.length - 1];
  const emitBody = last.body as { event: string; room: string; payload: Record<string, unknown> };
  assert.equal(emitBody.event, "agent-report:ready");
  assert.equal(emitBody.room, channelId);
  assert.equal(emitBody.payload.npcId, npcId);
  assert.equal(emitBody.payload.title, "주간 매물 분석");
  assert.equal(emitBody.payload.creatorSubAgentLabel, "리서치담당");
});

test("(4) channel_not_found → 404", async () => {
  const res = await POST(buildRequest(
    {
      channel_id: "99999999-0000-0000-0000-000000000000",
      npc_id: npcId,
      character_id: characterId,
      body_markdown: "x",
    },
    { "x-deskrpg-internal-secret": "test-secret" },
  ));
  assert.equal(res.status, 404);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "channel_not_found");
});

test("(5) Idempotency-Key 중복 → 409 duplicate_message", async () => {
  const idemp = "route-dup-key-1";

  const r1 = await POST(buildRequest(
    { channel_id: channelId, npc_id: npcId, character_id: characterId, body_markdown: "first" },
    { "x-deskrpg-internal-secret": "test-secret", "Idempotency-Key": idemp },
  ));
  assert.equal(r1.status, 201);

  const r2 = await POST(buildRequest(
    { channel_id: channelId, npc_id: npcId, character_id: characterId, body_markdown: "second" },
    { "x-deskrpg-internal-secret": "test-secret", "Idempotency-Key": idemp },
  ));
  assert.equal(r2.status, 409);
  const body = (await r2.json()) as { errorCode: string };
  assert.equal(body.errorCode, "duplicate_message");
});

test("(6) invalid JSON → 400 invalid_json", async () => {
  const req = new NextRequest("http://localhost/api/internal/reports", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-deskrpg-internal-secret": "test-secret",
    },
    body: "{not-json",
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { errorCode: string };
  assert.equal(body.errorCode, "invalid_json");
});
