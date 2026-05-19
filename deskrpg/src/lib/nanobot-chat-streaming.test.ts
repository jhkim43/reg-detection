// AC-014: Chat streaming parity
//
// chatSendStream(agentId, sessionKey, message, onDelta) 인터페이스:
//   - SSE-style onDelta 콜백 (chunk마다 invoke)
//   - 180s timeout 후 자동 중단 + NanobotAgentSession.aborted_at 기록
//   - chatAbortStream(agentId, sessionKey)로 in-flight 스트림 취소
//   - 마지막 chunk 후 NanobotAgentSession.last_chunk_at 기록
//
// run: npm test (tsx --test)

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";

import {
  chatSendStream,
  chatAbortStream,
  type ChatStreamRepo,
  type ChatStreamFetcher,
  type ChatSendStreamResult,
} from "./nanobot-chat-streaming";

// ─── SSE 응답 헬퍼 ───────────────────────────────────────────────────────────
//
// nanobot /chat/stream 엔드포인트는 text/event-stream 을 반환한다.
// 각 이벤트 라인 형식: "data: <text>\n\n"
// 스트림 종료는 "data: [DONE]\n\n" 이후 ReadableStream close.

function makeSSEStream(chunks: string[], opts?: { delayMs?: number; hangForeverAfterMs?: number }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      if (opts?.hangForeverAfterMs !== undefined) {
        // 지정한 ms 후 첫 chunk를 보내고 이후 영원히 block — timeout 테스트용
        await setTimeoutPromise(opts.hangForeverAfterMs);
        // 이 지점에 도달하지 않는 것이 타임아웃 테스트의 핵심이지만,
        // AbortSignal로 fetch 자체가 중단되므로 controller는 닫히지 않는다.
        // 구현은 AbortController를 fetcher에 전달해 응답을 끊어야 한다.
        return;
      }
      const delay = opts?.delayMs ?? 0;
      for (const chunk of chunks) {
        if (delay > 0) await setTimeoutPromise(delay);
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// fetcher mock: (url, init) => Promise<Response>
function makeFetcher(stream: ReadableStream<Uint8Array>): ChatStreamFetcher {
  return async (_url: string, _init?: RequestInit): Promise<Response> => {
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };
}

// repo mock — 최소 인터페이스
function makeRepo(): ChatStreamRepo & {
  lastChunkAtCalls: Array<{ agentId: string; sessionKey: string; at: Date }>;
  abortedAtCalls: Array<{ agentId: string; sessionKey: string; at: Date }>;
} {
  const lastChunkAtCalls: Array<{ agentId: string; sessionKey: string; at: Date }> = [];
  const abortedAtCalls: Array<{ agentId: string; sessionKey: string; at: Date }> = [];
  return {
    lastChunkAtCalls,
    abortedAtCalls,
    async recordLastChunkAt(agentId: string, sessionKey: string, at: Date): Promise<void> {
      lastChunkAtCalls.push({ agentId, sessionKey, at });
    },
    async recordAbortedAt(agentId: string, sessionKey: string, at: Date): Promise<void> {
      abortedAtCalls.push({ agentId, sessionKey, at });
    },
  };
}

// ─── T-023: Basic — 청크 5개 → onDelta 5회 + fullText 일치 + last_chunk_at 기록 ───

test("AC-014 T-023 Basic: chunk 5개 수신 시 onDelta 5회 호출, fullText 일치", async () => {
  const chunks = ["안", "녕", "하", "세", "요"];
  const repo = makeRepo();
  const deltaCalls: string[] = [];

  const result = await chatSendStream({
    agentId: "agent-001",
    sessionKey: "agent:agent-001:dm",
    message: "hi",
    baseUrl: "http://nanobot.local",
    onDelta: (chunk) => { deltaCalls.push(chunk); },
    fetcher: makeFetcher(makeSSEStream(chunks)),
    repo,
    timeoutMs: 5000,
  });

  // onDelta 5회
  assert.equal(deltaCalls.length, 5, "onDelta는 chunk 수만큼 호출되어야 한다");
  assert.deepEqual(deltaCalls, chunks);

  // fullText = 모든 chunk 연결
  assert.equal(result.fullText, chunks.join(""), "fullText는 모든 chunk의 연결이어야 한다");
  assert.equal(result.aborted, false);

  // last_chunk_at 기록
  assert.equal(repo.lastChunkAtCalls.length, 1, "last_chunk_at은 1회 기록되어야 한다");
  assert.equal(repo.lastChunkAtCalls[0].agentId, "agent-001");
  assert.equal(repo.lastChunkAtCalls[0].sessionKey, "agent:agent-001:dm");
  assert.ok(repo.lastChunkAtCalls[0].at instanceof Date);

  // aborted_at은 기록되지 않아야 한다
  assert.equal(repo.abortedAtCalls.length, 0);
});

// ─── T-023: onDelta 호출 순서가 SSE 수신 순서와 동일해야 한다 ───

test("AC-014 T-023 Edge: onDelta 호출 순서 = SSE chunk 수신 순서", async () => {
  const chunks = ["Alpha", "Beta", "Gamma"];
  const repo = makeRepo();
  const deltaOrder: string[] = [];

  await chatSendStream({
    agentId: "agent-002",
    sessionKey: "agent:agent-002:session",
    message: "test order",
    baseUrl: "http://nanobot.local",
    onDelta: (c) => { deltaOrder.push(c); },
    fetcher: makeFetcher(makeSSEStream(chunks)),
    repo,
    timeoutMs: 5000,
  });

  assert.deepEqual(deltaOrder, ["Alpha", "Beta", "Gamma"]);
});

// ─── T-023: 빈 스트림 (chunk 0개) — fullText 빈 문자열, last_chunk_at 기록 안 함 ───

test("AC-014 T-023 Edge: 빈 스트림(chunk 0개)은 fullText='' + onDelta 0회 + last_chunk_at 미기록", async () => {
  const repo = makeRepo();
  const deltaCalls: string[] = [];

  const result = await chatSendStream({
    agentId: "agent-003",
    sessionKey: "agent:agent-003:empty",
    message: "empty test",
    baseUrl: "http://nanobot.local",
    onDelta: (c) => { deltaCalls.push(c); },
    fetcher: makeFetcher(makeSSEStream([])),
    repo,
    timeoutMs: 5000,
  });

  assert.equal(deltaCalls.length, 0, "빈 스트림에서 onDelta는 호출되지 않아야 한다");
  assert.equal(result.fullText, "");
  assert.equal(result.aborted, false);
  // 마지막 chunk가 없으므로 last_chunk_at 기록 없음
  assert.equal(repo.lastChunkAtCalls.length, 0, "빈 스트림에서는 last_chunk_at을 기록하지 않아야 한다");
});

// ─── T-023: [DONE] 토큰은 onDelta로 전달되지 않아야 한다 ───

test("AC-014 T-023 Edge: [DONE] sentinel은 onDelta 콜백에 전달되지 않아야 한다", async () => {
  const chunks = ["hello", "world"];
  const repo = makeRepo();
  const deltaCalls: string[] = [];

  await chatSendStream({
    agentId: "agent-004",
    sessionKey: "agent:agent-004:done-test",
    message: "done test",
    baseUrl: "http://nanobot.local",
    onDelta: (c) => { deltaCalls.push(c); },
    fetcher: makeFetcher(makeSSEStream(chunks)),
    repo,
    timeoutMs: 5000,
  });

  assert.ok(!deltaCalls.includes("[DONE]"), "[DONE] sentinel은 onDelta로 누출되면 안 된다");
  assert.deepEqual(deltaCalls, chunks);
});

// ─── T-023: 단일 chunk — last_chunk_at은 마지막 chunk 시각 ───

test("AC-014 T-023 Basic: chunk 1개 — last_chunk_at은 해당 chunk 수신 시각에 근접", async () => {
  const repo = makeRepo();
  const beforeCall = new Date();

  await chatSendStream({
    agentId: "agent-005",
    sessionKey: "agent:agent-005:single",
    message: "single chunk",
    baseUrl: "http://nanobot.local",
    onDelta: () => {},
    fetcher: makeFetcher(makeSSEStream(["one chunk"])),
    repo,
    timeoutMs: 5000,
  });

  const afterCall = new Date();
  assert.equal(repo.lastChunkAtCalls.length, 1);
  const recorded = repo.lastChunkAtCalls[0].at.getTime();
  assert.ok(
    recorded >= beforeCall.getTime() && recorded <= afterCall.getTime() + 100,
    "last_chunk_at은 호출 전후 시각 범위 내여야 한다",
  );
});

// ─── T-024: Basic — 180s timeout 후 에러 throw + aborted_at 기록 ───
//
// MockTimers를 이용해 시간을 가속한다. 실제 180초를 기다리지 않는다.

test("AC-014 T-024 Basic: 180s timeout 초과 시 TimeoutError throw + repo.recordAbortedAt 호출", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const repo = makeRepo();
  let streamAborted = false;

  // 절대 데이터를 보내지 않는 fetcher — AbortSignal로만 종료 가능
  const hangingFetcher: ChatStreamFetcher = async (_url, init) => {
    return new Promise<Response>((_, reject) => {
      const signal = (init as RequestInit & { signal?: AbortSignal }).signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          streamAborted = true;
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      }
      // 아무것도 resolve/reject 안 함 — 영원히 pending
    });
  };

  const callPromise = chatSendStream({
    agentId: "agent-006",
    sessionKey: "agent:agent-006:timeout",
    message: "will timeout",
    baseUrl: "http://nanobot.local",
    onDelta: () => {},
    fetcher: hangingFetcher,
    repo,
    timeoutMs: 180_000,
  });

  // 180초 타이머를 가속
  t.mock.timers.tick(180_000);

  await assert.rejects(callPromise, (err: Error) => {
    // TimeoutError 또는 AbortError — 구현이 어떤 에러를 throw하든 timeout 관련이어야 함
    return (
      err.name === "TimeoutError" ||
      err.name === "AbortError" ||
      /timeout/i.test(err.message)
    );
  });

  // aborted_at은 기록되어야 한다
  assert.equal(repo.abortedAtCalls.length, 1, "timeout 시 aborted_at이 기록되어야 한다");
  assert.equal(repo.abortedAtCalls[0].agentId, "agent-006");
  assert.equal(repo.abortedAtCalls[0].sessionKey, "agent:agent-006:timeout");
  assert.ok(repo.abortedAtCalls[0].at instanceof Date);

  // 실제 in-flight fetch가 abort되어야 한다
  assert.equal(streamAborted, true, "timeout 발생 시 in-flight fetch가 abort되어야 한다");

  t.mock.timers.reset();
});

