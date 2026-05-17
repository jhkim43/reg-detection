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

const { db, schema, eq, and, desc } = require("../db/server-db.js");

const HISTORY_LIMIT_DEFAULT = 200;

function roleToDb(role) {
  if (role === "player" || role === "user") return "user";
  if (role === "npc" || role === "assistant") return "assistant";
  return null;
}

function rowToMemory(row) {
  // server.js 기존 모양: { role: "player"|"npc", content, timestamp }
  return {
    role: row.role === "user" ? "player" : "npc",
    content: row.content,
    timestamp: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
  };
}

async function loadHistory(characterId, npcId, limit = HISTORY_LIMIT_DEFAULT) {
  if (!characterId || !npcId) return [];
  try {
    const rows = await db
      .select()
      .from(schema.chatMessages)
      .where(and(eq(schema.chatMessages.characterId, characterId), eq(schema.chatMessages.npcId, npcId)))
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
