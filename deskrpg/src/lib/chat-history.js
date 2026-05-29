// src/lib/chat-history.js
// PR 2a — chat_messages DB 영속화 (in-memory npcChatHistory 대체).
//
// server.js (CJS)에서 사용. role 매핑:
//   in-memory "player" ↔ DB "user"
//   in-memory "npc"    ↔ DB "assistant"
//
// 함수는 모두 async. characterId가 없으면(미인증 socket / 시스템 호출) silent skip.

"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const { db, schema, eq, and, or, desc, isNull } = require("../db/server-db.js");

const HISTORY_LIMIT_DEFAULT = 200;

function roleToDb(role) {
  if (role === "player" || role === "user") return "user";
  if (role === "npc" || role === "assistant") return "assistant";
  return null;
}

function rowToMemory(row) {
  // server.js 기존 모양: { role: "player"|"npc", content, timestamp }
  // seed-v10 phase6 T-V37: kind="subagent_push" + metadata.subagentLabel이 있으면
  // content에 prefix를 미리 박아 반환 (클라이언트는 단순 표시).
  let content = row.content;
  if (row.kind === "subagent_push" && row.metadata) {
    try {
      const meta = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
      if (meta && typeof meta.subagentLabel === "string" && meta.subagentLabel.trim()) {
        content = `[${meta.subagentLabel}] ${content}`;
      }
    } catch (_e) {
      // metadata 파싱 실패 — content 원본 그대로
    }
  }
  return {
    role: row.role === "user" ? "player" : "npc",
    content,
    timestamp: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
  };
}

async function loadHistory(characterId, npcId, limit = HISTORY_LIMIT_DEFAULT) {
  if (!characterId || !npcId) return [];
  try {
    // seed-v10 phase6 T-V37: 해당 character + npc의 chat 메시지에 더해 character 무관
    // 한 push 메시지(character_id IS NULL)도 함께 fetch. push 메시지는 sub-agent
    // 자율 보고이므로 같은 NPC dialog를 보는 모든 character가 함께 봄.
    const rows = await db
      .select()
      .from(schema.chatMessages)
      .where(and(
        or(
          eq(schema.chatMessages.characterId, characterId),
          isNull(schema.chatMessages.characterId),
        ),
        eq(schema.chatMessages.npcId, npcId),
      ))
      .orderBy(desc(schema.chatMessages.createdAt))
      .limit(limit);
    // desc 로 가져왔으니 시간 순서로 다시 뒤집어서 반환.
    return rows.reverse().map(rowToMemory);
  } catch (err) {
    console.error("[chat-history] loadHistory failed:", err);
    return [];
  }
}

async function appendMessage(characterId, npcId, role, content) {
  if (!characterId || !npcId) return null;
  const dbRole = roleToDb(role);
  if (!dbRole) return null;
  if (typeof content !== "string" || !content.trim()) return null;
  try {
    const [inserted] = await db
      .insert(schema.chatMessages)
      .values({ characterId, npcId, role: dbRole, content })
      .returning();
    return inserted ? rowToMemory(inserted) : null;
  } catch (err) {
    console.error("[chat-history] appendMessage failed:", err);
    return null;
  }
}

async function resetHistory(characterId, npcId) {
  if (!characterId || !npcId) return;
  try {
    await db
      .delete(schema.chatMessages)
      .where(and(eq(schema.chatMessages.characterId, characterId), eq(schema.chatMessages.npcId, npcId)));
  } catch (err) {
    console.error("[chat-history] resetHistory failed:", err);
  }
}

module.exports = { loadHistory, appendMessage, resetHistory };
