// GET /api/llm-usage/account-balance — OpenRouter 계정 잔여 fetch (팀 전체 공유 예산).
// instance-scoped `llm_usage_records` 합계와 별개로, OpenRouter 계정 자체의 사용량을 표시.
// 5분 in-memory 캐시 — OpenRouter `/auth/key`는 무료(메타데이터) endpoint지만 rate limit 보호.

import { NextResponse } from "next/server";

type BalanceBody = {
  usage: number;
  limit: number | null;
  remaining: number | null;
  source: "openrouter";
} | { error: string };

type Cache = { at: number; body: BalanceBody };
const TTL_MS = 5 * 60 * 1000;
let cache: Cache | null = null;

async function fetchFromOpenRouter(apiKey: string): Promise<BalanceBody> {
  const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return { error: `openrouter ${res.status}` };
  }
  const json = (await res.json()) as {
    data?: { usage?: number; limit?: number | null; limit_remaining?: number | null };
  };
  const data = json.data ?? {};
  return {
    usage: Number(data.usage ?? 0),
    limit: typeof data.limit === "number" ? data.limit : null,
    remaining: typeof data.limit_remaining === "number" ? data.limit_remaining : null,
    source: "openrouter",
  };
}

export async function GET() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // env 미설정 시 조용히 — widget이 hide
    return NextResponse.json({ error: "no_key" });
  }

  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json(cache.body);
  }

  try {
    const body = await fetchFromOpenRouter(apiKey);
    cache = { at: now, body };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[account-balance] fetch failed:", err);
    return NextResponse.json({ error: "fetch_failed" });
  }
}
