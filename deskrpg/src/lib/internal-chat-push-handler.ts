// seed-v10 phase5 T-V32 — Logic Layer: chat-push event handler.
//
// nanobot이 sub-agent 완료/진행 보고를 deskrpg parent NPC chat에 push할 때 호출.
// spec: docs/api/internal-events-contract.md Section 11 (planned/draft).
//
// scope (phase5 v1):
//   - 필수 필드 validation + channel/npc 존재 확인
//   - in-memory idempotency cache (Idempotency-Key 헤더 기반, TTL 10분)
//   - socket emit "npc:push-message" — 채널 broadcast (클라이언트가 listener로 받아 표시)
//
// 의도적 제외 (phase5 finalize 또는 별도 phase에서 결정):
//   - chat_messages 영속화 — 현재 schema가 characterId NOT NULL이라 push 시점 character
//     모름. 추후 schema 변경(channelId column 또는 characterId nullable)으로 처리.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db as defaultDb, channels, npcs } from "@/db";

export type ChatPushKind =
  | "subagent_report"
  | "subagent_progress"
  | "scheduled_reminder";

export type ChatPushInput = {
  sessionKey: string;
  channelId: string;
  npcId: string;
  message: string;
  kind?: ChatPushKind | string;
  subagentId?: string;
  subagentLabel?: string;
  taskNpcTaskId?: string;
  metadata?: Record<string, unknown>;
};

export type ChatPushOk = {
  ok: true;
  statusCode: 201;
  persistedMessageId: string;
};

export type ChatPushErr = {
  ok: false;
  statusCode: 400 | 401 | 403 | 404 | 409 | 500;
  errorCode:
    | "missing_required_field"
    | "channel_not_found"
    | "npc_not_found"
    | "duplicate_message"
    | "internal_error";
  field?: string;
};

export type ChatPushResult = ChatPushOk | ChatPushErr;

export type ChatPushEmit = (channelId: string, payload: unknown) => void | Promise<void>;

export type ChatPushDeps = {
  emit: ChatPushEmit;
  db?: typeof defaultDb;
  idempotencyKey?: string;
};

// in-memory idempotency cache. process restart 시 비워지는 건 의도 (sub-agent 완료는
// 짧은 시간 내 중복만 회피하면 충분, 장기 영속성 불요).
const idempotencyCache = new Map<string, { messageId: string; expiresAt: number }>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // 10분

function cleanExpiredIdempotency(): void {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (entry.expiresAt <= now) idempotencyCache.delete(key);
  }
}

const REQUIRED_FIELDS: Array<keyof ChatPushInput> = [
  "sessionKey",
  "channelId",
  "npcId",
  "message",
];

function validate(input: ChatPushInput): ChatPushErr | null {
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

export async function handleChatPush(
  input: ChatPushInput,
  deps: ChatPushDeps,
): Promise<ChatPushResult> {
  const validation = validate(input);
  if (validation) return validation;

  const dbHandle = deps.db ?? defaultDb;

  // idempotency
  if (deps.idempotencyKey) {
    cleanExpiredIdempotency();
    const cached = idempotencyCache.get(deps.idempotencyKey);
    if (cached) {
      return { ok: false, statusCode: 409, errorCode: "duplicate_message" };
    }
  }

  // channel 존재 확인
  const [channel] = await dbHandle
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.id, input.channelId))
    .limit(1);
  if (!channel) return { ok: false, statusCode: 404, errorCode: "channel_not_found" };

  // npc 존재 확인
  const [npc] = await dbHandle
    .select({ id: npcs.id, channelId: npcs.channelId })
    .from(npcs)
    .where(eq(npcs.id, input.npcId))
    .limit(1);
  if (!npc) return { ok: false, statusCode: 404, errorCode: "npc_not_found" };

  // 채널 일치 확인 (npc가 다른 채널의 것이면 reject)
  if (npc.channelId !== input.channelId) {
    return { ok: false, statusCode: 404, errorCode: "npc_not_found" };
  }

  const messageId = randomUUID();

  // socket emit — 클라이언트 ChatPanel listener가 받아 NPC 메시지로 표시.
  // payload는 deskrpg 측 camelCase 표준 (spec snake_case는 HTTP wire에만).
  try {
    await deps.emit(input.channelId, {
      messageId,
      npcId: input.npcId,
      message: input.message,
      kind: input.kind ?? null,
      subagentId: input.subagentId ?? null,
      subagentLabel: input.subagentLabel ?? null,
      taskNpcTaskId: input.taskNpcTaskId ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (err) {
    console.warn("[internal-chat-push-handler] socket emit failed:", err);
    // emit 실패해도 idempotency cache는 안 채우고 500 — caller가 retry할 기회 보존
    return { ok: false, statusCode: 500, errorCode: "internal_error" };
  }

  if (deps.idempotencyKey) {
    idempotencyCache.set(deps.idempotencyKey, {
      messageId,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
  }

  return { ok: true, statusCode: 201, persistedMessageId: messageId };
}
