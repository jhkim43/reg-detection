// seed-v11 AC-003 (revised UX + docx/ppt 변형) — ReportPanel.
//
// 표시 모드 (사용자 요청, 2026-05-30):
//   - "doc": docx 느낌 — 종이(cream) 배경 + serif + 넓은 padding. 기본 모드.
//   - "slide": ppt 느낌 — 마크다운 본문을 '---' 구분자로 슬라이드 분할, 화살표 nav.
//     본문에 '---'가 1개 이상일 때만 헤더에 토글 노출.
//
// 슬라이드 분할 규칙: 줄 단독 '---' (앞뒤 newline). markdown horizontal rule 컨벤션.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  reportId: string | null;
  currentNpcId: string | null;
  socket: Socket | null;
  onClose: () => void;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

function splitSlides(markdown: string): string[] {
  // 줄 단독 '---' 으로 분할 (앞뒤 공백 허용). 슬라이드 deck 컨벤션.
  return markdown
    .split(/^\s*---\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// 모던 보고서 톤 — Claude DOCX 영감. 화이트 + 네이비(#1a2547) + 골드(#c8943c).
// Tailwind JIT가 동적 보간된 클래스 못 잡으므로 모두 리터럴.
const DOC_THEME_CLASSES = [
  "bg-white text-slate-700",
  "px-7 py-6 leading-7",
  // 헤딩 — 네이비, 골드 언더라인
  "[&_.markdown-chat_h1]:text-2xl [&_.markdown-chat_h1]:font-bold [&_.markdown-chat_h1]:text-[#1a2547] [&_.markdown-chat_h1]:mt-2 [&_.markdown-chat_h1]:mb-3 [&_.markdown-chat_h1]:pb-2 [&_.markdown-chat_h1]:border-b-2 [&_.markdown-chat_h1]:border-[#c8943c] [&_.markdown-chat_h1]:tracking-tight",
  "[&_.markdown-chat_h2]:text-xl [&_.markdown-chat_h2]:font-bold [&_.markdown-chat_h2]:text-[#1a2547] [&_.markdown-chat_h2]:mt-6 [&_.markdown-chat_h2]:mb-2 [&_.markdown-chat_h2]:tracking-tight",
  "[&_.markdown-chat_h3]:text-base [&_.markdown-chat_h3]:font-semibold [&_.markdown-chat_h3]:text-[#1a2547] [&_.markdown-chat_h3]:mt-4 [&_.markdown-chat_h3]:mb-1.5",
  // 본문
  "[&_.markdown-chat_p]:text-slate-700 [&_.markdown-chat_p]:leading-7 [&_.markdown-chat_p]:my-2.5",
  "[&_.markdown-chat_strong]:text-[#1a2547] [&_.markdown-chat_strong]:font-bold",
  "[&_.markdown-chat_em]:text-slate-600",
  // 리스트
  "[&_.markdown-chat_ul]:my-2.5 [&_.markdown-chat_ol]:my-2.5",
  "[&_.markdown-chat_li]:text-slate-700 [&_.markdown-chat_li]:my-1 [&_.markdown-chat_li]:leading-7",
  // 인용 — 골드 액센트
  "[&_.markdown-chat_blockquote]:border-l-4 [&_.markdown-chat_blockquote]:border-[#c8943c] [&_.markdown-chat_blockquote]:bg-slate-50 [&_.markdown-chat_blockquote]:px-4 [&_.markdown-chat_blockquote]:py-2 [&_.markdown-chat_blockquote]:my-3 [&_.markdown-chat_blockquote]:text-slate-700 [&_.markdown-chat_blockquote]:not-italic",
  // 표 — 네이비 헤더 + 흰 글씨, 깔끔한 보더
  "[&_.markdown-chat_table]:w-full [&_.markdown-chat_table]:text-sm [&_.markdown-chat_table]:my-4 [&_.markdown-chat_table]:border-collapse",
  "[&_.markdown-chat_thead]:bg-[#1a2547]",
  "[&_.markdown-chat_th]:px-3 [&_.markdown-chat_th]:py-2.5 [&_.markdown-chat_th]:text-white [&_.markdown-chat_th]:font-semibold [&_.markdown-chat_th]:text-left [&_.markdown-chat_th]:border [&_.markdown-chat_th]:border-[#1a2547]",
  "[&_.markdown-chat_td]:px-3 [&_.markdown-chat_td]:py-2 [&_.markdown-chat_td]:text-slate-700 [&_.markdown-chat_td]:border [&_.markdown-chat_td]:border-slate-200",
  "[&_.markdown-chat_tbody_tr:nth-child(even)]:bg-slate-50",
  // 링크 — 골드
  "[&_.markdown-chat_a]:text-[#c8943c] [&_.markdown-chat_a]:underline [&_.markdown-chat_a]:font-medium [&_.markdown-chat_a:hover]:opacity-80",
  // 코드
  "[&_.markdown-chat_code]:bg-slate-100 [&_.markdown-chat_code]:text-slate-800 [&_.markdown-chat_code]:px-1.5 [&_.markdown-chat_code]:py-0.5 [&_.markdown-chat_code]:rounded",
  "[&_.markdown-chat_pre]:bg-slate-50 [&_.markdown-chat_pre]:border [&_.markdown-chat_pre]:border-slate-200 [&_.markdown-chat_pre]:rounded",
  // hr
  "[&_.markdown-chat_hr]:border-slate-200 [&_.markdown-chat_hr]:my-4",
].join(" ");

export default function ReportPanel({ reportId, currentNpcId, socket, onClose }: ReportPanelProps) {
  const [report, setReport] = useState<ReportListItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [slideIn, setSlideIn] = useState(false);
  const [viewMode, setViewMode] = useState<"doc" | "slide">("doc");
  const [currentSlide, setCurrentSlide] = useState(0);

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      let url: string;
      if (reportId) {
        url = `/api/reports?limit=50`;
      } else if (currentNpcId) {
        url = `/api/reports?npcId=${encodeURIComponent(currentNpcId)}&limit=1`;
      } else {
        url = `/api/reports?limit=1`;
      }
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        setReport(null);
        return;
      }
      const body = (await res.json()) as { reports: ReportListItem[] };
      if (reportId) {
        setReport(body.reports.find((r) => r.id === reportId) ?? null);
      } else {
        setReport(body.reports[0] ?? null);
      }
      setCurrentSlide(0); // 새 보고서마다 첫 슬라이드로
    } catch (err) {
      console.warn("[ReportPanel] fetch failed:", err);
      setReport(null);
    } finally {
      setIsLoading(false);
    }
  }, [reportId, currentNpcId]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setSlideIn(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: ReportReadyEvent) => {
      if (reportId) return;
      if (currentNpcId && payload.npcId === currentNpcId) {
        void fetchReport();
        setSlideIn(false);
        window.requestAnimationFrame(() => setSlideIn(true));
      }
    };
    socket.on("agent-report:ready", handler);
    return () => { socket.off("agent-report:ready", handler); };
  }, [socket, reportId, currentNpcId, fetchReport]);

  // 슬라이드 파싱 — body 바뀔 때만 재계산
  const slides = useMemo(() => {
    return report ? splitSlides(report.bodyMarkdown) : [];
  }, [report]);
  const slideEligible = slides.length > 1;
  const safeIndex = Math.min(currentSlide, Math.max(0, slides.length - 1));

  // 키보드 — slide 모드일 때 좌우 화살표
  useEffect(() => {
    if (viewMode !== "slide" || !slideEligible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setCurrentSlide((i) => Math.min(slides.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setCurrentSlide((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode, slideEligible, slides.length]);

  const creatorLabel =
    report?.creatorSubAgentLabel ?? report?.creatorNpcName ?? (report ? "삭제된 NPC" : null);

  const bodyToRender = viewMode === "slide" && slideEligible ? slides[safeIndex] : report?.bodyMarkdown ?? "";

  // PDF 다운로드 — 새 의존성 없이 window.print() + Save as PDF.
  //   - 패널 본문(rendered HTML)을 새 창에 복사 + 임베드 CSS + auto print.
  //   - 사용자는 인쇄 대화상자에서 "PDF로 저장" 선택. 한글 폰트는 시스템 처리.
  const handleDownloadPdf = useCallback(() => {
    if (!report) return;
    const bodyEl = document.querySelector<HTMLElement>("[data-report-body-content]");
    const html = bodyEl?.innerHTML ?? "";
    const win = window.open("", "_blank", "width=820,height=1100");
    if (!win) return;
    const safeTitle = (report.title ?? "보고서").replace(/[<>&"']/g, (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
    );
    const headerLine = `${creatorLabel ?? ""} · ${new Date(report.createdAt).toLocaleString("ko-KR")}`;
    win.document.write(`<!doctype html><html lang="ko"><head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Pretendard", "Spoqa Han Sans Neo", -apple-system, BlinkMacSystemFont, "Noto Sans KR", sans-serif; color: #334155; padding: 0; background: #fff; line-height: 1.7; }
  .report-title { font-size: 26px; font-weight: 800; color: #1a2547; padding-bottom: 12px; border-bottom: 3px solid #c8943c; margin: 0 0 8px 0; letter-spacing: -0.01em; }
  .report-meta { color: #64748b; font-size: 12px; margin-bottom: 24px; }
  h1 { font-size: 22px; font-weight: 700; color: #1a2547; margin: 24px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #c8943c; letter-spacing: -0.01em; }
  h2 { font-size: 18px; font-weight: 700; color: #1a2547; margin: 22px 0 8px; }
  h3 { font-size: 15px; font-weight: 600; color: #1a2547; margin: 16px 0 6px; }
  p { color: #334155; margin: 8px 0; }
  strong { color: #1a2547; font-weight: 700; }
  em { color: #475569; }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  li { color: #334155; margin: 4px 0; }
  blockquote { border-left: 4px solid #c8943c; background: #f8fafc; padding: 8px 16px; margin: 12px 0; color: #334155; }
  blockquote p { margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  thead { background: #1a2547; }
  th { color: #fff; padding: 9px 12px; text-align: left; border: 1px solid #1a2547; font-weight: 600; }
  td { padding: 8px 12px; border: 1px solid #e2e8f0; color: #334155; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  a { color: #c8943c; text-decoration: underline; font-weight: 500; }
  code { background: #f1f5f9; color: #334155; padding: 2px 6px; border-radius: 3px; font-size: 0.92em; }
  pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 4px; overflow-x: auto; }
  hr { border: 0; border-top: 1px solid #e2e8f0; margin: 16px 0; }
</style>
</head><body>
  <div class="report-title">${safeTitle}</div>
  <div class="report-meta">${headerLine}</div>
  ${html}
  <script>window.onload = function() { setTimeout(function() { window.print(); }, 120); };</script>
</body></html>`);
    win.document.close();
  }, [report, creatorLabel]);

  return (
    <div
      className="w-[460px] bg-gray-900 border-2 border-amber-500 rounded-lg shadow-2xl overflow-hidden flex flex-col"
      style={{
        height: "min(620px, 75vh)",
        transform: slideIn ? "translateX(0)" : "translateX(20px)",
        opacity: slideIn ? 1 : 0,
        transition: "transform 250ms ease-out, opacity 250ms ease-out",
      }}
    >
      {/* Header — 다크 톤 유지 (제어/메타 영역) */}
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
        {slideEligible && (
          <div className="flex items-center gap-0.5 mr-1 shrink-0 rounded border border-gray-600 overflow-hidden">
            <button
              onClick={() => setViewMode("doc")}
              className={`text-xs px-2 py-1 transition-colors ${viewMode === "doc" ? "bg-amber-500 text-gray-900 font-semibold" : "text-gray-400 hover:text-white"}`}
              title="문서 모드"
            >
              📄
            </button>
            <button
              onClick={() => setViewMode("slide")}
              className={`text-xs px-2 py-1 transition-colors ${viewMode === "slide" ? "bg-amber-500 text-gray-900 font-semibold" : "text-gray-400 hover:text-white"}`}
              title="슬라이드 모드"
            >
              📊
            </button>
          </div>
        )}
        <button
          onClick={handleDownloadPdf}
          disabled={!report}
          className="text-gray-400 hover:text-white text-sm px-2 py-1 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
          title="PDF로 다운로드 (인쇄 대화상자에서 'PDF로 저장' 선택)"
        >
          ⬇
        </button>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-sm px-2 py-1 shrink-0"
          title="닫기 (ESC)"
        >
          ✕
        </button>
      </div>

      {/* Body — 모던 보고서 (Claude DOCX 영감) */}
      <div
        data-report-body-content
        className={`flex-1 overflow-y-auto text-sm ${DOC_THEME_CLASSES}`}
        style={{
          fontFamily: '"Pretendard", "Spoqa Han Sans Neo", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif',
        }}
      >
        {isLoading && !report && (
          <div className="text-stone-500 italic">불러오는 중...</div>
        )}
        {!isLoading && !report && (
          <div className="text-stone-500 italic">보고서를 찾을 수 없습니다.</div>
        )}
        {report && <MarkdownContent content={bodyToRender} />}
      </div>

      {/* Slide nav — slide 모드 + 2장 이상일 때만 */}
      {viewMode === "slide" && slideEligible && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-700 bg-gray-800 shrink-0">
          <button
            onClick={() => setCurrentSlide((i) => Math.max(0, i - 1))}
            disabled={safeIndex === 0}
            className="text-amber-400 hover:text-white text-sm px-2 py-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
            title="이전 슬라이드 (←)"
          >
            ◀ 이전
          </button>
          <span className="text-gray-400 text-xs">
            {safeIndex + 1} / {slides.length}
          </span>
          <button
            onClick={() => setCurrentSlide((i) => Math.min(slides.length - 1, i + 1))}
            disabled={safeIndex === slides.length - 1}
            className="text-amber-400 hover:text-white text-sm px-2 py-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
            title="다음 슬라이드 (→)"
          >
            다음 ▶
          </button>
        </div>
      )}
    </div>
  );
}
