// seed-v9 AC-014 T-026 — UI contract E2E for Abort button.
//
// 검증 범위 (현 PR):
//   - isNpcStreaming=true 시 Abort 버튼이 노출된다 (i18n 텍스트 "중단" 또는 "Abort")
//   - 클릭 시 onAbort(npcId) 콜백이 1회 호출되며 npcId가 정확히 전달된다
//   - 중복 클릭은 멱등 처리 (해당 부분은 서버 abortPendingChat 가드에서 보장 — UI는 차단 X)
//
// 범위 밖 (Phase 4 testcontainers + Phase 6 시연 시점):
//   - 실 socket round-trip (chat:abort 이벤트 송수신)
//   - 실 nanobotAgentSessions.aborted_at DB write
//   - 실 nanobot HTTP /chat/completions SSE chunk progressive 렌더

import { test, expect } from "@playwright/test";

test.describe("AC-014 T-026 — Chat abort UI contract", () => {
  test("Abort button is visible while NPC chat is streaming", async ({ page }) => {
    await page.goto("/__test__/chat-abort");
    const abortBtn = page.getByTestId("npc-chat-abort");
    await expect(abortBtn).toBeVisible();
  });

  test("Clicking Abort fires onAbort with the active npcId once", async ({ page }) => {
    await page.goto("/__test__/chat-abort");
    await expect(page.getByTestId("abort-calls-count")).toHaveText(/abortCalls: 0/);

    await page.getByTestId("npc-chat-abort").click();

    await expect(page.getByTestId("abort-calls-count")).toHaveText(/abortCalls: 1/);
    await expect(page.getByTestId("abort-calls-last")).toHaveText(/last: test-npc-1/);

    // global pickle for cross-check
    const calls = await page.evaluate(() => window.__abortCalls__ ?? []);
    expect(calls).toEqual(["test-npc-1"]);
  });

  test("Abort button has accessible aria-label", async ({ page }) => {
    await page.goto("/__test__/chat-abort");
    const btn = page.getByTestId("npc-chat-abort");
    const aria = await btn.getAttribute("aria-label");
    // i18n locale auto-detected — 둘 중 하나
    expect(aria).toMatch(/^(중단|Abort|中断|中止)$/);
  });
});