// ─── T-024: Edge — timeout 이전에 완료되면 aborted_at 기록 안 함 ───

test("AC-014 T-024 Edge: timeout 이전에 정상 완료된 경우 aborted_at은 기록되지 않는다", async () => {
  const repo = makeRepo();

  await chatSendStream({
    agentId: "agent-007",
    sessionKey: "agent:agent-007:fast",
    message: "fast response",
    baseUrl: "http://nanobot.local",
    onDelta: () => {},
    fetcher: makeFetcher(makeSSEStream(["fast", "done"])),
    repo,
    timeoutMs: 180_000,
  });

  assert.equal(repo.abortedAtCalls.length, 0, "정상 완료 시 aborted_at은 기록되면 안 된다");
});

// ─── T-024: Edge — timeoutMs=0 (즉시 타임아웃) ───

test("AC-014 T-024 Edge: timeoutMs=0이면 즉시 timeout error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const repo = makeRepo();

  const callPromise = chatSendStream({
    agentId: "agent-008",
    sessionKey: "agent:agent-008:zero-timeout",
    message: "instant timeout",
    baseUrl: "http://nanobot.local",
    onDelta: () => {},
    fetcher: async (_url, init) => {
      return new Promise<Response>((_, reject) => {
        const signal = (init as RequestInit & { signal?: AbortSignal }).signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }
      });
    },
    repo,
    timeoutMs: 0,
  });

  t.mock.timers.tick(0);

  await assert.rejects(callPromise, (err: Error) => {
    return (
      err.name === "TimeoutError" ||
      err.name === "AbortError" ||
      /timeout/i.test(err.message)
    );
  });

  assert.equal(repo.abortedAtCalls.length, 1);
  t.mock.timers.reset();
});

