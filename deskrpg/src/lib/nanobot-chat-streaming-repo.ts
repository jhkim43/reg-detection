// seed-v9 AC-014 — Drizzle-backed ChatStreamRepo + session row upsert.
//
// nanobot-chat-streaming.ts는 ChatStreamRepo 인터페이스만 알고 DB를 모름. 이
// 모듈이 nanobotAgentSessions 테이블에 실제 INSERT/UPDATE 한다. unique index
// (agentId, sessionKey)를 활용한 upsert 패턴.

import { and, eq } from "drizzle-orm";

import { db, nanobotAgentSessions } from "@/db";
import type { ChatStreamRepo } from "./nanobot-chat-streaming";

/**
 * Chat 시작 시 호출: (agentId, sessionKey) row를 생성하거나 startedAt만 갱신.
 * lastChunkAt/abortedAt은 후속 호출(repo)에서 갱신.
 */
export async function ensureNanobotAgentSession(args: {
  npcId: string;
  agentId: string;
  sessionKey: string;
  timeoutMs?: number;
}): Promise<void> {
  await db
    .insert(nanobotAgentSessions)
    .values({
      npcId: args.npcId,
      agentId: args.agentId,
      sessionKey: args.sessionKey,
      timeoutMs: args.timeoutMs ?? 180_000,
    })
    .onConflictDoUpdate({
      target: [nanobotAgentSessions.agentId, nanobotAgentSessions.sessionKey],
      set: { startedAt: new Date(), abortedAt: null, lastChunkAt: null },
    });
}

export const defaultNanobotChatStreamRepo: ChatStreamRepo = {
  async recordLastChunkAt(agentId, sessionKey, at) {
    await db
      .update(nanobotAgentSessions)
      .set({ lastChunkAt: at })
      .where(
        and(
          eq(nanobotAgentSessions.agentId, agentId),
          eq(nanobotAgentSessions.sessionKey, sessionKey),
        ),
      );
  },
  async recordAbortedAt(agentId, sessionKey, at) {
    await db
      .update(nanobotAgentSessions)
      .set({ abortedAt: at })
      .where(
        and(
          eq(nanobotAgentSessions.agentId, agentId),
          eq(nanobotAgentSessions.sessionKey, sessionKey),
        ),
      );
  },
};
