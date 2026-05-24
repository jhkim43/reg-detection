// seed-v10 AC-001 / T-V09 — Presentation Layer: nanobot task event push endpoint.
//
// POST /api/internal/tasks
//   nanobot agent loop이 tool execution lifecycle event를 push.
//   인증: x-deskrpg-internal-secret 헤더 (INTERNAL_RPC_SECRET / JWT_SECRET).
//   로직: handleTaskEvent에 위임 (logic layer). Socket emit은 _internal/emit forward.

import { NextRequest, NextResponse } from "next/server";

import { handleTaskEvent, type TaskEventInput } from "@/lib/internal-task-handler";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const internalTransport = require("@/lib/internal-transport.js") as {
  isInternalRequestAuthorized: (headers: Headers) => boolean;
  buildInternalAuthHeaders: () => Record<string, string>;
  getInternalSocketBaseUrl: () => string;
};

type RawBody = Partial<TaskEventInput>;

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

  const input: TaskEventInput = {
    channelId: String(body.channelId ?? ""),
    npcId: String(body.npcId ?? ""),
    npcTaskId: String(body.npcTaskId ?? ""),
    title: String(body.title ?? ""),
    summary: typeof body.summary === "string" ? body.summary : null,
    status: (body.status ?? "backlog") as TaskEventInput["status"],
    action: (body.action ?? "create") as TaskEventInput["action"],
    assignerCharacterId: String(body.assignerCharacterId ?? ""),
    ownerUserId: String(body.ownerUserId ?? ""),
    metadata: body.metadata,
  };

  try {
    const result = await handleTaskEvent(input, {
      emit: (channelId, payload) => forwardSocketEmit(channelId, payload),
    });

    if (result.ok) {
      return NextResponse.json({ id: result.task.id, status: result.task.status }, {
        status: result.statusCode,
      });
    }

    return NextResponse.json(
      {
        errorCode: result.errorCode,
        ...(result.field ? { field: result.field } : {}),
        ...(result.existingStatus ? { existingStatus: result.existingStatus } : {}),
      },
      { status: result.statusCode },
    );
  } catch (err) {
    console.error("[internal-tasks] handler threw:", err);
    return NextResponse.json({ errorCode: "internal_error" }, { status: 500 });
  }
}

async function forwardSocketEmit(channelId: string, payload: unknown): Promise<void> {
  try {
    await fetch(`${internalTransport.getInternalSocketBaseUrl()}/_internal/emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...internalTransport.buildInternalAuthHeaders(),
      },
      body: JSON.stringify({ event: "task:event", room: channelId, payload }),
    });
  } catch (err) {
    console.warn("[internal-tasks] socket emit forward failed:", err);
  }
}