// ─── T-025: Basic — chatAbortStream: onDelta 중단 + aborted_at 기록 ───

test("AC-014 T-025 Basic: chatAbortStream 호출 시 스트림 중단 + aborted=true 반환 + aborted_at 기록", async () => {
  const repo = makeRepo();
  const deltaCalls: string[] = [];
  const ac = new AbortController();

  // 첫 chunk 직후 외부에서 abort를 호출하는 fetcher
  let onAbortCallback: (() => void) | null = null;
  const controlledFetcher: ChatStreamFetcher = async (_url, init): Promise<Response> => {
    const encoder = new TextEncoder();
    let chunksSent = 0;
    const signal = (init as RequestInit & { signal?: AbortSignal }).signal;

    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          // chunk 1 전송
          controller.enqueue(encoder.encode("data: first\n\n"));
          chunksSent++;

          // 외부에서 abort 요청이 오기를 기다림
          await new Promise<void>((resolve) => {
            onAbortCallback = resolve;
            if (signal?.aborted) resolve();
            else signal?.addEventListener("abort", () => resolve());
          });

          // abort 후에는 추가 chunk를 보내지 않고 에러로 닫음
          controller.error(new DOMException("Aborted", "AbortError"));
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  };

  const chatPromise = chatSendStream({
    agentId: "agent-009",
    sessionKey: "agent:agent-009:abort-test",
    message: "will be aborted",
    baseUrl: "http://nanobot.local",
    onDelta: (c) => { deltaCalls.push(c); },
    fetcher: controlledFetcher,
    repo,
    timeoutMs: 180_000,
    abortController: ac,
  });

  // 첫 chunk가 전달될 때까지 기다린 후 abort
  // setImmediate 대신 microtask 대기
  await new Promise<void>((resolve) => setImmediate(resolve));

  const abortResult = await chatAbortStream({
    agentId: "agent-009",
    sessionKey: "agent:agent-009:abort-test",
    abortController: ac,
    repo,
  });

  assert.equal(abortResult.aborted, true, "chatAbortStream은 aborted=true를 반환해야 한다");

  // chatSendStream은 aborted=true로 완료되어야 한다 (re-throw 안 함 또는 aborted 플래그)
  const result = await chatPromise.catch((err: Error) => {
    // AbortError는 허용 — 구현에 따라 throw 또는 { aborted: true } 반환
    if (err.name === "AbortError") return { fullText: deltaCalls.join(""), aborted: true };
    throw err;
  });

  assert.equal(result.aborted, true, "chatSendStream은 abort 시 aborted=true를 반환해야 한다");

  // abort 이후에는 onDelta가 추가 호출되지 않아야 한다
  const countAfterAbort = deltaCalls.length;
  // 잠시 대기 후 추가 호출이 없는지 확인
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(deltaCalls.length, countAfterAbort, "abort 이후 onDelta가 추가 호출되면 안 된다");

  // aborted_at 기록
  assert.equal(repo.abortedAtCalls.length, 1, "chatAbortStream은 aborted_at을 기록해야 한다");
  assert.equal(repo.abortedAtCalls[0].agentId, "agent-009");
  assert.equal(repo.abortedAtCalls[0].sessionKey, "agent:agent-009:abort-test");
  assert.ok(repo.abortedAtCalls[0].at instanceof Date);
});

