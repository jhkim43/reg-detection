// seed-v10 phase5 T-V32 — Presentation Layer: chat-push endpoint.
//
// POST /api/internal/chat-push
//   sub-agent 비동기 완료/진행 보고를 parent NPC chat에 push.
//   spec: docs/api/internal-events-contract.md Section 11
//   인증: x-deskrpg-internal-secret 헤더 (INTERNAL_RPC_SECRET / JWT_SECRET).
//   Idempotency-Key 헤더 (선택): 중복 push 회피.

import { NextRequest, NextResponse } from "next/server";

import { handleChatPush, type ChatPushInput } from "@/lib/internal-chat-push-handler";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const internalTransport = require("@/lib/internal-transport.js") as {
  isInternalRequestAuthorized: (headers: Headers) => boolean;
  buildInternalAuthHeaders: () => Record<string, string>;
  getInternalSocketBaseUrl: () => string;
};

type RawBody = {
  // spec은 snake_case wire format. handler는 camelCase로 정규화 후 사용.
  session_key?: string;
  channel_id?: string;
  npc_id?: string;
  message?: string;
  kind?: string;
  subagent_id?: string;
  subagent_label?: string;
  task_npc_task_id?: string;
  metadata?: Record<string, unknown>;
};

async function forwardSocketEmit(channelId: string, payload: unknown): Promise<void> {
  // /_internal/emit의 표준 body 형식: { event, room, payload } — 다른 internal routes
  // (npcs, tasks, llm-usage)와 동일. room=channelId로 io.to(room).emit(event, payload).
  const url = `${internalTransport.getInternalSocketBaseUrl()}/_internal/emit`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...internalTransport.buildInternalAuthHeaders(),
    },
    body: JSON.stringify({ event: "npc:push-message", room: channelId, payload }),
  });
  if (!res.ok) {
    throw new Error(`socket emit forward failed: ${res.status}`);
  }
}

export async function POST(req: NextRequest) {
  if (!internalTransport.isInternalRequestAuthorized(req.headers)) {
    return NextResponse.json({ errorCode: "unauthorized" }, { status: 401 });
  }

  let body: RawBody;
  try {
    body = (await req.json()) as RawBody;
  } catch {
    return NextResponse.json({ errorCode: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ errorCode: "invalid_body" }, { status: 400 });
  }

  const input: ChatPushInput = {
    sessionKey: String(body.session_key ?? ""),
    channelId: String(body.channel_id ?? ""),
    npcId: String(body.npc_id ?? ""),
    message: String(body.message ?? ""),
    kind: body.kind,
    subagentId: body.subagent_id,
    subagentLabel: body.subagent_label,
    taskNpcTaskId: body.task_npc_task_id,
    metadata: body.metadata,
  };

  const idempotencyKey = req.headers.get("Idempotency-Key") || undefined;

  try {
    const result = await handleChatPush(input, {
      emit: forwardSocketEmit,
      idempotencyKey,
    });

    if (result.ok) {
      return NextResponse.json(
        { persisted_message_id: result.persistedMessageId },
        { status: result.statusCode },
      );
    }

    return NextResponse.json(
      { errorCode: result.errorCode, ...(result.field ? { field: result.field } : {}) },
      { status: result.statusCode },
    );
  } catch (err) {
    console.error("[internal/chat-push] handler threw:", err);
    return NextResponse.json({ errorCode: "internal_error" }, { status: 500 });
  }
}
