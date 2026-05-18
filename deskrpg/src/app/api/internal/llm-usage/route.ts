// Internal endpoint — nanobot의 LLMUsageRecordHook가 매 LLM iteration 후 fire-and-forget POST.
// 인증은 INTERNAL_RPC_SECRET / JWT_SECRET 기반(x-deskrpg-internal-secret 헤더).
// DB insert 후 socket.io로 llm-usage:update broadcast (LlmUsageWidget가 receive).

import { NextRequest, NextResponse } from "next/server";
import { db, llmUsageRecords } from "@/db";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const internalTransport = require("@/lib/internal-transport.js") as {
  isInternalRequestAuthorized: (headers: Headers) => boolean;
  getInternalSocketBaseUrl: () => string;
  buildInternalAuthHeaders: () => Record<string, string>;
};

type Body = {
  sessionKey?: string;
  npcId?: string | null;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  costUsd?: number;
  phase?: string | null;
};

export async function POST(req: NextRequest) {
  if (!internalTransport.isInternalRequestAuthorized(req.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionKey = typeof body.sessionKey === "string" ? body.sessionKey.slice(0, 200) : "";
  const provider = typeof body.provider === "string" ? body.provider.slice(0, 20) : "";
  const model = typeof body.model === "string" ? body.model.slice(0, 100) : "";

  if (!sessionKey || !provider || !model) {
    return NextResponse.json({ error: "Missing sessionKey/provider/model" }, { status: 400 });
  }

  const npcId = body.npcId && /^[0-9a-fA-F-]{36}$/.test(body.npcId) ? body.npcId : null;
  const inputTokens = Number.isFinite(body.inputTokens) ? Math.max(0, Math.floor(body.inputTokens!)) : 0;
  const outputTokens = Number.isFinite(body.outputTokens) ? Math.max(0, Math.floor(body.outputTokens!)) : 0;
  const cachedTokens = Number.isFinite(body.cachedTokens) ? Math.max(0, Math.floor(body.cachedTokens!)) : 0;
  const costUsd = Number.isFinite(body.costUsd) ? Math.max(0, body.costUsd!) : 0;
  const phase = typeof body.phase === "string" ? body.phase.slice(0, 30) : null;

  try {
    const [inserted] = await db
      .insert(llmUsageRecords)
      .values({
        sessionKey,
        npcId,
        provider,
        model,
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd,
        phase,
      })
      .returning();

    // Fire socket broadcast — fail silently (nanobot hook은 retry 안 함, 다음 iteration에서 재누적).
    void emitLlmUsageUpdate(inserted);

    return NextResponse.json({ ok: true, id: inserted.id });
  } catch (err) {
    console.error("[llm-usage] insert failed:", err);
    return NextResponse.json({ error: "Insert failed" }, { status: 500 });
  }
}

async function emitLlmUsageUpdate(record: typeof llmUsageRecords.$inferSelect) {
  try {
    await fetch(`${internalTransport.getInternalSocketBaseUrl()}/_internal/emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...internalTransport.buildInternalAuthHeaders(),
      },
      body: JSON.stringify({
        event: "llm-usage:update",
        room: null,
        payload: {
          id: record.id,
          sessionKey: record.sessionKey,
          npcId: record.npcId,
          provider: record.provider,
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          cachedTokens: record.cachedTokens,
          costUsd: record.costUsd,
          phase: record.phase,
          createdAt: record.createdAt,
        },
      }),
    });
  } catch (err) {
    console.warn("[llm-usage] socket emit forward failed:", err);
  }
}
