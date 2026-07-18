// GET /api/llm-usage/snapshot — LlmUsageWidget가 mount 시 1회 호출.
// 현재 누적 cost / call_count / cache_hit_rate / last_model 반환.

import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db, llmUsageRecords } from "@/db";

export async function GET() {
  try {
    const [totals] = await db
      .select({
        costUsd: sql<string>`COALESCE(SUM(${llmUsageRecords.costUsd}), 0)`,
        callCount: sql<string>`COUNT(*)`,
        cachedTokens: sql<string>`COALESCE(SUM(${llmUsageRecords.cachedTokens}), 0)`,
        totalTokens: sql<string>`COALESCE(SUM(${llmUsageRecords.inputTokens} + ${llmUsageRecords.outputTokens}), 0)`,
      })
      .from(llmUsageRecords);

    const last = await db
      .select({ model: llmUsageRecords.model })
      .from(llmUsageRecords)
      .orderBy(desc(llmUsageRecords.createdAt))
      .limit(1);

    const totalTokens = Number(totals.totalTokens);
    const cachedTokens = Number(totals.cachedTokens);
    const cacheHitRate = totalTokens > 0 ? cachedTokens / totalTokens : 0;

    return NextResponse.json({
      cost_usd: Number(totals.costUsd),
      call_count: Number(totals.callCount),
      cache_hit_rate: cacheHitRate,
      last_model: last[0]?.model ?? null,
    });
  } catch (err) {
    console.error("[llm-usage/snapshot] failed:", err);
    return NextResponse.json(
      { cost_usd: 0, call_count: 0, cache_hit_rate: 0, last_model: null },
      { status: 200 },
    );
  }
}
