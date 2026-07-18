// seed-v9 AC-016 — nanobot 게이트웨이 Ed25519 device pairing (provider-specific duplicate).
//
// 결정: D2=b (Duplicate). openclaw-gateway.js의 페어링 로직을 카피해서 nanobot 전용으로 분리.
// 이유: contract phase (phase 7)에서 openclaw 코드 일괄 삭제 예정 → 일시 중복 자연.
//
// 차이점 (openclaw 대비):
// - DEVICE_IDENTITIES_DIRNAME: "openclaw-devices" → "nanobot-devices"
// - 경로 root: getDeskRpgHomeDir → getNanobotHomeDir (~/.nanobot)
// - 4-state machine + PAIRING_MODE env 분기 추가
// - TypeScript 변환

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getNanobotHomeDir } from "./nanobot-agent-lifecycle";

// ─── Constants (openclaw 호환 — modern device auth v2 프로토콜) ───
const MODERN_CLIENT_ID = "cli";
const MODERN_CLIENT_MODE = "cli";
const MODERN_ROLE = "operator";
const MODERN_SCOPES = ["operator.read", "operator.write", "operator.admin"];
const DEVICE_IDENTITIES_DIRNAME = "nanobot-devices";  // seed-v9 D-21: ~/.nanobot-devices/

// ─── Pairing state (UI 4상태 + 부가 reconnecting/connecting) ───
export type PairingState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "pairing_required"
  | "error";

/** UI에 노출되는 4상태 (idle/connected/pairing_required/error). connecting/reconnecting은 내부. */
export function normalizeForUi(state: PairingState): "idle" | "connected" | "pairing_required" | "error" {
  switch (state) {
    case "connecting":
      return "idle";  // UI는 idle로 표시 (transient)
    case "reconnecting":
      return "connected";  // 재연결 중에는 connected 상태 유지
    case "idle":
    case "connected":
    case "pairing_required":
    case "error":
      return state;
  }
}

// ─── PAIRING_MODE env (seed-v9 D-18) ───
export type PairingMode = "auto" | "manual";

export function getPairingMode(env: Record<string, string | undefined> = process.env): PairingMode {
  const raw = env.PAIRING_MODE;
  if (raw === "manual") return "manual";
  return "auto";  // default for dev/demo
}

// ─── Helpers ───
function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function extractRawEd25519PublicKey(spkiDer: Buffer): Buffer {
  return spkiDer.subarray(-32);
}

function normalizeIdentityKey(input: string): string {
  try {
    const parsed = new URL(input);
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return input;
  }
}

/** seed-v9 D-21: ~/.nanobot-devices/${hash}.json */
export function getDeviceIdentityPath(
  identityKey: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const keyHash = crypto.createHash("sha256").update(normalizeIdentityKey(identityKey)).digest("hex");
  return path.join(getNanobotHomeDir(env), "..", DEVICE_IDENTITIES_DIRNAME, `${keyHash}.json`);
  // ~/.nanobot/../nanobot-devices = ~/.nanobot-devices (sibling of ~/.nanobot)
  // 시드 명세 그대로: ~/.nanobot-devices/${hash}.json
}

// ─── Device identity (Ed25519 keypair) ───
export type DeviceIdentity = {
  id: string;  // sha256(public_raw) hex
  publicKey: string;  // base64url
  privateKeyPem: string;
  createdAt: string;  // ISO
};

/** T-017: Ed25519 keypair 생성 + identity record */
export function generateDeviceIdentity(): DeviceIdentity {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicSpkiDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const publicRaw = extractRawEd25519PublicKey(publicSpkiDer);
  const deviceId = crypto.createHash("sha256").update(publicRaw).digest("hex");

  return {
    id: deviceId,
    publicKey: base64Url(publicRaw),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    createdAt: new Date().toISOString(),
  };
}

/** identity 디스크 로드 또는 새로 생성 (mode 0600). */
export function loadOrCreateDeviceIdentity(
  identityKey: string,
  env: Record<string, string | undefined> = process.env,
): DeviceIdentity {
  const identityPath = getDeviceIdentityPath(identityKey, env);
  fs.mkdirSync(path.dirname(identityPath), { recursive: true });

  if (fs.existsSync(identityPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(identityPath, "utf8")) as Partial<DeviceIdentity>;
      if (
        parsed &&
        typeof parsed.id === "string" &&
        typeof parsed.publicKey === "string" &&
        typeof parsed.privateKeyPem === "string"
      ) {
        return parsed as DeviceIdentity;
      }
    } catch {
      // corrupted file — regenerate
    }
  }

  const identity = generateDeviceIdentity();
  fs.writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return identity;
}

// ─── Challenge-response (T-018) ───
export type PairingChallenge = {
  nonce: string;
  ts: number;
};

export type SignedAuthPayload = {
  id: string;
  publicKey: string;
  signature: string;  // base64url
  signedAt: number;
  nonce: string;
};

/** T-018: challenge에 device private key로 서명. openclaw modern device auth v2와 동일 프로토콜. */
export function buildModernDeviceAuth(args: {
  challenge: PairingChallenge;
  token: string;
  identity: DeviceIdentity;
}): SignedAuthPayload {
  const { challenge, token, identity } = args;
  const payload = [
    "v2",
    identity.id,
    MODERN_CLIENT_ID,
    MODERN_CLIENT_MODE,
    MODERN_ROLE,
    MODERN_SCOPES.join(","),
    String(challenge.ts),
    token,
    challenge.nonce,
  ].join("|");

  const signature = crypto.sign(null, Buffer.from(payload), identity.privateKeyPem);
  return {
    id: identity.id,
    publicKey: identity.publicKey,
    signature: base64Url(signature),
    signedAt: challenge.ts,
    nonce: challenge.nonce,
  };
}

