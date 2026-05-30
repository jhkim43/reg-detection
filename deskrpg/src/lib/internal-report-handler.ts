// seed-v11 AC-002 — Logic Layer: agent-report push event handler.
//
// nanobot이 분석·요약·리포트 형태로 본문 큰 마크다운 결과물을 push할 때 호출.
// spec: docs/api/internal-events-contract.md Section 12 (planned).
//
// 패턴: v10 phase5/6 internal-chat-push-handler.ts 답습.
//   - 필수 필드 validation + channel/npc/character 존재 확인 + npc-channel 일치
//   - in-memory idempotency cache (Idempotency-Key 헤더, TTL 10분)
//   - agent_reports row insert + socket emit "npc:report-ready"
//   - emit 실패 시 row 영속 + 500 (TRD-D-41) — 다음 history fetch에서 클라이언트 복원

import { eq } from "drizzle-orm";
import { db as defaultDb, channels, npcs, characters, agentReports, jsonForDb } from "@/db";

export type ReportPushInput = {
  channelId: string;
  npcId: string;
  characterId: string;
  bodyMarkdown: string;
  title?: string;
  creatorSubAgentLabel?: string;
  metadata?: Record<string, unknown>;
};

export type ReportPushOk = {
  ok: true;
  statusCode: 201;
  persistedReportId: string;
};

export type ReportPushErr = {
  ok: false;
  statusCode: 400 | 401 | 403 | 404 | 409 | 500;
  errorCode:
    | "missing_required_field"
    | "channel_not_found"
    | "npc_not_found"
    | "character_not_found"
    | "duplicate_message"
    | "internal_error";
  field?: string;
};

export type ReportPushResult = ReportPushOk | ReportPushErr;

export type ReportPushEmit = (channelId: string, payload: unknown) => void | Promise<void>;

export type ReportPushDeps = {
  emit: ReportPushEmit;
  db?: typeof defaultDb;
  idempotencyKey?: string;
};

const idempotencyCache = new Map<string, { reportId: string; expiresAt: number }>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function cleanExpiredIdempotency(): void {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (entry.expiresAt <= now) idempotencyCache.delete(key);
  }
}

const REQUIRED_FIELDS: Array<keyof ReportPushInput> = [
  "channelId",
  "npcId",
  "characterId",
  "bodyMarkdown",
];

function validate(input: ReportPushInput): ReportPushErr | null {
  for (const field of REQUIRED_FIELDS) {
    const value = input[field];
    if (typeof value !== "string" || value.trim() === "") {
      return {
        ok: false,
        statusCode: 400,
        errorCode: "missing_required_field",
        field: String(field),
      };
    }
  }
  return null;
}

export async function handleReportPush(
  input: ReportPushInput,
  deps: ReportPushDeps,
): Promise<ReportPushResult> {
  const validation = validate(input);
  if (validation) return validation;

  const dbHandle = deps.db ?? defaultDb;

  if (deps.idempotencyKey) {
    cleanExpiredIdempotency();
    if (idempotencyCache.get(deps.idempotencyKey)) {
      return { ok: false, statusCode: 409, errorCode: "duplicate_message" };
    }
  }

  const [channel] = await dbHandle
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.id, input.channelId))
    .limit(1);
  if (!channel) return { ok: false, statusCode: 404, errorCode: "channel_not_found" };

  const [npc] = await dbHandle
    .select({ id: npcs.id, channelId: npcs.channelId })
    .from(npcs)
    .where(eq(npcs.id, input.npcId))
    .limit(1);
  if (!npc) return { ok: false, statusCode: 404, errorCode: "npc_not_found" };
  if (npc.channelId !== input.channelId) {
    return { ok: false, statusCode: 404, errorCode: "npc_not_found" };
  }

  const [character] = await dbHandle
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.id, input.characterId))
    .limit(1);
  if (!character) return { ok: false, statusCode: 404, errorCode: "character_not_found" };

  let reportId: string;
  try {
    const persistMetadata = {
      creatorSubAgentLabel: input.creatorSubAgentLabel ?? null,
      channelIdSnapshot: input.channelId,
      ...(input.metadata ?? {}),
    };
    const [row] = await dbHandle
      .insert(agentReports)
      .values({
        characterId: input.characterId,
        npcId: input.npcId,
        title: input.title ?? null,
        bodyMarkdown: input.bodyMarkdown,
        metadata: jsonForDb(persistMetadata) as never,
      } as never)
      .returning({ id: agentReports.id });
    reportId = row.id;
  } catch (err) {
    console.warn("[internal-report-handler] agent_reports insert failed:", err);
    return { ok: false, statusCode: 500, errorCode: "internal_error" };
  }

  try {
    await deps.emit(input.channelId, {
      reportId,
      npcId: input.npcId,
      channelId: input.channelId,
      title: input.title ?? null,
      creatorSubAgentLabel: input.creatorSubAgentLabel ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[internal-report-handler] socket emit failed:", err);
    return { ok: false, statusCode: 500, errorCode: "internal_error" };
  }

  if (deps.idempotencyKey) {
    idempotencyCache.set(deps.idempotencyKey, {
      reportId,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
  }

  return { ok: true, statusCode: 201, persistedReportId: reportId };
}
