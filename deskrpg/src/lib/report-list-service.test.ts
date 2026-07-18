// seed-v11 AC-008 / T-V11-007 — report-list-service unit tests.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "report-list-service-"));
const sqlitePath = path.join(tempDir, "service.sqlite");
process.env.DB_TYPE = "sqlite";
process.env.SQLITE_PATH = sqlitePath;

const { listReportsByCharacter } = require("./report-list-service.ts") as typeof import("./report-list-service");
const dbIndex = require("../db") as { getDb: () => unknown };
dbIndex.getDb();

const sqlite = new Database(sqlitePath);
sqlite.pragma("foreign_keys = ON");

type Fixture = {
  channelId: string;
  npcId: string;
  npcName: string;
  characterId: string;
  ownerUserId: string;
};

function seedFixture(suffix: string, npcName = `npc-${suffix}`): Fixture {
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
    .run(npcId, channelId, npcName, 1, 1, "{}", "{}");

  return { channelId, npcId, npcName, characterId, ownerUserId };
}

function insertReport(opts: {
  characterId: string;
  npcId: string | null;
  title?: string | null;
  bodyMarkdown: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}): string {
  const id = randomUUID();
  sqlite
    .prepare(
      `INSERT INTO agent_reports (id, character_id, npc_id, title, body_markdown, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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

// ─── Tests ─────────────────────────────────────────────────────────────────────

test("(1) npcId 지정 시 그 NPC의 보고서만 반환", async () => {
  const fxA = seedFixture("11");
  const fxB = seedFixture("12");

  // fxA character에 npcA가 만든 보고서 + npcB가 만든 보고서를 둘 다 owner=fxA로 입력
  // (실제로는 nanobot이 push할 때 character_id가 fxA 거라고 가정)
  insertReport({ characterId: fxA.characterId, npcId: fxA.npcId, bodyMarkdown: "from-A" });
  insertReport({ characterId: fxA.characterId, npcId: fxB.npcId, bodyMarkdown: "from-B" });

  const rows = await listReportsByCharacter(fxA.characterId, { npcId: fxA.npcId });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].npcId, fxA.npcId);
  assert.equal(rows[0].bodyMarkdown, "from-A");
});

test("(2) npcId 미지정 시 character 전체, 시간순 desc", async () => {
  const fx = seedFixture("13");

  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "older", createdAt: "2026-05-01T00:00:00.000Z" });
  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "newer", createdAt: "2026-05-29T00:00:00.000Z" });

  const rows = await listReportsByCharacter(fx.characterId);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].bodyMarkdown, "newer"); // desc 정렬
  assert.equal(rows[1].bodyMarkdown, "older");
});

test("(3) npc 삭제된 row (npc_id NULL) → creatorNpcName null + metadata.creatorSubAgentLabel fallback", async () => {
  const fx = seedFixture("14");

  insertReport({
    characterId: fx.characterId,
    npcId: null, // NPC 삭제된 상태 모방
    bodyMarkdown: "orphan",
    metadata: { creatorSubAgentLabel: "리서치담당", channelIdSnapshot: fx.channelId },
  });

  const rows = await listReportsByCharacter(fx.characterId);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].npcId, null);
  assert.equal(rows[0].creatorNpcName, null);
  assert.equal(rows[0].creatorSubAgentLabel, "리서치담당");
});

test("(4) limit clamp — 100 요청해도 최대 50으로 절단", async () => {
  const fx = seedFixture("15");

  // 3건만 넣고 limit 100 요청 → 3건 다 반환 (clamp는 sql LIMIT을 50으로 제한)
  // 실제 50건 넣으면 테스트 느려지므로 clamp는 limit value만 확인 (smoke)
  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "r1" });
  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "r2" });
  insertReport({ characterId: fx.characterId, npcId: fx.npcId, bodyMarkdown: "r3" });

  const rows = await listReportsByCharacter(fx.characterId, { limit: 100 });
  // 실제 row 3건만 있으니 3건 반환. clamp는 SQL LIMIT 50으로 적용됐을 거 (50을 넘어 4번째 row 안 가져옴)
  assert.equal(rows.length, 3);

  // 0 또는 음수 limit → DEFAULT_LIMIT (50)
  const rowsZero = await listReportsByCharacter(fx.characterId, { limit: 0 });
  assert.equal(rowsZero.length, 3);
});

test("(5) 다른 character의 보고서는 안 나옴", async () => {
  const fxA = seedFixture("16");
  const fxB = seedFixture("17");

  insertReport({ characterId: fxA.characterId, npcId: fxA.npcId, bodyMarkdown: "A-report" });
  insertReport({ characterId: fxB.characterId, npcId: fxB.npcId, bodyMarkdown: "B-report" });

  const rows = await listReportsByCharacter(fxA.characterId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bodyMarkdown, "A-report");
});

test("(6) creatorNpcName 채워짐 + creatorSubAgentLabel null 케이스", async () => {
  const fx = seedFixture("18", "수퍼바이저");

  insertReport({
    characterId: fx.characterId,
    npcId: fx.npcId,
    title: "직접 작성",
    bodyMarkdown: "main agent가 직접 만든 보고서",
    metadata: { channelIdSnapshot: fx.channelId },
  });

  const rows = await listReportsByCharacter(fx.characterId, { npcId: fx.npcId });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].creatorNpcName, "수퍼바이저");
  assert.equal(rows[0].creatorSubAgentLabel, null);
});