// ─── T-025: Edge — 첫 chunk 전에 abort (아무 chunk도 오기 전 취소) ───

test("AC-014 T-025 Edge: 첫 chunk 수신 전 chatAbortStream — onDelta 0회 + aborted=true", async () => {
  const repo = makeRepo();
  const deltaCalls: string[] = [];
  const ac = new AbortController();

  // fetch 요청이 오면 즉시 abort signal을 받아 취소되는 fetcher
  const neverResolveFetcher: ChatStreamFetcher = async (_url, init): Promise<Response> => {
    return new Promise<Response>((_, reject) => {
      const signal = (init as RequestInit & { signal?: AbortSignal }).signal;
      if (signal) {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }
    });
  };

  const chatPromise = chatSendStream({
    agentId: "agent-010",
    sessionKey: "agent:agent-010:pre-abort",
    message: "abort before first chunk",
    baseUrl: "http://nanobot.local",
    onDelta: (c) => { deltaCalls.push(c); },
    fetcher: neverResolveFetcher,
    repo,
    timeoutMs: 180_000,
    abortController: ac,
  });

  // chatSend가 fetch를 시작하기 전에 abort
  const abortResult = await chatAbortStream({
    agentId: "agent-010",
    sessionKey: "agent:agent-010:pre-abort",
    abortController: ac,
    repo,
  });

  const result = await chatPromise.catch((err: Error) => {
    if (err.name === "AbortError") return { fullText: "", aborted: true };
    throw err;
  });

  assert.equal(abortResult.aborted, true);
  assert.equal(result.aborted, true);
  assert.equal(deltaCalls.length, 0, "첫 chunk 전 abort시 onDelta는 0회여야 한다");
  assert.equal(repo.abortedAtCalls.length, 1);
});

