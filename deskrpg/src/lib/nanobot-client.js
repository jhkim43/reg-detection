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

function buildSystemPrompt(npcName, persona) {
  const parts = [
    `You are ${npcName || "an NPC"}, an NPC in a virtual office RPG.`,
  ];
  if (persona && typeof persona.identity === "string" && persona.identity.trim()) {
    parts.push("\n[Identity]\n" + persona.identity);
  }
  if (persona && typeof persona.soul === "string" && persona.soul.trim()) {
    parts.push("\n[Soul]\n" + persona.soul);
  }
  parts.push("\nRespond naturally in the user's language. Stay in character.");
  return parts.join("\n");
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
  const res = await fetch(getApiUrl() + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...buildNanobotRequestBody(messages, opts), stream: true }),
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
 * @param {{ db: any, schema: any, eq: Function }} deps
 */
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
        persona: oc.personaConfig || (oc.persona ? { identity: oc.persona, soul: "" } : null),
      };
    } catch (_e) {
      return { name: "NPC", persona: null };
    }
  }

  return {
    isConnected() { return true; },
    disconnect() {},
    async chatAbort() {},
    async chatSend(npcId, sessionKey, message, onDelta) {
      const npc = await loadNpc(npcId);
      const system = buildSystemPrompt(npc.name, npc.persona);
      const messages = [
        { role: "system", content: system },
        { role: "user", content: String(message || "") },
      ];
      const opts = { sessionId: sessionKey };
      try {
        if (typeof onDelta === "function") {
          return await nanobotChatStream(messages, onDelta, opts);
        }
        return await nanobotChat(messages, opts);
      } catch (err) {
        console.error("[nanobot] chat error npcId=" + String(npcId).slice(0, 8) + ":", err && err.message);
        throw err;
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
