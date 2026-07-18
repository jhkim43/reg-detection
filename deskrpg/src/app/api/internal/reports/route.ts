// seed-v11 AC-002 / T-V11-008 — Presentation Layer: agent_reports push endpoint.
//
// POST /api/internal/reports
//   nanobot이 분석·요약·리포트 형태로 본문 큰 마크다운 결과물을 push할 때 호출.
//   spec: docs/api/internal-events-contract.md Section 12 (T-V11-012에서 finalize).
//   인증: x-deskrpg-internal-secret 헤더 (v10 INTERNAL_RPC_SECRET 패턴 재사용).
//   Idempotency-Key 헤더 (선택): 중복 push 회피 (in-memory TTL 10분).
//
// 패턴: v10 phase5 chat-push/route.ts 그대로 답습.

import { NextRequest, NextResponse } from "next/server";

import { handleReportPush, type ReportPushInput } from "@/lib/internal-report-handler";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const internalTransport = require("@/lib/internal-transport.js") as {
  isInternalRequestAuthorized: (headers: Headers) => boolean;
  buildInternalAuthHeaders: () => Record<string, string>;
  getInternalSocketBaseUrl: () => string;
};

type RawBody = {
  // spec은 snake_case wire format. handler는 camelCase 내부 정규화.
  channel_id?: string;
  npc_id?: string;
  character_id?: string;
  body_markdown?: string;
  title?: string;
  creator_sub_agent_label?: string;
  metadata?: Record<string, unknown>;
};

async function forwardSocketEmit(channelId: string, payload: unknown): Promise<void> {
  // Fire-and-forget: 응답 latency 단축. Socket emit 실패해도 agent_reports row는
  // 이미 영속되어 클라이언트는 ReportPanel 새로 열거나 다음 socket 이벤트로 복원됨.
  const url = `${internalTransport.getInternalSocketBaseUrl()}/_internal/emit`;
  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...internalTransport.buildInternalAuthHeaders(),
    },
    body: JSON.stringify({ event: "agent-report:ready", room: channelId, payload }),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[internal-reports] socket emit non-ok: ${res.status}`);
      }
    })
    .catch((err) => {
      console.warn("[internal-reports] socket emit error:", err);
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

  const input: ReportPushInput = {
    channelId: String(body.channel_id ?? ""),
    npcId: String(body.npc_id ?? ""),
    characterId: String(body.character_id ?? ""),
    bodyMarkdown: String(body.body_markdown ?? ""),
    title: body.title,
    creatorSubAgentLabel: body.creator_sub_agent_label,
    metadata: body.metadata,
  };

  const idempotencyKey = req.headers.get("Idempotency-Key") || undefined;

  try {
    const result = await handleReportPush(input, {
      emit: forwardSocketEmit,
      idempotencyKey,
    });

    if (result.ok) {
      return NextResponse.json(
        { persisted_report_id: result.persistedReportId },
        { status: result.statusCode },
      );
    }

    return NextResponse.json(
      { errorCode: result.errorCode, ...(result.field ? { field: result.field } : {}) },
      { status: result.statusCode },
    );
  } catch (err) {
    console.error("[internal/reports] handler threw:", err);
    return NextResponse.json({ errorCode: "internal_error" }, { status: 500 });
  }
}