/** signature 검증 (테스트·디버깅용). */
export function verifyModernDeviceAuth(args: {
  challenge: PairingChallenge;
  token: string;
  publicKeyBase64Url: string;
  signatureBase64Url: string;
  deviceId: string;
}): boolean {
  const { challenge, token, publicKeyBase64Url, signatureBase64Url, deviceId } = args;
  try {
    const payload = [
      "v2",
      deviceId,
      MODERN_CLIENT_ID,
      MODERN_CLIENT_MODE,
      MODERN_ROLE,
      MODERN_SCOPES.join(","),
      String(challenge.ts),
      token,
      challenge.nonce,
    ].join("|");

    const sigBuf = Buffer.from(signatureBase64Url.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const publicRaw = Buffer.from(publicKeyBase64Url.replace(/-/g, "+").replace(/_/g, "/"), "base64");

    // Reconstruct SPKI from raw 32-byte ed25519 public key
    const SPKI_PREFIX = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ]);
    const spki = Buffer.concat([SPKI_PREFIX, publicRaw]);
    const publicKey = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });

    return crypto.verify(null, Buffer.from(payload), publicKey, sigBuf);
  } catch {
    return false;
  }
}

// ─── T-022: gateway pairing probe ───
//
// 게이트웨이에 인증 토큰으로 probe HTTP 요청을 보내 현재 페어링 상태를 판정한다.
// nanobot API 서버는 현재 인증 미적용(seed-v9 D-19)이므로 probe는 reachability +
// future-proof auth header만 보낸다. 강제 실패(invalid token) 시뮬레이션은
// fetcher mock으로 검증한다.

export type PairingAttemptResult = {
  state: "connected" | "pairing_required" | "error";
  deviceId: string;
  httpStatus: number;
  errorCode?: string;
  error?: string;
  /** "nanobot devices approve {deviceId}" — pairing_required일 때만 */
  instructions?: string;
};

export type GatewayPairingProbeFetcher = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; statusText?: string }>;

export async function attemptGatewayPairing(args: {
  baseUrl: string;
  token: string;
  /** device identity 키. 미지정 시 baseUrl 사용 (게이트웨이별 키 분리). */
  identityKey?: string;
  env?: Record<string, string | undefined>;
  fetcher?: GatewayPairingProbeFetcher;
  timeoutMs?: number;
}): Promise<PairingAttemptResult> {
  const env = args.env ?? process.env;
  const identityKey = args.identityKey ?? args.baseUrl;
  const identity = loadOrCreateDeviceIdentity(identityKey, env);
  const deviceId = identity.id;

  const fetcher: GatewayPairingProbeFetcher =
    args.fetcher ??
    (async (url, init) => {
      const res = await fetch(url, init as RequestInit);
      return { ok: res.ok, status: res.status, statusText: res.statusText };
    });

  const probeUrl = `${args.baseUrl.replace(/\/+$/, "")}/v1/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 10_000);

  try {
    const res = await fetcher(probeUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${args.token}` },
      signal: controller.signal,
    });

    if (res.ok) {
      return { state: "connected", deviceId, httpStatus: 200 };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        state: "pairing_required",
        deviceId,
        httpStatus: 409,
        errorCode: "PAIRING_REQUIRED",
        error: `Gateway rejected credentials (HTTP ${res.status}). Pair this device first.`,
        instructions: `nanobot devices approve ${deviceId}`,
      };
    }

    return {
      state: "error",
      deviceId,
      httpStatus: 502,
      errorCode: "gateway_unreachable",
      error: `Gateway probe failed: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      state: "error",
      deviceId,
      httpStatus: 502,
      errorCode: "gateway_unreachable",
      error: `Gateway probe failed: ${message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── 4-state machine transitions (T-019) ───
/**
 * 허용된 전이만 통과. 불법 전이는 error로 강제.
 * Happy path: idle → connecting → connected
 * Reconnect: connected → reconnecting → connected
 * Pair fail: idle → connecting → pairing_required
 * Auth fail: idle → connecting → error
 */
export function transitionPairingState(from: PairingState, event:
  | "connect_start"
  | "connect_ok"
  | "connect_pairing_required"
  | "connect_failed"
  | "reconnect_start"
  | "disconnect"
): PairingState {
  switch (from) {
    case "idle":
      if (event === "connect_start") return "connecting";
      break;
    case "connecting":
      if (event === "connect_ok") return "connected";
      if (event === "connect_pairing_required") return "pairing_required";
      if (event === "connect_failed") return "error";
      break;
    case "connected":
      if (event === "reconnect_start") return "reconnecting";
      if (event === "disconnect") return "idle";
      break;
    case "reconnecting":
      if (event === "connect_ok") return "connected";
      if (event === "connect_failed") return "error";
      if (event === "disconnect") return "idle";
      break;
    case "pairing_required":
      if (event === "connect_start") return "connecting";  // retry after manual pair
      if (event === "disconnect") return "idle";
      break;
    case "error":
      if (event === "connect_start") return "connecting";  // retry
      if (event === "disconnect") return "idle";
      break;
  }
  // illegal transition: stay in error
  return "error";
}
