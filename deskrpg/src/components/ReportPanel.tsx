// seed-v11 AC-003 / T-V11-013 + AC-004 / T-V11-015 — ReportPanel.
//
// 우측 슬라이드인 패널. 현재 NPC의 최신 agent_reports 1건을 sanitize markdown으로 렌더.
//   - NPC 전환 시 자동 refetch (currentNpcId 변경)
//   - socket 'agent-report:ready' 수신, payload.npcId === currentNpcId 일 때 자동 갱신
//   - 보고서 없으면 placeholder
//   - 슬라이드인 애니메이션 250ms ease-out (TRD-D-42)
//
// 의존성: 기존 MarkdownContent 재사용 (react-markdown + remark-gfm 이미 설치, raw HTML 차단 기본).

"use client";

import { useCallback, useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

import MarkdownContent from "./ui/MarkdownContent";

export type ReportListItem = {
  id: string;
  characterId: string;
  npcId: string | null;
  title: string | null;
  bodyMarkdown: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  creatorNpcName: string | null;
  creatorSubAgentLabel: string | null;
};

type ReportReadyEvent = {
  reportId: string;
  npcId: string;
  channelId: string;
  title?: string | null;
  creatorSubAgentLabel?: string | null;
  createdAt?: string;
};

interface ReportPanelProps {
  currentNpcId: string;
  socket: Socket | null;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

export default function ReportPanel({ currentNpcId, socket }: ReportPanelProps) {
  const [report, setReport] = useState<ReportListItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [slideIn, setSlideIn] = useState(false);

  const fetchLatest = useCallback(async () => {
    if (!currentNpcId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/reports?npcId=${encodeURIComponent(currentNpcId)}&limit=1`, {
        credentials: "include",
      });
      if (!res.ok) {
        setReport(null);
        return;
      }
      const body = (await res.json()) as { reports: ReportListItem[] };
      setReport(body.reports[0] ?? null);
    } catch (err) {
      console.warn("[ReportPanel] fetch failed:", err);
      setReport(null);
    } finally {
      setIsLoading(false);
    }
  }, [currentNpcId]);

  // currentNpcId 변경 시 자동 refetch
  useEffect(() => {
    void fetchLatest();
  }, [fetchLatest]);

  // 슬라이드인 트리거 — mount 직후
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setSlideIn(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  // socket listener — 현재 NPC 일치 시 refetch + slideIn 재트리거
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: ReportReadyEvent) => {
      if (payload.npcId !== currentNpcId) return;
      // 즉시 refetch
      void fetchLatest();
      // slideIn 재트리거 (off → on)로 애니메이션 다시 재생
      setSlideIn(false);
      window.requestAnimationFrame(() => setSlideIn(true));
    };
    socket.on("agent-report:ready", handler);
    return () => {
      socket.off("agent-report:ready", handler);
    };
  }, [socket, currentNpcId, fetchLatest]);

  const creatorLabel =
    report?.creatorSubAgentLabel ??
    report?.creatorNpcName ??
    (report ? "삭제된 NPC" : null);

  return (
    <div
      className="w-[420px] bg-gray-900 border-2 border-amber-500 rounded-lg shadow-2xl overflow-hidden flex flex-col"
      style={{
        height: "min(560px, 70vh)",
        transform: slideIn ? "translateX(0)" : "translateX(20px)",
        opacity: slideIn ? 1 : 0,
        transition: "transform 250ms ease-out, opacity 250ms ease-out",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-lg" aria-hidden>📄</span>
          <div className="min-w-0 flex-1">
            <div className="text-amber-400 font-bold text-sm truncate">
              {report?.title ?? "보고서"}
            </div>
            {report && (
              <div className="text-gray-400 text-[11px] truncate">
                {creatorLabel ?? ""} · {relativeTime(report.createdAt)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 text-gray-100 text-sm">
        {isLoading && !report && (
          <div className="text-gray-500 text-xs italic">불러오는 중...</div>
        )}
        {!isLoading && !report && (
          <div className="text-gray-500 text-xs italic">
            아직 받은 보고서가 없습니다.
            <br />
            sub-agent가 결과물을 push하면 여기에 표시됩니다.
          </div>
        )}
        {report && <MarkdownContent content={report.bodyMarkdown} />}
      </div>
    </div>
  );
}
