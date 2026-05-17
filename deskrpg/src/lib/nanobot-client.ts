import { env } from "./env";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  model?: string;
  signal?: AbortSignal;
  sessionId?: string;
};

function buildEndpoint() {
  const base = env.NANOBOT_API_URL.replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.text();
    return body.slice(0, 500);
  } catch {
    return "";
  }
}

// nanobot OpenAI-compat accepts only a single user message; multi-turn history
// is managed server-side per session_id. Fold [system, ...history, user] into
// one user payload (system as prefix), and surface sessionId via body.session_id.
function buildRequestBody(
  messages: ChatMessage[],
  opts: ChatOptions,
  stream: boolean,
): Record<string, unknown> {
  let systemText = "";
  let userText = "";
  for (const m of messages) {
    if (m.role === "system") {
      systemText += (systemText ? "\n\n" : "") + (m.content || "");
    } else if (m.role === "user") {
      userText = m.content || "";
    }
  }
  const text = systemText
    ? `[System]\n${systemText}\n\n[User]\n${userText}`
    : userText;
  const body: Record<string, unknown> = {
    model: opts.model || env.NANOBOT_MODEL,
    messages: [{ role: "user", content: text }],
    stream,
  };
  if (opts.sessionId) body.session_id = opts.sessionId;
  return body;
}

export async function nanobotChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const res = await fetch(buildEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRequestBody(messages, opts, false)),
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`nanobot API ${res.status}: ${await readError(res)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function nanobotChatStream(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  opts: ChatOptions = {},
): Promise<string> {
  const res = await fetch(buildEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRequestBody(messages, opts, true)),
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`nanobot API ${res.status}: ${await readError(res)}`);
  }
  if (!res.body) {
    throw new Error("nanobot API returned empty stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          fullText += delta;
          onDelta(delta);
        }
      } catch {
        // tolerate partial / malformed SSE chunks
      }
    }
  }
  return fullText;
}

export function isNanobotProvider(): boolean {
  return env.AI_PROVIDER === "nanobot";
}
