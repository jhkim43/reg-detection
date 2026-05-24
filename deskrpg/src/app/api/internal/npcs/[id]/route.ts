// seed-v10 AC-002 / T-V15 — DELETE /api/internal/npcs/[id].
//
// nanobot이 자체적으로 sub-agent를 종료할 때 호출. 인증: internal-secret.
// 로직은 deleteNpcInternal에 위임 (cascade + mirror cleanup + emit).

import { NextRequest, NextResponse } from "next/server";

import { deleteNpcInternal } from "@/lib/internal-npc-handler";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const internalTransport = require("@/lib/internal-transport.js") as {
  isInternalRequestAuthorized: (headers: Headers) => boolean;
  buildInternalAuthHeaders: () => Record<string, string>;
  getInternalSocketBaseUrl: () => string;
};

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!internalTransport.isInternalRequestAuthorized(req.headers)) {
    return NextResponse.json({ errorCode: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ errorCode: "missing_required_field", field: "id" }, { status: 400 });
  }

  try {
    const result = await deleteNpcInternal(id, {
      emit: (channelId, event, payload) => forwardSocketEmit(channelId, event, payload),
    });
    if (result.ok) {
      return NextResponse.json({ success: true, deletedCount: result.deletedCount }, {
        status: result.statusCode,
      });
    }
    return NextResponse.json(
      { errorCode: result.errorCode, ...(result.field ? { field: result.field } : {}) },
      { status: result.statusCode },
    );
  } catch (err) {
    console.error("[internal-npcs] delete threw:", err);
    return NextResponse.json({ errorCode: "internal_error" }, { status: 500 });
  }
}

async function forwardSocketEmit(channelId: string, event: string, payload: unknown): Promise<void> {
  try {
    await fetch(`${internalTransport.getInternalSocketBaseUrl()}/_internal/emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...internalTransport.buildInternalAuthHeaders(),
      },
      body: JSON.stringify({ event, room: channelId, payload }),
    });
  } catch (err) {
    console.warn("[internal-npcs] socket emit forward failed:", err);
  }
}
