/**
 * Nanobot OpenAI-compatible client (CommonJS — used by server.js).
 *
 * This is the production runtime path. The TypeScript versions
 * (nanobot-client.ts + nanobot-chat.ts) serve dev-server.ts via
 * src/server/socket-handlers.ts. Keep behavior in sync.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

function isNanobotProvider() {
  return (process.env.AI_PROVIDER || "").toLowerCase() === "nanobot";
}

function getApiUrl() {
  return (process.env.NANOBOT_API_URL || "http://localhost:8900/v1").replace(/\/+$/, "");
}

function getModel() {
  return process.env.NANOBOT_MODEL || "qwen/qwen3.6-35b-a3b";
}

function buildSystemPrompt(npcName, _persona) {
  // seed-v10 옵션 B1: identity/soul은 nanobot workspace의 AGENTS.md/SOUL.md를
  // BOOTSTRAP_FILES가 system prompt로 자동 read한다. user message에 다시 inject하면
  // 이중 inject가 되어 LLM context를 부풀리고 tool_call 안정성을 떨어뜨린다 — 텔레그램
  // 경로와 동등한 동작을 위해 여기서는 npc 이름만 frame으로 제공한다.
  // (workspace 디렉토리는 agentId 기반이라 nanobot이 npc 이름을 자체적으로 알 수 없음.)
  return `You are ${npcName || "an NPC"}, an NPC in a virtual office RPG. Respond naturally in the user's language. Stay in character.`;
}

// nanobot OpenAI-compat accepts only a single user message; multi-turn history
// is managed server-side per session_id. Fold [system, ...history, user] into
// one user payload (system as prefix), and surface sessionId via body.session_id.
function buildNanobotRequestBody(messages, opts) {
  let systemText = "";
  let userText = "";
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const content = typeof m.content === "string" ? m.content : String(m.content || "");
    if (m.role === "system") {
      systemText += (systemText ? "\n\n" : "") + content;
    } else if (m.role === "user") {
      userText = content; // last user message wins
    }
    // assistant turns are discarded — nanobot session retains them
  }
  const text = systemText
    ? "[System]\n" + systemText + "\n\n[User]\n" + userText
    : userText;
  const body = {
    model: opts.model || getModel(),
    messages: [{ role: "user", content: text }],
  };
  if (opts.sessionId) body.session_id = String(opts.sessionId);
  return body;
}

async function nanobotChat(messages, opts) {
  opts = opts || {};
  const res = await fetch(getApiUrl() + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...buildNanobotRequestBody(messages, opts), stream: false }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error("nanobot API " + res.status + ": " + body.slice(0, 300));
  }
  const data = await res.json();
  return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
}

async function nanobotChatStream(messages, onDelta, opts) {
  opts = opts || {};
  // seed-v9 AC-014 T-023/025 — opts.signal로 외부 abort 전파 (production wiring).
  const res = await fetch(getApiUrl() + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...buildNanobotRequestBody(messages, opts), stream: true }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error("nanobot API " + res.status + ": " + body.slice(0, 300));
  }
  if (!res.body) throw new Error("nanobot API returned empty stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json && json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
        if (typeof delta === "string" && delta.length > 0) {
          fullText += delta;
          if (typeof onDelta === "function") onDelta(delta);
        }
      } catch (_e) {
        // tolerate malformed SSE chunks
      }
    }
  }
  return fullText;
}

/**
 * Build a gateway adapter with the same chatSend signature as OpenClawGateway.
 * agentId is interpreted as npcId (server.js's getNpcConfig sets agentId=npcId
 * in nanobot mode). Persona is loaded from npcs.openclawConfig.personaConfig.
 * Multi-turn history is delegated to nanobot session_id; we only send the
 * current user turn each call.
 *
 * seed-v9 AC-014 T-023/024/025 production wiring:
 *   - module-level abortControllers map: agentId::sessionKey → AbortController
 *   - chatSend: 등록 + signal 전달 + 180s timeout watchdog
 *   - chatAbort: lookup + ac.abort() (HTTP-level — nanobot 연결 종료)
 *
 * seed-v9 AC-014 T-F03 (Phase 4 follow-up): DB row tracking 추가.
 *   server-db.js (CJS)에 nanobotAgentSessions schema가 들어온 뒤(T-F02) chatSend
 *   시작/첫 chunk/abort/timeout 시각을 row에 영속화한다. 모든 DB 호출은
 *   silent-fail (chat 흐름을 깨뜨리지 않는다).
 *
 * @param {{ db: any, schema: any, eq: Function, and?: Function }} deps
 */

const nanobotAbortControllers = new Map();
const NANOBOT_DEFAULT_TIMEOUT_MS = 180_000;
function nanobotAbortKey(agentId, sessionKey) {
  return String(agentId) + "::" + String(sessionKey);
}

// T-F03: row tracking helpers — 별도 파일에 분리해 단위 테스트 가능.
// Phase 4.5 follow-up: hasNanobotSessionStarted (first-turn-only system 판단).
const {
  recordSessionStart,
  recordChunkArrival,
  recordSessionAbort,
  hasNanobotSessionStarted,
} = require("./nanobot-session-recorder.js");

