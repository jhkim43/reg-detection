// seed-v11 v11-backlog-7 — ReportHistoryModal.
//
// 받은 보고서 전체 (max 50) 모달. 헤더 보고서 popover 하단 "전체 보기 →" 링크에서 진입.
// 작성자(NPC/sub-agent)별 그룹화 + 본문 첫 줄 미리보기 + 간단 검색.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type HistoryReportItem = {
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

interface ReportHistoryModalProps {
  open: boolean;
  onClose: () => void;
  onOpenReport: (reportId: string) => void;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

function firstLine(text: string, max = 60): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  // 마크다운 헤딩/리스트 마크 제거
  const cleaned = line.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, "").trim();
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned;
}

function creatorOf(r: HistoryReportItem): string {
  return r.creatorSubAgentLabel || r.creatorNpcName || "삭제된 NPC";
}

export default function ReportHistoryModal({ open, onClose, onOpenReport }: ReportHistoryModalProps) {
  const [reports, setReports] = useState<HistoryReportItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/reports?limit=50", { credentials: "include" });
      if (!res.ok) { setReports([]); return; }
      const body = (await res.json()) as { reports: HistoryReportItem[] };
      setReports(body.reports);
    } catch (err) {
      console.warn("[ReportHistoryModal] fetch failed:", err);
      setReports([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchAll();
      setSearchTerm("");
      setCollapsedGroups(new Set());
    }
  }, [open, fetchAll]);

  // ESC 닫기
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 검색 필터 + 그룹화 (작성자별)
  const grouped = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered = !term
      ? reports
      : reports.filter((r) => {
          const title = (r.title ?? "").toLowerCase();
          const creator = creatorOf(r).toLowerCase();
          const body = r.bodyMarkdown.slice(0, 200).toLowerCase();
          return title.includes(term) || creator.includes(term) || body.includes(term);
        });

    const map = new Map<string, HistoryReportItem[]>();
    for (const r of filtered) {
      const key = creatorOf(r);
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => {
      // 가장 최근 보고서가 더 위 그룹
      const aLatest = a[1][0]?.createdAt ?? "";
      const bLatest = b[1][0]?.createdAt ?? "";
      return bLatest.localeCompare(aLatest);
    });
  }, [reports, searchTerm]);

  const totalCount = reports.length;
  const filteredCount = grouped.reduce((acc, [, items]) => acc + items.length, 0);

  if (!open) return null;

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-[720px] max-w-[90vw] flex flex-col overflow-hidden"
        style={{ height: "min(720px, 85vh)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">📚</span>
            <span className="text-[#1a2547] font-bold text-base">받은 보고서</span>
            <span className="text-slate-500 text-xs">
              {searchTerm ? `${filteredCount} / ${totalCount}` : `${totalCount}건`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 text-sm px-2 py-1"
            title="닫기 (ESC)"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-2.5 border-b border-slate-200 shrink-0">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">🔍</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="제목·작성자·본문으로 검색"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded border border-slate-300 focus:border-[#c8943c] focus:outline-none text-slate-800 placeholder-slate-400"
              autoFocus
            />
          </div>
        </div>

        {/* Body — grouped list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {isLoading && (
            <div className="text-slate-500 text-sm italic text-center py-8">불러오는 중...</div>
          )}
          {!isLoading && totalCount === 0 && (
            <div className="text-slate-500 text-sm italic text-center py-8">
              아직 받은 보고서가 없습니다.
              <br />
              sub-agent가 결과물을 push하면 여기에 표시됩니다.
            </div>
          )}
          {!isLoading && totalCount > 0 && filteredCount === 0 && (
            <div className="text-slate-500 text-sm italic text-center py-8">
              &apos;{searchTerm}&apos; 검색 결과 없음
            </div>
          )}
          {!isLoading && grouped.map(([creator, items]) => {
            const collapsed = collapsedGroups.has(creator);
            return (
              <div key={creator} className="mb-4 last:mb-0">
                <button
                  type="button"
                  onClick={() => toggleGroup(creator)}
                  className="w-full flex items-center gap-1.5 px-1 py-1 text-[#1a2547] font-semibold text-sm hover:bg-slate-100 rounded"
                >
                  <span className={`text-xs transition-transform ${collapsed ? "" : "rotate-90"}`}>▶</span>
                  <span>{creator}</span>
                  <span className="ml-1 text-slate-400 text-xs">({items.length})</span>
                </button>
                {!collapsed && (
                  <div className="mt-1.5 space-y-1.5 ml-4">
                    {items.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          onOpenReport(r.id);
                          onClose();
                        }}
                        className="w-full text-left rounded-md border border-slate-200 hover:border-[#c8943c] hover:bg-amber-50/40 px-3 py-2.5 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className="text-base shrink-0" aria-hidden>📄</span>
                            <span className="truncate text-[#1a2547] font-semibold text-sm">
                              {r.title || "(제목 없음)"}
                            </span>
                          </div>
                          <span className="text-slate-400 text-xs shrink-0">{relativeTime(r.createdAt)}</span>
                        </div>
                        <div className="ml-6 mt-0.5 text-slate-600 text-xs truncate">
                          {firstLine(r.bodyMarkdown) || <span className="italic text-slate-400">본문 없음</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
