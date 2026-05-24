/**
 * seed-v9 T-F07 — nanobot 내부 task 취소를 위한 best-effort POST helper.
 *
 * 현재 chatAbort는 fetch AbortController로 HTTP-level abort만 수행 — nanobot
 * 측 LLM 계산은 자연 완료까지 계속 진행되어 토큰 비용이 발생한다. 본 helper는
 * nanobot의 새 endpoint(`POST /v1/chat/abort/{session_id}` — T-F06)를 호출해
 * 실제로 활성 task를 취소시킨다.
 *
 * 정책:
 *   - best-effort — fetch 실패는 비치명 (nanobot이 구버전이라 404면 그냥 패스).
 *   - chatAbort 흐름을 throw로 깨뜨리지 않는다.
 *
 * 별 파일로 분리한 이유: `nanobot-client.ts` (dev path)와 baseName이 같아 tsx의
 * bundler resolver가 require("./nanobot-client.cjs")를 .ts로 redirect → 인라인이면
 * 단위 테스트 불가. 동일 패턴: `nanobot-session-recorder.js` (T-F03).
 */

"use strict";

async function postNanobotChatAbort(baseUrl, sessionKey) {
  try {
    const root = String(baseUrl || "").replace(/\/+$/, "");
    if (!root) return;
    const url = root + "/chat/abort/" + encodeURIComponent(String(sessionKey));
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (_e) {
    // best-effort: HTTP-level abort already happened via AbortController.
    // nanobot 측 구버전이거나 네트워크 불안정해도 chatAbort 흐름은 계속.
  }
}

module.exports = { postNanobotChatAbort };
