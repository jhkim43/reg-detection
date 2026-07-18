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
  // Fire-and-forget: 응답 latency 단축. Socket emit 실패해도 chat_messages row는
  // 이미 영속되었으므로 클라이언트는 다음 history fetch 또는 다른 socket 이벤트로
  // 자연 복원됨. 이전엔 await + throw → 500 반환 (row 영속됐는데 사용자엔 실패) 의
  // 모순도 함께 해소.
  const url = `${internalTransport.getInternalSocketBaseUrl()}/_internal/emit`;
  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...internalTransport.buildInternalAuthHeaders(),
    },
    body: JSON.stringify({ event: "npc:push-message", room: channelId, payload }),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[internal-chat-push] socket emit non-ok: ${res.status}`);
      }
    })
    .catch((err) => {
      console.warn("[internal-chat-push] socket emit error:", err);
    });
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
