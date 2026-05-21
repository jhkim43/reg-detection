// seed-v9 AC-014 T-026 — Playwright fixture page.
//
// NODE_ENV !== "production" 일 때만 접근 가능. ChatPanel을 controlled props로
// 격리 렌더하고 Abort 버튼 동작을 window.__abortCalls__에 기록 → Playwright가 검증.
//
// 백엔드 통합 (socket round-trip, DB write 등)은 Phase 4 testcontainers 시점 검증.

"use client";

import { useState } from "react";
import ChatPanel from "@/components/ChatPanel";

declare global {
  interface Window {
    __abortCalls__?: string[];
  }
}

export default function ChatAbortFixturePage() {
  const [abortCalls, setAbortCalls] = useState<string[]>([]);

  if (process.env.NODE_ENV === "production") {
    return <div>404 — fixture disabled in production</div>;
  }

  return (
    <div data-testid="chat-abort-fixture" style={{ padding: 24 }}>
      <h1>T-026 ChatPanel abort fixture</h1>
      <p data-testid="abort-calls-count">abortCalls: {abortCalls.length}</p>
      <p data-testid="abort-calls-last">last: {abortCalls[abortCalls.length - 1] ?? "(none)"}</p>
      <div style={{ position: "relative", height: 600, border: "1px solid #ccc" }}>
        <ChatPanel
          dialogNpc={{ npcId: "test-npc-1", npcName: "Test NPC" }}
          npcMessages={[
            { role: "player", content: "안녕하세요" },
            { role: "npc", content: "응답 중..." },
          ]}
          isNpcStreaming
          onSend={() => {}}
          onAbort={(npcId) => {
            setAbortCalls((prev) => [...prev, npcId]);
            if (typeof window !== "undefined") {
              window.__abortCalls__ = [...(window.__abortCalls__ ?? []), npcId];
            }
          }}
          onClose={() => {}}
          npcSelectList={null}
          onSelectNpc={() => {}}
          channelMessages={[]}
          onSendChannelChat={() => {}}
        />
      </div>
    </div>
  );
}
