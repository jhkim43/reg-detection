"use client";
// AC-008 — LLM 사용량 위젯. 모든 Game scene 우측 상단 floating.
// 마운트 시 GET /api/llm-usage/snapshot로 초기 누적 fetch, 이후 socket
// 'llm-usage:update' event로 매 record를 증분 적용.
// 임계 (seed-v6 D-11): $30 yellow / $60 orange / $90 red.

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

type UsageState = {
  cost_usd: number;
  call_count: number;
  cache_hit_rate: number;
  last_model: string | null;
};

type UsageUpdatePayload = {
  costUsd?: number;
  cachedTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
};

type TeamBalance = {
  usage: number;
  limit: number | null;
  remaining: number | null;
};

const INITIAL: UsageState = {
  cost_usd: 0,
  call_count: 0,
  cache_hit_rate: 0,
  last_model: null,
};

const BUDGET_USD = 100;
const YELLOW_USD = 30;
const ORANGE_USD = 60;
const RED_USD = 90;

function shortModel(model: string | null): string {
  if (!model) return "—";
  // "qwen/qwen3.6-35b-a3b" → "qwen3.6-35b"
  const parts = model.split("/");
  const tail = parts[parts.length - 1] || model;
  return tail.length > 18 ? tail.slice(0, 18) + "…" : tail;
}

function levelColor(cost: number): { bg: string; border: string; label: string } {
  if (cost >= RED_USD) return { bg: "bg-red-900/80", border: "border-red-500", label: "RED" };
  if (cost >= ORANGE_USD) return { bg: "bg-orange-900/80", border: "border-orange-500", label: "ORANGE" };
  if (cost >= YELLOW_USD) return { bg: "bg-yellow-900/80", border: "border-yellow-500", label: "YELLOW" };
  return { bg: "bg-slate-900/80", border: "border-slate-600", label: "NONE" };
}

export function LlmUsageWidget({ socket }: { socket: Socket | null }) {
  const [state, setState] = useState<UsageState>(INITIAL);
  const [team, setTeam] = useState<TeamBalance | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/llm-usage/snapshot", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setState({
          cost_usd: Number(data.cost_usd ?? 0),
          call_count: Number(data.call_count ?? 0),
          cache_hit_rate: Number(data.cache_hit_rate ?? 0),
          last_model: typeof data.last_model === "string" ? data.last_model : null,
        });
      })
      .catch(() => {
        /* leave INITIAL */
      });
    // OpenRouter 계정 잔여(팀 공유 예산) — server-side 5분 캐시. error/no_key면 hide.
    fetch("/api/llm-usage/account-balance", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || data.error || typeof data.usage !== "number") return;
        setTeam({ usage: data.usage, limit: data.limit, remaining: data.remaining });
      })
      .catch(() => { /* hide on failure */ });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!socket) return;
    // Track cumulative tokens locally to recompute cache_hit_rate.
    let totalTokens = 0;
    let cachedTokens = 0;
    const handler = (payload: UsageUpdatePayload) => {
      const cost = Number(payload.costUsd ?? 0);
      const cached = Number(payload.cachedTokens ?? 0);
      const total = Number(payload.inputTokens ?? 0) + Number(payload.outputTokens ?? 0);
      totalTokens += total;
      cachedTokens += cached;
      setState((prev) => ({
        cost_usd: prev.cost_usd + cost,
        call_count: prev.call_count + 1,
        cache_hit_rate: totalTokens > 0 ? cachedTokens / totalTokens : prev.cache_hit_rate,
        last_model: typeof payload.model === "string" ? payload.model : prev.last_model,
      }));
    };
    socket.on("llm-usage:update", handler);
    return () => {
      socket.off("llm-usage:update", handler);
    };
  }, [socket]);

  const color = levelColor(state.cost_usd);
  const progressPct = Math.min(100, (state.cost_usd / BUDGET_USD) * 100);
  const tooltipText = `Budget: $${BUDGET_USD} / threshold: ${color.label}\n캐시 적중률: ${Math.round(state.cache_hit_rate * 100)}%`;

  // Collapsed: 작은 badge — 상단 버튼 가리지 않음. 클릭 시 전체 정보 펼침.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`fixed bottom-3 right-3 z-[9999] rounded-md border ${color.border} ${color.bg} px-2 py-1 text-xs font-mono text-white shadow-md backdrop-blur hover:brightness-125 transition`}
        title={tooltipText}
        aria-label="LLM 사용량 위젯 펼치기"
      >
        💰 ${state.cost_usd.toFixed(3)}
        {color.label !== "NONE" && (
          <span className="ml-1.5 px-1 py-0.5 rounded bg-black/40 text-[10px]">{color.label}</span>
        )}
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-3 right-3 z-[9999] rounded-lg border ${color.border} ${color.bg} px-3 py-2 text-xs font-mono text-white shadow-lg backdrop-blur min-w-[240px]`}
      title={tooltipText}
    >
      <div className="flex items-center gap-2 mb-1">
        <span>💰</span>
        <span className="font-semibold">${state.cost_usd.toFixed(3)}</span>
        <span className="text-white/60">/ ${BUDGET_USD}</span>
        {color.label !== "NONE" && (
          <span className="ml-auto px-1.5 py-0.5 rounded bg-black/40 text-[10px]">
            {color.label}
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="ml-1 px-1 text-white/70 hover:text-white"
          aria-label="LLM 사용량 위젯 접기"
          title="접기"
        >
          ×
        </button>
      </div>
      <div className="h-1 w-full rounded bg-black/40 overflow-hidden mb-1.5">
        <div
          className="h-full bg-white/70 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="text-[10px] text-white/80 truncate">
        호출 {state.call_count} · {shortModel(state.last_model)}
      </div>
      {team && (
        <div className="text-[10px] text-white/60 truncate mt-0.5">
          팀 잔여 ${(team.remaining ?? 0).toFixed(2)}
          {team.limit !== null && <span> / ${team.limit.toFixed(0)}</span>}
        </div>
      )}
    </div>
  );
}
