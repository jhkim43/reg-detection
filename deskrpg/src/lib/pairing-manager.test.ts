// seed-v9 AC-016 — pairing-manager 단위 테스트 (T-017/018/019/020).
//
// Ed25519 keypair 생성 + 디스크 영속 + challenge 서명/검증 + 4-state machine + env 분기.
// NANOBOT_HOME으로 격리된 임시 디렉토리 사용.
//
// run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  generateDeviceIdentity,
  loadOrCreateDeviceIdentity,
  getDeviceIdentityPath,
  buildModernDeviceAuth,
  verifyModernDeviceAuth,
  transitionPairingState,
  getPairingMode,
  normalizeForUi,
  PairingState,
  PairingChallenge,
} from "./pairing-manager";

async function makeIsolatedHome(): Promise<{ env: Record<string, string | undefined>; cleanup: () => Promise<void> }> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pairing-test-"));
  const env = { ...process.env, NANOBOT_HOME: path.join(tmpRoot, ".nanobot") };
  return {
    env,
    cleanup: () => fs.rm(tmpRoot, { recursive: true, force: true }),
  };
}

// ─── T-017: generateDeviceIdentity ───

test("generateDeviceIdentity: produces Ed25519 keypair with hash-based id", () => {
  const identity = generateDeviceIdentity();
  assert.equal(typeof identity.id, "string");
  assert.equal(identity.id.length, 64, "id is sha256 hex (64 chars)");
  assert.match(identity.publicKey, /^[A-Za-z0-9_-]+$/, "publicKey is base64url");
  assert.ok(identity.privateKeyPem.includes("-----BEGIN PRIVATE KEY-----"), "PEM format");
  assert.ok(identity.privateKeyPem.includes("-----END PRIVATE KEY-----"));
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(identity.createdAt), "ISO timestamp");
});

test("generateDeviceIdentity: each call produces different keypair", () => {
  const a = generateDeviceIdentity();
  const b = generateDeviceIdentity();
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.publicKey, b.publicKey);
  assert.notEqual(a.privateKeyPem, b.privateKeyPem);
});

// ─── loadOrCreateDeviceIdentity ───

test("loadOrCreateDeviceIdentity: creates new identity on first call", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const identity = loadOrCreateDeviceIdentity("https://gateway.example.com", ctx.env);
  assert.equal(typeof identity.id, "string");

  // 파일 존재 확인 + 0600 권한
  const filePath = getDeviceIdentityPath("https://gateway.example.com", ctx.env);
  const stat = await fs.stat(filePath);
  assert.equal(stat.isFile(), true);
  // permission check (mode masked) — Unix only
  if (process.platform !== "win32") {
    assert.equal(stat.mode & 0o777, 0o600, "private key file should be mode 0600");
  }
});

test("loadOrCreateDeviceIdentity: subsequent call loads same identity", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const first = loadOrCreateDeviceIdentity("https://gw1", ctx.env);
  const second = loadOrCreateDeviceIdentity("https://gw1", ctx.env);
  assert.equal(first.id, second.id);
  assert.equal(first.publicKey, second.publicKey);
});

test("loadOrCreateDeviceIdentity: different identityKey → different identity file", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const a = loadOrCreateDeviceIdentity("https://gw-a", ctx.env);
  const b = loadOrCreateDeviceIdentity("https://gw-b", ctx.env);
  assert.notEqual(a.id, b.id);
});

test("loadOrCreateDeviceIdentity: regenerates if file is corrupted", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const first = loadOrCreateDeviceIdentity("https://gw-corrupt", ctx.env);
  const filePath = getDeviceIdentityPath("https://gw-corrupt", ctx.env);
  await fs.writeFile(filePath, "garbage non-json content", "utf8");

  const regenerated = loadOrCreateDeviceIdentity("https://gw-corrupt", ctx.env);
  assert.notEqual(first.id, regenerated.id, "corrupted file → new identity generated");
});

test("getDeviceIdentityPath: hash-based filename under ~/.nanobot-devices/", () => {
  const p = getDeviceIdentityPath("https://gateway.example.com", { NANOBOT_HOME: "/base/.nanobot" });
  assert.ok(p.includes("/nanobot-devices/"), `expected nanobot-devices in path, got: ${p}`);
  assert.ok(p.endsWith(".json"));
  // hash should be 64 hex chars
  const filename = path.basename(p, ".json");
  assert.match(filename, /^[a-f0-9]{64}$/);
});

// ─── T-018: buildModernDeviceAuth + verifyModernDeviceAuth round-trip ───

