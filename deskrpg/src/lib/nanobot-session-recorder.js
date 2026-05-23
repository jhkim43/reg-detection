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

/**
 * Option A: first-turn-only system prompt support.
 *
 * deskrpg가 nanobot에 보내는 user 메시지에 [System]\n{persona}\n\n[User]\n... 형식으로
 * system을 prepend하던 패턴은 nanobot session jsonl에 매 turn마다 system이 누적되어
 * token consolidation을 빠르게 유발하는 비효율이 있었음 (smoke test 2026-05-23 PM-B:
 * 14턴 / 61066 tokens 중 system 중복이 큰 비중).
 *
 * 해결: nanobot_agent_sessions row 존재 여부로 첫 turn 판단. row 있으면 nanobot이
 * 이미 첫 system을 conversation context로 보유 중 — user 메시지만 보내도 충분.
 *
 * 정책:
 *   - row 없음 (첫 호출) → system+user 보냄 + recordSessionStart가 row 생성
 *   - row 있음          → user만 보냄
 *   - DB 호출 실패      → 보수적 default: system 포함 (silent-fail)
 *
 * 한계: 사용자가 npc:reset-chat을 누르더라도 nanobot_agent_sessions row가 살아있어
 * 첫 turn 판단이 false negative. reset 흐름 통합은 별 follow-up.
 */
async function hasNanobotSessionStarted(deps, npcId, sessionKey) {
  if (!deps || !deps.db || !deps.schema || !deps.schema.nanobotAgentSessions) return false;
  if (!deps.eq || !deps.and) return false;
  try {
    const rows = await deps.db
      .select({ id: deps.schema.nanobotAgentSessions.id })
      .from(deps.schema.nanobotAgentSessions)
      .where(
        deps.and(
          deps.eq(deps.schema.nanobotAgentSessions.agentId, String(npcId)),
          deps.eq(deps.schema.nanobotAgentSessions.sessionKey, String(sessionKey)),
        ),
      )
      .limit(1);
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    console.warn("[nanobot] hasNanobotSessionStarted failed:", err && err.message);
    return false; // 안전 fallback — system 포함하는 쪽
  }
}

module.exports = {
  recordSessionStart,
  recordChunkArrival,
  recordSessionAbort,
  hasNanobotSessionStarted,
};
