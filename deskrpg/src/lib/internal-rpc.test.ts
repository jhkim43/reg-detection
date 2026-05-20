// seed-v9 Phase 1 verify-only test (T-006 회귀 보호 baseline).
// 실코드 변경 0 — internal-rpc + internal-transport의 인증 흐름 회귀 방지.
//
// 본 테스트는 buildInternalAuthHeaders / isInternalRequestAuthorized + URL helpers를 검증.
// internalRpc 자체의 HTTP/in-process delegation은 통합 테스트(별도 PR) 영역.
//
// run: npm test (tsx --test)

import { test } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const internalTransport = require("./internal-transport.js") as {
  INTERNAL_SECRET_HEADER: string;
  buildInternalAuthHeaders: (secret?: string) => Record<string, string>;
  getInternalSecret: (env?: Record<string, string | undefined>) => string;
  getInternalSocketBaseUrl: (env?: Record<string, string | undefined>) => string;
  getInternalSocketHostname: (env?: Record<string, string | undefined>) => string;
  getInternalSocketPort: (env?: Record<string, string | undefined>) => string;
  isInternalRequestAuthorized: (headers: Record<string, string> | Headers, secret?: string) => boolean;
};

// ─── Bearer/Secret 헤더 생성 ───

test("buildInternalAuthHeaders: returns header when secret present", () => {
  const headers = internalTransport.buildInternalAuthHeaders("my-secret");
  assert.equal(headers[internalTransport.INTERNAL_SECRET_HEADER], "my-secret");
});

test("buildInternalAuthHeaders: empty object when secret missing", () => {
  const headers = internalTransport.buildInternalAuthHeaders("");
  assert.deepEqual(headers, {});
});

test("INTERNAL_SECRET_HEADER constant", () => {
  assert.equal(internalTransport.INTERNAL_SECRET_HEADER, "x-deskrpg-internal-secret");
});

// ─── 인증 검증 ───

test("isInternalRequestAuthorized: matches secret in plain object headers", () => {
  const headers = { "x-deskrpg-internal-secret": "valid-secret" };
  assert.equal(internalTransport.isInternalRequestAuthorized(headers, "valid-secret"), true);
});

test("isInternalRequestAuthorized: rejects wrong secret", () => {
  const headers = { "x-deskrpg-internal-secret": "wrong-secret" };
  assert.equal(internalTransport.isInternalRequestAuthorized(headers, "expected"), false);
});

test("isInternalRequestAuthorized: rejects empty configured secret", () => {
  const headers = { "x-deskrpg-internal-secret": "anything" };
  assert.equal(internalTransport.isInternalRequestAuthorized(headers, ""), false);
});

test("isInternalRequestAuthorized: works with Headers-like object (get method)", () => {
  const headers = new Headers({ "x-deskrpg-internal-secret": "h-secret" });
  assert.equal(internalTransport.isInternalRequestAuthorized(headers, "h-secret"), true);
});

// ─── URL helpers (default + env override) ───

test("getInternalSocketHostname: default 127.0.0.1, override via INTERNAL_HOSTNAME", () => {
  assert.equal(internalTransport.getInternalSocketHostname({}), "127.0.0.1");
  assert.equal(
    internalTransport.getInternalSocketHostname({ INTERNAL_HOSTNAME: "10.0.0.5" }),
    "10.0.0.5",
  );
});

test("getInternalSocketPort: PORT+1 default 3001", () => {
  assert.equal(internalTransport.getInternalSocketPort({}), "3001");
  assert.equal(internalTransport.getInternalSocketPort({ PORT: "8080" }), "8081");
});

test("getInternalSocketBaseUrl: composes host + port", () => {
  assert.equal(internalTransport.getInternalSocketBaseUrl({}), "http://127.0.0.1:3001");
  assert.equal(
    internalTransport.getInternalSocketBaseUrl({ INTERNAL_HOSTNAME: "host", PORT: "5000" }),
    "http://host:5001",
  );
});

// ─── secret precedence (INTERNAL_RPC_SECRET > JWT_SECRET) ───

test("getInternalSecret: INTERNAL_RPC_SECRET takes precedence over JWT_SECRET", () => {
  assert.equal(
    internalTransport.getInternalSecret({
      INTERNAL_RPC_SECRET: "internal",
      JWT_SECRET: "jwt",
    }),
    "internal",
  );
});

test("getInternalSecret: falls back to JWT_SECRET", () => {
  assert.equal(internalTransport.getInternalSecret({ JWT_SECRET: "jwt-only" }), "jwt-only");
});

test("getInternalSecret: empty when both absent", () => {
  assert.equal(internalTransport.getInternalSecret({}), "");
});
