// seed-v9 Phase 2 verify-only baseline (T-008/009/010 — AC-017 error mapping parity).
//
// AC-017 검증: nanobot 에러도 openclaw 호환 shape으로 응답되는지.
// 기존 buildGatewayErrorPayload + getGatewayErrorStatus가 generic이라
// nanobot adapter가 throw하는 generic Error도 동일하게 정규화됨을 보장.
//
// run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gateway = require("./openclaw-gateway.js") as {
  buildGatewayErrorPayload: (
    error: unknown,
    opts?: { ok?: boolean; fallbackErrorCode?: string; fallbackError?: string },
  ) => {
    ok: boolean;
    errorCode: string;
    error: string;
    requestId?: string;
    details?: unknown;
  };
  getGatewayErrorStatus: (error: unknown, fallbackStatus?: number) => number;
  OpenClawGatewayError: new (init: {
    errorCode?: string;
    error: string;
    requestId?: string | null;
    details?: unknown;
    pairingRequired?: boolean;
  }) => Error;
};

// ─── T-008: buildGatewayErrorPayload — nanobot generic Error 입력에 대해 표준 shape 반환 ───

test("buildGatewayErrorPayload: nanobot generic Error → {ok:false, errorCode, error} shape", () => {
  const nanobotErr = new Error("nanobot upstream unavailable");
  const payload = gateway.buildGatewayErrorPayload(nanobotErr);
  assert.equal(payload.ok, false);
  assert.equal(typeof payload.errorCode, "string");
  assert.equal(payload.error, "nanobot upstream unavailable");
});

test("buildGatewayErrorPayload: error with errorCode 'PAIRING_REQUIRED' → response errorCode mapped to 'gateway_pairing_required'", () => {
  const err = Object.assign(new Error("device not paired"), { errorCode: "PAIRING_REQUIRED" });
  const payload = gateway.buildGatewayErrorPayload(err);
  assert.equal(payload.errorCode, "gateway_pairing_required");
});

test("buildGatewayErrorPayload: error with requestId is preserved", () => {
  const err = Object.assign(new Error("rpc failed"), { requestId: "req-12345" });
  const payload = gateway.buildGatewayErrorPayload(err);
  assert.equal(payload.requestId, "req-12345");
});

test("buildGatewayErrorPayload: details propagated when present", () => {
  const err = Object.assign(new Error("bad input"), {
    errorCode: "INVALID_PARAM",
    details: { field: "agentId", reason: "missing" },
  });
  const payload = gateway.buildGatewayErrorPayload(err);
  assert.deepEqual(payload.details, { field: "agentId", reason: "missing" });
});

test("buildGatewayErrorPayload: OpenClawGatewayError pass-through preserves all fields", () => {
  const err = new gateway.OpenClawGatewayError({
    errorCode: "AUTH_FAILED",
    error: "invalid token",
    requestId: "r-1",
    details: { hint: "rotate" },
    pairingRequired: false,
  });
  const payload = gateway.buildGatewayErrorPayload(err);
  assert.equal(payload.errorCode, "AUTH_FAILED");
  assert.equal(payload.error, "invalid token");
  assert.equal(payload.requestId, "r-1");
});

test("buildGatewayErrorPayload: ok=true option overrides default false", () => {
  const payload = gateway.buildGatewayErrorPayload(new Error("e"), { ok: true });
  assert.equal(payload.ok, true);
});

test("buildGatewayErrorPayload: fallbackError used when error.message missing", () => {
  // empty object — no message
  const payload = gateway.buildGatewayErrorPayload({}, { fallbackError: "custom-fallback" });
  assert.equal(payload.error, "custom-fallback");
});

// ─── T-009: getGatewayErrorStatus — HTTP status 매핑 ───

test("getGatewayErrorStatus: pairing-required error → HTTP 409", () => {
  const err = new gateway.OpenClawGatewayError({
    errorCode: "PAIRING_REQUIRED",
    error: "pair first",
    pairingRequired: true,
  });
  assert.equal(gateway.getGatewayErrorStatus(err), 409);
});

test("getGatewayErrorStatus: NOT_PAIRED also → 409", () => {
  const err = Object.assign(new Error("e"), { errorCode: "NOT_PAIRED" });
  assert.equal(gateway.getGatewayErrorStatus(err), 409);
});

test("getGatewayErrorStatus: generic error → fallback 500", () => {
  const err = new Error("random failure");
  assert.equal(gateway.getGatewayErrorStatus(err), 500);
});

test("getGatewayErrorStatus: custom fallback honored", () => {
  const err = new Error("bad request payload");
  assert.equal(gateway.getGatewayErrorStatus(err, 400), 400);
});

test("getGatewayErrorStatus: details.code='PAIRING_REQUIRED' also triggers 409", () => {
  const err = Object.assign(new Error("e"), {
    errorCode: "RPC_ERROR",
    details: { code: "PAIRING_REQUIRED" },
  });
  assert.equal(gateway.getGatewayErrorStatus(err), 409);
});

// ─── T-010: AC-013 nanobot adapter 에러도 같은 응답 shape ───
// (실제 API route 통합은 AC-013 구현 시 같이 검증. 본 테스트는 mapping 함수 단위만.)

test("integration smoke: nanobot adapter style error → 정규화", () => {
  // nanobot-client.cjs의 chatSend가 throw하는 패턴 모방
  const nanobotErr = new Error("Nanobot HTTP 502");
  const payload = gateway.buildGatewayErrorPayload(nanobotErr);
  const status = gateway.getGatewayErrorStatus(nanobotErr);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "Nanobot HTTP 502");
  assert.equal(status, 500); // 일반 에러
});