test("buildModernDeviceAuth + verifyModernDeviceAuth: round-trip verification", () => {
  const identity = generateDeviceIdentity();
  const challenge: PairingChallenge = { nonce: "random-nonce-abc", ts: 1700000000 };
  const token = "device-token-xyz";

  const signed = buildModernDeviceAuth({ challenge, token, identity });
  assert.equal(signed.id, identity.id);
  assert.equal(signed.publicKey, identity.publicKey);
  assert.equal(signed.nonce, challenge.nonce);
  assert.equal(signed.signedAt, challenge.ts);

  const ok = verifyModernDeviceAuth({
    challenge,
    token,
    publicKeyBase64Url: signed.publicKey,
    signatureBase64Url: signed.signature,
    deviceId: signed.id,
  });
  assert.equal(ok, true, "valid signature should verify");
});

test("verifyModernDeviceAuth: rejects when challenge tampered", () => {
  const identity = generateDeviceIdentity();
  const challenge: PairingChallenge = { nonce: "n1", ts: 1700000000 };
  const signed = buildModernDeviceAuth({ challenge, token: "t", identity });

  const ok = verifyModernDeviceAuth({
    challenge: { nonce: "TAMPERED", ts: 1700000000 },  // 다른 nonce
    token: "t",
    publicKeyBase64Url: signed.publicKey,
    signatureBase64Url: signed.signature,
    deviceId: signed.id,
  });
  assert.equal(ok, false);
});

test("verifyModernDeviceAuth: rejects when token tampered", () => {
  const identity = generateDeviceIdentity();
  const challenge: PairingChallenge = { nonce: "n1", ts: 1700000000 };
  const signed = buildModernDeviceAuth({ challenge, token: "original-token", identity });

  const ok = verifyModernDeviceAuth({
    challenge,
    token: "different-token",  // 다른 token
    publicKeyBase64Url: signed.publicKey,
    signatureBase64Url: signed.signature,
    deviceId: signed.id,
  });
  assert.equal(ok, false);
});

// ─── T-019: 4-state machine ───

test("transitionPairingState: happy path idle → connecting → connected", () => {
  let s: PairingState = "idle";
  s = transitionPairingState(s, "connect_start");
  assert.equal(s, "connecting");
  s = transitionPairingState(s, "connect_ok");
  assert.equal(s, "connected");
});

test("transitionPairingState: pair fail path → pairing_required", () => {
  let s: PairingState = "idle";
  s = transitionPairingState(s, "connect_start");
  s = transitionPairingState(s, "connect_pairing_required");
  assert.equal(s, "pairing_required");
});

test("transitionPairingState: auth fail path → error", () => {
  let s: PairingState = "idle";
  s = transitionPairingState(s, "connect_start");
  s = transitionPairingState(s, "connect_failed");
  assert.equal(s, "error");
});

test("transitionPairingState: reconnect cycle connected → reconnecting → connected", () => {
  let s: PairingState = "connected";
  s = transitionPairingState(s, "reconnect_start");
  assert.equal(s, "reconnecting");
  s = transitionPairingState(s, "connect_ok");
  assert.equal(s, "connected");
});

test("transitionPairingState: retry from error → connecting", () => {
  const s = transitionPairingState("error", "connect_start");
  assert.equal(s, "connecting");
});

test("transitionPairingState: retry from pairing_required → connecting", () => {
  const s = transitionPairingState("pairing_required", "connect_start");
  assert.equal(s, "connecting");
});

test("transitionPairingState: illegal transition → error", () => {
  // idle does not accept connect_ok
  const s = transitionPairingState("idle", "connect_ok");
  assert.equal(s, "error");
});

test("transitionPairingState: disconnect always → idle (from connected/reconnecting/pairing_required/error)", () => {
  assert.equal(transitionPairingState("connected", "disconnect"), "idle");
  assert.equal(transitionPairingState("reconnecting", "disconnect"), "idle");
  assert.equal(transitionPairingState("pairing_required", "disconnect"), "idle");
  assert.equal(transitionPairingState("error", "disconnect"), "idle");
});

// ─── normalizeForUi (4상태로 축약) ───

test("normalizeForUi: maps connecting → idle, reconnecting → connected", () => {
  assert.equal(normalizeForUi("connecting"), "idle");
  assert.equal(normalizeForUi("reconnecting"), "connected");
});

test("normalizeForUi: passes through 4 base states", () => {
  assert.equal(normalizeForUi("idle"), "idle");
  assert.equal(normalizeForUi("connected"), "connected");
  assert.equal(normalizeForUi("pairing_required"), "pairing_required");
  assert.equal(normalizeForUi("error"), "error");
});

// ─── T-020: PAIRING_MODE env ───

test("getPairingMode: default 'auto' when env missing", () => {
  assert.equal(getPairingMode({}), "auto");
});

test("getPairingMode: 'manual' when env set explicitly", () => {
  assert.equal(getPairingMode({ PAIRING_MODE: "manual" }), "manual");
});

test("getPairingMode: 'auto' for any other value (auto/'' /'something')", () => {
  assert.equal(getPairingMode({ PAIRING_MODE: "auto" }), "auto");
  assert.equal(getPairingMode({ PAIRING_MODE: "" }), "auto");
  assert.equal(getPairingMode({ PAIRING_MODE: "anything" }), "auto");
});
