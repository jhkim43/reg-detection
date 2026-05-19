// seed-v9 AC-020 T-031 — buildLlmUsageUpdatePayload 단위 테스트.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLlmUsageUpdatePayload,
  type LlmUsageRecordLike,
} from "./llm-usage-event";

function baseRecord(overrides: Partial<LlmUsageRecordLike> = {}): LlmUsageRecordLike {
  return {
    id: "rec-1",
    sessionKey: "api:agent-x-dm-user-1",
    npcId: "11111111-1111-1111-1111-111111111111",
    provider: "NANOBOT",
    model: "qwen/qwen3.6-35b-a3b",
    inputTokens: 200,
    outputTokens: 100,
    cachedTokens: 0,
    costUsd: 0.0123,
    phase: "llm_response",
    createdAt: new Date("2026-05-19T03:30:00.000Z"),
    ...overrides,
  };
}

test("buildLlmUsageUpdatePayload: pass-through of required widget fields", () => {
  const payload = buildLlmUsageUpdatePayload(baseRecord());
  assert.equal(payload.id, "rec-1");
  assert.equal(payload.sessionKey, "api:agent-x-dm-user-1");
  assert.equal(payload.provider, "NANOBOT");
  assert.equal(payload.model, "qwen/qwen3.6-35b-a3b");
  assert.equal(payload.inputTokens, 200);
  assert.equal(payload.outputTokens, 100);
  assert.equal(payload.cachedTokens, 0);
  assert.equal(payload.costUsd, 0.0123);
  assert.equal(payload.phase, "llm_response");
});

test("buildLlmUsageUpdatePayload: cacheHit=true when cachedTokens > 0", () => {
  const payload = buildLlmUsageUpdatePayload(baseRecord({ cachedTokens: 1 }));
  assert.equal(payload.cacheHit, true);
});

test("buildLlmUsageUpdatePayload: cacheHit=false when cachedTokens === 0", () => {
  const payload = buildLlmUsageUpdatePayload(baseRecord({ cachedTokens: 0 }));
  assert.equal(payload.cacheHit, false);
});

test("buildLlmUsageUpdatePayload: createdAt Date → ISO string", () => {
  const payload = buildLlmUsageUpdatePayload(
    baseRecord({ createdAt: new Date("2026-05-19T03:30:00.000Z") }),
  );
  assert.equal(payload.createdAt, "2026-05-19T03:30:00.000Z");
});

test("buildLlmUsageUpdatePayload: createdAt already-string is preserved", () => {
  const payload = buildLlmUsageUpdatePayload(
    baseRecord({ createdAt: "2026-05-19T03:30:00.000Z" }),
  );
  assert.equal(payload.createdAt, "2026-05-19T03:30:00.000Z");
});

test("buildLlmUsageUpdatePayload: null createdAt → null", () => {
  const payload = buildLlmUsageUpdatePayload(baseRecord({ createdAt: null }));
  assert.equal(payload.createdAt, null);
});

test("buildLlmUsageUpdatePayload: Drizzle numeric costUsd as string is coerced to number", () => {
  // Postgres `numeric` 컬럼은 Drizzle에서 string으로 반환되는 경우가 있다.
  const payload = buildLlmUsageUpdatePayload(baseRecord({ costUsd: "0.045" }));
  assert.equal(payload.costUsd, 0.045);
});

test("buildLlmUsageUpdatePayload: negative tokens are clamped to 0", () => {
  const payload = buildLlmUsageUpdatePayload(
    baseRecord({ inputTokens: -5, outputTokens: -3, cachedTokens: -1 }),
  );
  assert.equal(payload.inputTokens, 0);
  assert.equal(payload.outputTokens, 0);
  assert.equal(payload.cachedTokens, 0);
  assert.equal(payload.cacheHit, false);
});

test("buildLlmUsageUpdatePayload: fractional tokens are floored", () => {
  const payload = buildLlmUsageUpdatePayload(
    baseRecord({ inputTokens: 100.7, outputTokens: 50.2, cachedTokens: 5.9 }),
  );
  assert.equal(payload.inputTokens, 100);
  assert.equal(payload.outputTokens, 50);
  assert.equal(payload.cachedTokens, 5);
});

test("buildLlmUsageUpdatePayload: null npcId is preserved", () => {
  const payload = buildLlmUsageUpdatePayload(baseRecord({ npcId: null }));
  assert.equal(payload.npcId, null);
});

test("buildLlmUsageUpdatePayload: OPENROUTER provider passes through", () => {
  const payload = buildLlmUsageUpdatePayload(
    baseRecord({ provider: "OPENROUTER", model: "openrouter/anthropic/claude-3.5-sonnet" }),
  );
  assert.equal(payload.provider, "OPENROUTER");
  assert.equal(payload.model, "openrouter/anthropic/claude-3.5-sonnet");
});