// T-F07: nanobot 내부 task cancel (best-effort POST /v1/chat/abort/{sessionKey}).
const { postNanobotChatAbort } = require("./nanobot-remote-abort.js");

function createNanobotAdapter(deps) {
  const { db, schema, eq } = deps || {};

  async function loadNpc(npcId) {
    if (!db || !schema || !eq) return { name: "NPC", persona: null };
    try {
      const rows = await db
        .select({
          name: schema.npcs.name,
          openclawConfig: schema.npcs.openclawConfig,
        })
        .from(schema.npcs)
        .where(eq(schema.npcs.id, npcId));
      if (!rows.length) return { name: "NPC", persona: null };
      let oc;
      try {
        oc = typeof rows[0].openclawConfig === "string"
          ? JSON.parse(rows[0].openclawConfig)
          : (rows[0].openclawConfig || {});
      } catch (_e) {
        oc = {};
      }
      return {
        name: rows[0].name,
        persona: oc.personaConfig || null,
      };
    } catch (_e) {
      return { name: "NPC", persona: null };
    }
  }

  return {
    isConnected() { return true; },
    disconnect() {},
    async chatAbort(npcId, sessionKey) {
      const key = nanobotAbortKey(npcId, sessionKey);
      const ac = nanobotAbortControllers.get(key);
      // T-F03: ac가 없어도 row에는 aborted_at을 남긴다 — race 안전.
      await recordSessionAbort(deps, npcId, sessionKey);
      if (ac) {
        try {
          ac.abort();
        } catch (_e) { /* idempotent */ }
        nanobotAbortControllers.delete(key);
      }
      // T-F07: nanobot 내부 task까지 취소 (HTTP-level abort만으로는 LLM 계산이 계속됨).
      // best-effort — 실패해도 chatAbort 흐름 비차단.
      await postNanobotChatAbort(getApiUrl(), sessionKey);
    },
    async chatSend(npcId, sessionKey, message, onDelta) {
      const npc = await loadNpc(npcId);

      // Phase 4.5 follow-up — Option A: nanobot session jsonl에 system 누적되는
      // 비효율 해소. nanobot_agent_sessions row가 이미 있으면 nanobot 측 session이
      // 첫 turn의 system을 conversation context로 보유 중이라 user 메시지만 보낸다.
      // DB 호출 실패 시 false 반환 — 안전 fallback으로 system 포함.
      const sessionAlreadyStarted = await hasNanobotSessionStarted(deps, npcId, sessionKey);
      const messages = sessionAlreadyStarted
        ? [
            { role: "user", content: String(message || "") },
          ]
        : [
            { role: "system", content: buildSystemPrompt(npc.name, npc.persona) },
            { role: "user", content: String(message || "") },
          ];

      const key = nanobotAbortKey(npcId, sessionKey);
      const ac = new AbortController();
      nanobotAbortControllers.set(key, ac);

      // T-F03: 세션 시작을 row로 영속 (upsert — 같은 키 재호출 시 startedAt reset).
      // 다음 호출의 hasNanobotSessionStarted는 row 존재 여부만 보므로 true 반환.
      await recordSessionStart(deps, npcId, sessionKey, NANOBOT_DEFAULT_TIMEOUT_MS);

      // 180s timeout watchdog (seed-v9 AC-014 T-024).
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { ac.abort(); } catch (_e) {}
      }, NANOBOT_DEFAULT_TIMEOUT_MS);

      // T-F03: 첫 chunk 도착 시 last_chunk_at 1회 update (throttle 단순화).
      let firstChunkRecorded = false;
      const wrappedOnDelta = typeof onDelta === "function"
        ? (delta) => {
            if (!firstChunkRecorded) {
              firstChunkRecorded = true;
              recordChunkArrival(deps, npcId, sessionKey).catch(() => {});
            }
            onDelta(delta);
          }
        : undefined;

      const opts = { sessionId: sessionKey, signal: ac.signal };
      try {
        if (typeof onDelta === "function") {
          return await nanobotChatStream(messages, wrappedOnDelta, opts);
        }
        return await nanobotChat(messages, opts);
      } catch (err) {
        if (timedOut) {
          await recordSessionAbort(deps, npcId, sessionKey);
          const timeoutErr = new Error("nanobot chatSend: timeout after " + NANOBOT_DEFAULT_TIMEOUT_MS + "ms");
          timeoutErr.name = "TimeoutError";
          throw timeoutErr;
        }
        if (err && (err.name === "AbortError" || /aborted/i.test(String(err.message || "")))) {
          // External chatAbort — chatAbort()에서 이미 aborted_at을 기록했지만
          // race(타이밍에 따라 chatAbort 호출 전에 catch 진입)에 대비해 멱등 update.
          await recordSessionAbort(deps, npcId, sessionKey);
          return "";
        }
        console.error("[nanobot] chat error npcId=" + String(npcId).slice(0, 8) + ":", err && err.message);
        throw err;
      } finally {
        clearTimeout(timer);
        nanobotAbortControllers.delete(key);
      }
    },
  };
}

module.exports = {
  isNanobotProvider,
  nanobotChat,
  nanobotChatStream,
  createNanobotAdapter,
  buildSystemPrompt,
};
