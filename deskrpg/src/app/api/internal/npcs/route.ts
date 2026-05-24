// seed-v10 AC-002 / T-V14 — POST /api/internal/npcs (sub-agent spawn).
//
// nanobot agent loop이 child sub-agent를 spawn 요청. 인증: internal-secret.
// 로직은 spawnSubAgent에 위임 (logic layer).

import { NextRequest, NextResponse } from "next/server";

import { spawnSubAgent, type SpawnSubAgentInput } from "@/lib/internal-npc-handler";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const internalTransport = require("@/lib/internal-transport.js") as {
  isInternalRequestAuthorized: (headers: Headers) => boolean;
  buildInternalAuthHeaders: () => Record<string, string>;
  getInternalSocketBaseUrl: () => string;
};

type RawBody = Partial<SpawnSubAgentInput>;

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

  const input: SpawnSubAgentInput = {
    ownerUserId: String(body.ownerUserId ?? ""),
    channelId: String(body.channelId ?? ""),
    name: String(body.name ?? ""),
    agentId: String(body.agentId ?? ""),
    parentAgentId: String(body.parentAgentId ?? ""),
    identity: String(body.identity ?? ""),
    soul: String(body.soul ?? ""),
    appearance: body.appearance,
    positionX: typeof body.positionX === "number" ? body.positionX : undefined,
    positionY: typeof body.positionY === "number" ? body.positionY : undefined,
    locale: body.locale,
  };

  try {
    const result = await spawnSubAgent(input, {
      emit: (channelId, event, payload) => forwardSocketEmit(channelId, event, payload),
    });

    if (result.ok) {
      return NextResponse.json({ npc: result.npc }, { status: result.statusCode });
    }
    return NextResponse.json(
      {
        errorCode: result.errorCode,
        ...(result.field ? { field: result.field } : {}),
      },
      { status: result.statusCode },
    );
  } catch (err) {
    console.error("[internal-npcs] spawn threw:", err);
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