// ─── T-025: Edge — abort 후 chatAbortStream 중복 호출 — idempotent (no throw) ───

test("AC-014 T-025 Edge: chatAbortStream 중복 호출은 에러 없이 처리 (idempotent)", async () => {
  const repo = makeRepo();
  const ac = new AbortController();

  // 이미 abort된 컨트롤러로 chatAbortStream 재호출
  ac.abort();

  const result = await chatAbortStream({
    agentId: "agent-011",
    sessionKey: "agent:agent-011:double-abort",
    abortController: ac,
    repo,
  });

  assert.equal(result.aborted, true, "이미 abort된 상태에서도 aborted=true 반환");
  // aborted_at은 1회만 기록되어야 한다 (중복 기록 금지)
  assert.ok(
    repo.abortedAtCalls.length <= 1,
    "aborted_at은 중복 기록되면 안 된다",
  );
});

// ─── Error: 네트워크 에러 (fetch 자체 실패) — aborted_at 기록 없이 throw ───

test("AC-014 Error: fetch 네트워크 에러 시 에러 throw (aborted_at 미기록)", async () => {
  const repo = makeRepo();

  const errorFetcher: ChatStreamFetcher = async () => {
    throw new TypeError("fetch failed: ECONNREFUSED");
  };

  await assert.rejects(
    chatSendStream({
      agentId: "agent-012",
      sessionKey: "agent:agent-012:network-error",
      message: "network fail",
      baseUrl: "http://nanobot.local",
      onDelta: () => {},
      fetcher: errorFetcher,
      repo,
      timeoutMs: 180_000,
    }),
    /fetch failed|ECONNREFUSED|network/i,
  );

  // 네트워크 에러는 timeout/abort가 아니므로 aborted_at 미기록
  assert.equal(repo.abortedAtCalls.length, 0, "네트워크 에러는 aborted_at을 기록하면 안 된다");
});

// ─── Error: HTTP 4xx/5xx 응답 — 에러 throw ───

test("AC-014 Error: nanobot HTTP 4xx 응답 시 에러 throw", async () => {
  const repo = makeRepo();

  const errorFetcher: ChatStreamFetcher = async () => {
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(
    chatSendStream({
      agentId: "agent-013",
      sessionKey: "agent:agent-013:404",
      message: "test 404",
      baseUrl: "http://nanobot.local",
      onDelta: () => {},
      fetcher: errorFetcher,
      repo,
      timeoutMs: 180_000,
    }),
    (err: Error) => /4\d\d|not found|status/i.test(err.message),
  );
});

// ─── Error: agentId 빈 문자열 — 즉시 throw (검증) ───

test("AC-014 Error: agentId 빈 문자열 시 즉시 에러 throw", async () => {
  const repo = makeRepo();

  await assert.rejects(
    chatSendStream({
      agentId: "",
      sessionKey: "agent::test",
      message: "test",
      baseUrl: "http://nanobot.local",
      onDelta: () => {},
      fetcher: makeFetcher(makeSSEStream(["x"])),
      repo,
      timeoutMs: 5000,
    }),
    /agentId required|agentId/i,
  );
});

// ─── Edge: 매우 빠른 완료 — last_chunk_at은 timeout 타이머 이전에 기록 ───

test("AC-014 Edge: 즉시 완료 스트림은 last_chunk_at 기록 후 timeout이 취소된다 (timeout 에러 없음)", async () => {
  const repo = makeRepo();

  // 이 테스트는 reject가 없어야 한다 — 즉시 완료가 timeout보다 먼저
  const result = await chatSendStream({
    agentId: "agent-014",
    sessionKey: "agent:agent-014:fast-complete",
    message: "instant complete",
    baseUrl: "http://nanobot.local",
    onDelta: () => {},
    fetcher: makeFetcher(makeSSEStream(["fast"])),
    repo,
    timeoutMs: 180_000,
  });

  assert.equal(result.aborted, false);
  assert.equal(result.fullText, "fast");
  assert.equal(repo.lastChunkAtCalls.length, 1);
  assert.equal(repo.abortedAtCalls.length, 0);
});
