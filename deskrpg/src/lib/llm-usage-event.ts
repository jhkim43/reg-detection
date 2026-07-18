// seed-v9 AC-020 T-031 — WS llm-usage:update payload builder (Logic layer).
//
// /api/internal/llm-usage route는 nanobot LLMUsageHook으로부터 record를 받아
// DB insert 후 socket.io로 "llm-usage:update" event를 broadcast. 이 모듈은
// record → event payload 변환을 담당.
//
// thresholdLevel은 누적 합계 기반이므로 client-side에서 계산 (LlmUsageWidget).
// 서버는 per-record 데이터만 push.

export type LlmUsageRecordLike = {
  id: string;
  sessionKey: string;
  npcId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number | string;  // Drizzle numeric → string in PG
  phase: string | null;
  createdAt: Date | string | null;
};

export type LlmUsageUpdateEventPayload = {
  id: string;
  sessionKey: string;
  npcId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  /** seed-v9 AC-020 T-031: 클라이언트 cache_hit_rate 계산을 위한 boolean signal */
  cacheHit: boolean;
  phase: string | null;
  createdAt: string | null;
};

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function buildLlmUsageUpdatePayload(
  record: LlmUsageRecordLike,
): LlmUsageUpdateEventPayload {
  const cachedTokens = Math.max(0, Math.floor(toNumber(record.cachedTokens)));
  return {
    id: record.id,
    sessionKey: record.sessionKey,
    npcId: record.npcId,
    provider: record.provider,
    model: record.model,
    inputTokens: Math.max(0, Math.floor(toNumber(record.inputTokens))),
    outputTokens: Math.max(0, Math.floor(toNumber(record.outputTokens))),
    cachedTokens,
    costUsd: Math.max(0, toNumber(record.costUsd)),
    cacheHit: cachedTokens > 0,
    phase: record.phase,
    createdAt: toIsoString(record.createdAt),
  };
}
