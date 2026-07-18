// T-F07 — postNanobotChatAbort 단위 테스트.
// RFC-nanobot-cancel-endpoint §4.3 acceptance criteria.

import test from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const remoteAbort = require("./nanobot-remote-abort.js") as {
  postNanobotChatAbort: (baseUrl: string, sessionKey: string) => Promise<void>;
};
const { postNanobotChatAbort } = remoteAbort;

type FetchCall = { url: string; method?: string; contentType?: string };

function installFetchSpy(impl: (url: string, opts: RequestInit) => Promise<unknown>) {
  const calls: FetchCall[] = [];
  const orig = globalThis.fetch;
  // @ts-expect-error mock
  globalThis.fetch = async (url: string, opts: RequestInit = {}) => {
    const headers = (opts.headers || {}) as Record<string, string>;
    calls.push({ url, method: opts.method, contentType: headers["Content-Type"] });
    return impl(url, opts);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = orig;
    },
  };
}

test("postNanobotChatAbort POSTs to /chat/abort/{sessionKey} with JSON content-type", async () => {
  const spy = installFetchSpy(async () => ({ ok: true, status: 200 }));
  try {
    await postNanobotChatAbort("http://localhost:8900/v1", "agent:npc-1:greeting");
  } finally {
    spy.restore();
  }
  assert.equal(spy.calls.length, 1);
  // sessionKey의 ':'는 URL-encode되어야 한다.
  assert.equal(
    spy.calls[0].url,
    "http://localhost:8900/v1/chat/abort/agent%3Anpc-1%3Agreeting",
  );
  assert.equal(spy.calls[0].method, "POST");
  assert.equal(spy.calls[0].contentType, "application/json");
});

test("postNanobotChatAbort normalizes trailing slashes in baseUrl", async () => {
  const spy = installFetchSpy(async () => ({ ok: true, status: 200 }));
  try {
    await postNanobotChatAbort("http://localhost:8900/v1///", "s1");
  } finally {
    spy.restore();
  }
  assert.equal(spy.calls[0].url, "http://localhost:8900/v1/chat/abort/s1");
});

test("postNanobotChatAbort silently swallows fetch network errors (chatAbort 흐름 비차단)", async () => {
  const spy = installFetchSpy(async () => {
    throw new Error("network down");
  });
  try {
    // throw하면 안 된다.
    await postNanobotChatAbort("http://localhost:8900/v1", "s1");
  } finally {
    spy.restore();
  }
  // fetch는 호출되긴 했지만 에러가 새지 않음
  assert.equal(spy.calls.length, 1);
});

test("postNanobotChatAbort silently swallows 404/500 (best-effort)", async () => {
  // fetch가 throw하지 않고 ok=false 응답을 줘도 helper는 통과
  const spy = installFetchSpy(async () => ({
    ok: false,
    status: 404,
    text: async () => "not found",
  }));
  try {
    await postNanobotChatAbort("http://localhost:8900/v1", "s1");
  } finally {
    spy.restore();
  }
  assert.equal(spy.calls.length, 1);
});

test("postNanobotChatAbort no-op when baseUrl is empty/undefined", async () => {
  const spy = installFetchSpy(async () => ({ ok: true, status: 200 }));
  try {
    await postNanobotChatAbort("", "s1");
    // @ts-expect-error testing runtime guard
    await postNanobotChatAbort(undefined, "s1");
  } finally {
    spy.restore();
  }
  assert.equal(spy.calls.length, 0, "must not call fetch with empty baseUrl");
});
