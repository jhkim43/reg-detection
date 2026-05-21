// seed-v9 AC-014 — Chat streaming parity (T-023/024/025).
//
// nanobot 게이트웨이의 SSE chat streaming + 180s timeout + abort 통합 구현.
// Test Designer 작성 계약(nanobot-chat-streaming.test.ts)에 부합하도록 외부에
// 의존성 주입(fetcher / repo / abortController) 가능한 순수 logic 모듈.
//
// 책임 분리:
//   - chatSendStream: SSE 파싱 + onDelta 디스패치 + lastChunkAt 기록 + timeout watchdog
//   - chatAbortStream: 외부 abort 신호 발행 + abortedAt 기록 (idempotent)
//   - DB write는 ChatStreamRepo 추상화 — 실제 nanobotAgentSessions 업데이트는 caller가 주입

export interface ChatStreamRepo {
  recordLastChunkAt(agentId: string, sessionKey: string, at: Date): Promise<void>;
  recordAbortedAt(agentId: string, sessionKey: string, at: Date): Promise<void>;
}

export type ChatStreamFetcher = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ChatSendStreamResult {
  fullText: string;
  aborted: boolean;
}

const DEFAULT_TIMEOUT_MS = 180_000;

// baseUrl은 nanobot OpenAI-compat 베이스 (env.NANOBOT_API_URL — 기본 ".../v1").
// 기존 nanobot-client.ts와 동일한 endpoint 구성 (T-027 path 불일치 회피).
function buildEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export async function chatSendStream(opts: {
  agentId: string;
  sessionKey: string;
  message: string;
  baseUrl: string;
  onDelta: (chunk: string) => void;
  fetcher?: ChatStreamFetcher;
  repo?: ChatStreamRepo;
  timeoutMs?: number;
  abortController?: AbortController;
}): Promise<ChatSendStreamResult> {
  const {
    agentId,
    sessionKey,
    message,
    baseUrl,
    onDelta,
    fetcher,
    repo,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    abortController,
  } = opts;

  if (!agentId || !agentId.trim()) {
    throw new Error("chatSendStream: agentId required");
  }

  // Internal controller drives the actual fetch abort. External abortController
  // (from chatAbortStream caller) is forwarded into the internal controller so
  // we can distinguish "timeout vs external abort" in the catch block — only
  // timeout-driven aborts record abortedAt here (chatAbortStream records its own).
  const internalController = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  let externalListener: (() => void) | null = null;

  if (abortController) {
    if (abortController.signal.aborted) {
      externallyAborted = true;
      internalController.abort();
    } else {
      externalListener = () => {
        externallyAborted = true;
        internalController.abort();
      };
      abortController.signal.addEventListener("abort", externalListener);
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    internalController.abort();
  }, timeoutMs);

  const effectiveFetcher: ChatStreamFetcher =
    fetcher ?? ((url, init) => fetch(url, init));

  let fullText = "";
  let chunksReceived = 0;

  try {
    const res = await effectiveFetcher(buildEndpoint(baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionKey,
        messages: [{ role: "user", content: message }],
        stream: true,
      }),
      signal: internalController.signal,
    });

    if (!res.ok) {
      throw new Error(`nanobot HTTP ${res.status}: chat stream rejected`);
    }
    if (!res.body) {
      throw new Error("nanobot: empty response body");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    streamLoop: while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          done = true;
          break streamLoop;
        }
        chunksReceived++;
        fullText += payload;
        onDelta(payload);
      }
    }
    void done;

    if (chunksReceived > 0 && repo) {
      await repo.recordLastChunkAt(agentId, sessionKey, new Date());
    }

    return { fullText, aborted: false };
  } catch (err) {
    if (timedOut) {
      if (repo) {
        await repo.recordAbortedAt(agentId, sessionKey, new Date());
      }
      const e = new Error(
        `chatSendStream: timeout after ${timeoutMs}ms`,
      ) as Error & { name: string };
      e.name = "TimeoutError";
      throw e;
    }
    if (externallyAborted) {
      // chatAbortStream is the recorder for external aborts — don't double-record.
      return { fullText, aborted: true };
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (abortController && externalListener) {
      abortController.signal.removeEventListener("abort", externalListener);
    }
  }
}

export async function chatAbortStream(opts: {
  agentId: string;
  sessionKey: string;
  abortController?: AbortController;
  repo?: ChatStreamRepo;
}): Promise<{ aborted: boolean }> {
  const { agentId, sessionKey, abortController, repo } = opts;

  if (abortController && !abortController.signal.aborted) {
    abortController.abort();
  }
  if (repo) {
    await repo.recordAbortedAt(agentId, sessionKey, new Date());
  }
  return { aborted: true };
}
