// seed-v9 Phase 1 verify-only tests (T-005 + T-007 회귀 보호 baseline).
// 실코드 변경 0 — 기존 production 동작 회귀 방지가 목적.
//
// run: npm test (tsx --test)

import { test } from "node:test";
import assert from "node:assert/strict";

// JWT_SECRET 미설정 시 dev fallback 사용 (NODE_ENV=test에서도 동작하도록 production이 아닌 한 OK)
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-gateway-encryption";

import {
  encryptGatewayToken,
  decryptGatewayToken,
  normalizeGatewayBaseUrl,
  bindGatewayToChannel,
  unbindGatewayFromChannel,
} from "./gateway-resources";

// ─── T-005: encryptGatewayToken / decryptGatewayToken round-trip (AES-256-GCM v1) ───

test("encryptGatewayToken → decryptGatewayToken: plain text round-trip", () => {
  const plain = "bearer-token-12345-abcdef";
  const encrypted = encryptGatewayToken(plain);
  assert.ok(encrypted.startsWith("v1:"), "encrypted payload should start with 'v1:'");
  const parts = encrypted.split(":");
  assert.equal(parts.length, 4, "format: v1:iv:tag:encrypted (base64url)");
  const decrypted = decryptGatewayToken(encrypted);
  assert.equal(decrypted, plain, "round-trip preserves plaintext");
});

test("encryptGatewayToken: different IV per call (non-deterministic)", () => {
  const plain = "same-token";
  const enc1 = encryptGatewayToken(plain);
  const enc2 = encryptGatewayToken(plain);
  assert.notEqual(enc1, enc2, "AES-GCM uses random IV — two encrypts of same plaintext differ");
  assert.equal(decryptGatewayToken(enc1), plain);
  assert.equal(decryptGatewayToken(enc2), plain);
});

test("decryptGatewayToken: invalid format throws", () => {
  assert.throws(() => decryptGatewayToken("not-a-valid-payload"), /Invalid gateway token payload/);
  assert.throws(() => decryptGatewayToken("v2:a:b:c"), /Invalid gateway token payload/);
  assert.throws(() => decryptGatewayToken("v1:only:two"), /Invalid gateway token payload/);
});

test("decryptGatewayToken: tampered payload throws (auth tag mismatch)", () => {
  const enc = encryptGatewayToken("secret");
  const tampered = enc.slice(0, -4) + "XXXX";  // mutate last 4 chars of encrypted
  assert.throws(() => decryptGatewayToken(tampered));
});

// ─── normalizeGatewayBaseUrl (보조 helper, T-005 범위) ───

test("normalizeGatewayBaseUrl: strips trailing slash", () => {
  assert.equal(normalizeGatewayBaseUrl("https://example.com/"), "https://example.com");
  assert.equal(normalizeGatewayBaseUrl("https://example.com"), "https://example.com");
});

test("normalizeGatewayBaseUrl: preserves path without trailing slash", () => {
  assert.equal(normalizeGatewayBaseUrl("https://example.com/api"), "https://example.com/api");
  assert.equal(normalizeGatewayBaseUrl("https://example.com/api/"), "https://example.com/api");
});

// ─── T-007: bindGatewayToChannel / unbindGatewayFromChannel signature smoke ───
// 실제 DB 호출은 integration test (testcontainers Postgres 필요). 본 테스트는 export 존재 + async 시그니처만.

test("bindGatewayToChannel: exported as async function", () => {
  assert.equal(typeof bindGatewayToChannel, "function");
  assert.equal(bindGatewayToChannel.constructor.name, "AsyncFunction");
});

test("unbindGatewayFromChannel: exported as async function", () => {
  assert.equal(typeof unbindGatewayFromChannel, "function");
  assert.equal(unbindGatewayFromChannel.constructor.name, "AsyncFunction");
});
