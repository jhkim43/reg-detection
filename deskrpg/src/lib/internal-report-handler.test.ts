// seed-v11 AC-002 / T-V11-005 — internal-report-handler unit tests.
//
// 패턴: internal-task-handler.test.ts 답습 — 실제 SQLite + drizzle ORM으로 end-to-end 검증.
// fixture(users/characters/channels/npcs)는 raw SQL로 seeded. socket emit은 capture array.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "internal-report-handler-"));
const sqlitePath = path.join(tempDir, "handler.sqlite");
process.env.DB_TYPE = "sqlite";
process.env.SQLITE_PATH = sqlitePath;

const { handleReportPush } = require("./internal-report-handler.ts") as typeof import("./internal-report-handler");
const dbIndex = require("../db") as { getDb: () => unknown };
dbIndex.getDb();

const sqlite = new Database(sqlitePath);
sqlite.pragma("foreign_keys = ON");

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

function makeEmitFailing() {
  const emit = () => {
    throw new Error("emit boom");
  };
  return { emit };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test("(1) missing required field → 400 missing_required_field", async () => {
  const fx = seedFixture("01");
  const { emit } = makeEmitCapture();

  const result = await handleReportPush(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      characterId: fx.characterId,
      bodyMarkdown: "",
    },
    { emit },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 400);
    assert.equal(result.errorCode, "missing_required_field");
    assert.equal(result.field, "bodyMarkdown");
  }
});

test("(2) channel_not_found → 404", async () => {
  const fx = seedFixture("02");
  const { emit } = makeEmitCapture();

  const result = await handleReportPush(
    {
      channelId: "99999999-0000-0000-0000-000000000000",
      npcId: fx.npcId,
      characterId: fx.characterId,
      bodyMarkdown: "body",
    },
    { emit },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 404);
    assert.equal(result.errorCode, "channel_not_found");
  }
});

test("(3) npc_not_found → 404", async () => {
  const fx = seedFixture("03");
  const { emit } = makeEmitCapture();

  const result = await handleReportPush(
    {
      channelId: fx.channelId,
      npcId: "88888888-0000-0000-0000-000000000000",
      characterId: fx.characterId,
      bodyMarkdown: "body",
    },
    { emit },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 404);
    assert.equal(result.errorCode, "npc_not_found");
  }
});

test("(4) npc-channel mismatch → 404 npc_not_found", async () => {
  const fxA = seedFixture("04");
  const fxB = seedFixture("4a");
  const { emit } = makeEmitCapture();

  // fxA의 channel + fxB의 npc → mismatch
  const result = await handleReportPush(
    {
      channelId: fxA.channelId,
      npcId: fxB.npcId,
      characterId: fxA.characterId,
      bodyMarkdown: "body",
    },
    { emit },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 404);
    assert.equal(result.errorCode, "npc_not_found");
  }
});

test("(5) character_not_found → 404", async () => {
  const fx = seedFixture("05");
  const { emit } = makeEmitCapture();

  const result = await handleReportPush(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      characterId: "77777777-0000-0000-0000-000000000000",
      bodyMarkdown: "body",
    },
    { emit },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 404);
    assert.equal(result.errorCode, "character_not_found");
  }
});

test("(6) 정상 → 201 + persistedReportId + DB row + emit", async () => {
  const fx = seedFixture("06");
  const { calls, emit } = makeEmitCapture();

  const result = await handleReportPush(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      characterId: fx.characterId,
      title: "주간 매물 분석",
      bodyMarkdown: "## 요약\n신규 영향도 ...",
      creatorSubAgentLabel: "리서치담당",
      metadata: { source: "test" },
    },
    { emit },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.statusCode, 201);
    assert.ok(result.persistedReportId);

    // DB row 검증
    const row = sqlite
      .prepare("SELECT character_id, npc_id, title, body_markdown, metadata FROM agent_reports WHERE id = ?")
      .get(result.persistedReportId) as {
        character_id: string;
        npc_id: string;
        title: string;
        body_markdown: string;
        metadata: string;
      };
    assert.equal(row.character_id, fx.characterId);
    assert.equal(row.npc_id, fx.npcId);
    assert.equal(row.title, "주간 매물 분석");
    assert.equal(row.body_markdown, "## 요약\n신규 영향도 ...");
    const meta = JSON.parse(row.metadata) as Record<string, unknown>;
    assert.equal(meta.creatorSubAgentLabel, "리서치담당");
    assert.equal(meta.source, "test");
    assert.equal(meta.channelIdSnapshot, fx.channelId);
  }

  // emit 호출 검증
  assert.equal(calls.length, 1);
  assert.equal(calls[0].channelId, fx.channelId);
  const payload = calls[0].payload as Record<string, unknown>;
  assert.equal(payload.npcId, fx.npcId);
  assert.equal(payload.title, "주간 매물 분석");
  assert.equal(payload.creatorSubAgentLabel, "리서치담당");
});

test("(7) Idempotency-Key 중복 → 409 duplicate_message", async () => {
  const fx = seedFixture("07");
  const { emit } = makeEmitCapture();
  const idempotencyKey = "report-key-07";

  const r1 = await handleReportPush(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      characterId: fx.characterId,
      bodyMarkdown: "first",
    },
    { emit, idempotencyKey },
  );
  assert.equal(r1.ok, true);

  const r2 = await handleReportPush(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      characterId: fx.characterId,
      bodyMarkdown: "second",
    },
    { emit, idempotencyKey },
  );
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.equal(r2.statusCode, 409);
    assert.equal(r2.errorCode, "duplicate_message");
  }
});

test("(8) emit 실패 → 500, 단 DB row는 영속됨", async () => {
  const fx = seedFixture("08");
  const { emit } = makeEmitFailing();

  const result = await handleReportPush(
    {
      channelId: fx.channelId,
      npcId: fx.npcId,
      characterId: fx.characterId,
      bodyMarkdown: "emit-fail-body",
    },
    { emit },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.statusCode, 500);
    assert.equal(result.errorCode, "internal_error");
  }

  // row는 insert 됐어야 함 (TRD-D-41)
  const rows = sqlite
    .prepare("SELECT id FROM agent_reports WHERE character_id = ? AND body_markdown = ?")
    .all(fx.characterId, "emit-fail-body");
  assert.equal(rows.length, 1);
});
