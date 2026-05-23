/**
 * seed-v9 AC-014 T-F03 — nanobotAgentSessions row 추적 helper (CJS).
 *
 * createNanobotAdapter(server.js production path)에서 chatSend/chatAbort 동안
 * 세션의 시작/첫 chunk/abort 시각을 DB에 영속한다. 모든 호출은 silent-fail —
 * chat 흐름을 깨뜨리지 않는다.
 *
 * helper를 nanobot-client.js 본체에 두지 않은 이유: nanobot-client.ts (dev path)와
 * baseName이 같아 tsx의 bundler resolver가 require("./nanobot-client.js")를 .ts로
 * redirect한다. 이 helper만 별도 파일로 두면 unit test가 가능하다.
 */

"use strict";

async function recordSessionStart(deps, npcId, sessionKey, timeoutMs) {
  if (!deps || !deps.db || !deps.schema || !deps.schema.nanobotAgentSessions) return;
  try {
    const now = new Date();
    await deps.db
      .insert(deps.schema.nanobotAgentSessions)
      .values({
        npcId,
        agentId: String(npcId),
        sessionKey: String(sessionKey),
        startedAt: now,
        timeoutMs,
      })
      .onConflictDoUpdate({
        target: [
          deps.schema.nanobotAgentSessions.agentId,
          deps.schema.nanobotAgentSessions.sessionKey,
        ],
        set: { startedAt: now, lastChunkAt: null, abortedAt: null, timeoutMs },
      });
  } catch (err) {
    console.warn("[nanobot] session start record failed:", err && err.message);
  }
}

async function recordChunkArrival(deps, npcId, sessionKey) {
  if (!deps || !deps.db || !deps.schema || !deps.schema.nanobotAgentSessions) return;
  if (!deps.eq || !deps.and) return;
  try {
    await deps.db
      .update(deps.schema.nanobotAgentSessions)
      .set({ lastChunkAt: new Date() })
      .where(
        deps.and(
          deps.eq(deps.schema.nanobotAgentSessions.agentId, String(npcId)),
          deps.eq(deps.schema.nanobotAgentSessions.sessionKey, String(sessionKey)),
        ),
      );
  } catch (err) {
    console.warn("[nanobot] chunk record failed:", err && err.message);
  }
}

async function recordSessionAbort(deps, npcId, sessionKey) {
  if (!deps || !deps.db || !deps.schema || !deps.schema.nanobotAgentSessions) return;
  if (!deps.eq || !deps.and) return;
  try {
    await deps.db
      .update(deps.schema.nanobotAgentSessions)
      .set({ abortedAt: new Date() })
      .where(
        deps.and(
          deps.eq(deps.schema.nanobotAgentSessions.agentId, String(npcId)),
          deps.eq(deps.schema.nanobotAgentSessions.sessionKey, String(sessionKey)),
        ),
      );
  } catch (err) {
    console.warn("[nanobot] abort record failed:", err && err.message);
  }
}

module.exports = {
  recordSessionStart,
  recordChunkArrival,
  recordSessionAbort,
};
