import { env } from "./env";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  model?: string;
  signal?: AbortSignal;
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

export async function nanobotChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const res = await fetch(buildEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model || env.NANOBOT_MODEL,
      messages,
      stream: false,
    }),
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
    body: JSON.stringify({
      model: opts.model || env.NANOBOT_MODEL,
      messages,
      stream: true,
    }),
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
