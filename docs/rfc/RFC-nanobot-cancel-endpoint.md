# RFC: nanobot-side Chat Cancel Endpoint

| Status | **Accepted — Option A** (2026-05-19) |
|---|---|
| Author | M3/M4 owner |
| Created | 2026-05-19 |
| Tracking | seed-v9 amendment `backlog-4` |
| Affects | nanobot fork (`nanobot/api/server.py` 신규 route), deskrpg gateway adapter |

---

## 1. Motivation

Phase 3 smoke test(2026-05-19)에서 chatAbort 동작을 확인한 결과:

- 사용자가 채팅 "중단" 버튼 클릭 → deskrpg fetch `AbortSignal` → SSE HTTP 연결 종료
- 그러나 nanobot 측 `agent_loop.process_direct()`는 별도 asyncio task로 동작 — HTTP client disconnect를 자동으로 감지하지 않음
- 결과:
  - UI는 정상 정지 (사용자 체감 OK)
  - 백엔드 LLM은 잠시 더 token 생성 (비용 낭비)
  - 토큰 비용/quota 관점에서 의미 있는 손실

사용자 관찰(2026-05-19): "중지를 누르면 nanobot까지 중지 신호가 가는건가? 그럴땐 그냥 챗 형태로 '중지'가 가는건가?" → 현재는 **HTTP-level abort(TCP 단절)**만, chat 메시지로 "중지"가 전송되는 게 아님이 명확화됨.

---

## 2. 사전 조사 결과 (2026-05-19)

본 RFC 작성 후, **nanobot 측에 이미 cancel 인프라가 충분히 존재**함을 확인했다. 즉 새 함수를 만드는 것이 아니라 **기존 함수를 HTTP route로 노출**하는 작업으로 좁혀진다.

### 2.1 이미 존재하는 자산

```python
# nanobot/agent/loop.py:527
async def _cancel_active_tasks(self, key: str) -> int:
    """Cancel and await all active tasks and subagents for *key*.
    Returns the total number of cancelled tasks + subagents."""
    tasks = self._active_tasks.pop(key, [])
    cancelled = sum(1 for t in tasks if not t.done() and t.cancel())
    for t in tasks:
        with suppress(asyncio.CancelledError, Exception):
            await t
    sub_cancelled = await self.subagents.cancel_by_session(key)
    return cancelled + sub_cancelled
```

```python
# nanobot/command/builtin.py:100, 475
async def cmd_stop(ctx: CommandContext) -> OutboundMessage:
    total = await ctx.loop._cancel_active_tasks(msg.session_key)
    ...
router.priority("/stop", cmd_stop)   # 슬래시 커맨드로 이미 등록
```

`_cancel_active_tasks`는 session_key 기준으로 (1) main asyncio task + (2) subagent까지 함께 취소한다. CLI/Discord 채널은 이미 `/stop` 슬래시 커맨드로 이를 사용 중.

### 2.2 그러나 HTTP API에선 호출 불가

```python
# nanobot/api/server.py:396-398
app.router.add_post("/v1/chat/completions", handle_chat_completions)
app.router.add_get("/v1/models", handle_models)
app.router.add_get("/health", handle_health)
# → cancel/abort route 없음
```

`/stop` 메시지를 같은 chat completions endpoint로 보내는 우회로도 동작하지 않는다:

```python
# nanobot/api/server.py:264
async with session_lock:                           # ◀── 같은 session 직렬화
    response = await agent_loop.process_direct(    # ◀── 슬래시 dispatch 가능하나
        content=text, session_key=session_key, ...  #     in-flight면 lock 대기
    )
```

같은 `session_id`로 `"/stop"` 메시지를 보내면 `session_lock`을 기다리느라 첫 응답이 끝날 때까지 진입 못 함 → cancel 신호로서 의미가 없다.

### 2.3 결론

**별도 HTTP route 필요**. 그러나 핵심 cancel 로직(`_cancel_active_tasks`)이 이미 있어, **thin route wrapper만 추가**하면 된다.

---

## 3. 선택된 Option — A (확정)

### 3.1 후보 비교 (참고)

| Option | 요지 | 채택 여부 |
|---|---|---|
| **A** | `POST /v1/chat/abort/{session_id}` 신규 route — `_cancel_active_tasks` thin wrapper | **채택** |
| B | HTTP request disconnect 자동 감지 (transport polling) | 기각 — 비결정적 감지 시점, polling cost |
| C | Backlog-1 (task tool API)과 같은 cycle에 통합 | 기각 — 본 변경은 30분짜리라 의존시킬 이유 없음. 통합은 backlog-1 진행 시 별도 결정. |

### 3.2 Option A — Acceptance Criteria

1. `POST /v1/chat/abort/{session_id}` 가 nanobot HTTP API에 노출되어 있다.
2. 호출 시 해당 `session_key`(`api:{session_id}` 또는 `API_SESSION_KEY`)의 in-flight task + subagent가 모두 취소된다.
3. 응답 shape: `{ session_id, status, cancelled_count }`. status는 `"cancelled" | "no_active"` 중 하나.
4. **session_lock과 독립적인 route** — chat completions 중에도 호출 가능 (별 lock acquire X).
5. 호출 자체는 idempotent — 이미 종료된 session에 대해 200 OK + `status="no_active"` 응답.
6. deskrpg `chatAbort(npcId, sessionKey)`가 기존 HTTP-level abort에 더해 본 endpoint를 호출한다. 실패는 non-fatal (best-effort).

---

## 4. Implementation Sketch (~25 lines + 1 wiring)

### 4.1 nanobot/api/server.py

```python
async def handle_chat_abort(request: web.Request) -> web.Response:
    """POST /v1/chat/abort/{session_id} — cancel in-flight task for session.

    Independent of session_lock so cancel can race in-flight completions.
    """
    session_id = request.match_info.get("session_id") or ""
    session_key = f"api:{session_id}" if session_id else API_SESSION_KEY

    agent_loop = request.app["agent_loop"]
    try:
        cancelled = await agent_loop._cancel_active_tasks(session_key)
    except Exception:
        logger.exception("chat:abort failed for session {}", session_key)
        return _error_json(500, "abort failed", err_type="server_error")

    logger.info("API abort session_key={} cancelled={}", session_key, cancelled)
    return web.json_response({
        "session_id": session_id,
        "status": "cancelled" if cancelled > 0 else "no_active",
        "cancelled_count": cancelled,
    })


# create_app() 내 route 등록 부분에 추가:
app.router.add_post("/v1/chat/abort/{session_id}", handle_chat_abort)
```

### 4.2 deskrpg/src/lib/nanobot-client.js 확장

```javascript
async function nanobotPostAbort(sessionKey) {
  try {
    const url = getApiUrl() + "/chat/abort/" + encodeURIComponent(String(sessionKey));
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
  } catch (_e) {
    // best-effort: HTTP-level abort already happened via AbortController.
  }
}

// chatAbort 안에서 ac.abort() 이후 호출:
async chatAbort(npcId, sessionKey) {
  const key = nanobotAbortKey(npcId, sessionKey);
  const ac = nanobotAbortControllers.get(key);
  if (ac) {
    try { ac.abort(); } catch (_e) {}
    nanobotAbortControllers.delete(key);
  }
  await nanobotPostAbort(sessionKey);
}
```

### 4.3 Tests

| Test | Scope | Location |
|---|---|---|
| nanobot: abort endpoint 호출 시 active task 1건 cancel + json shape | unit (pytest) | `nanobot/tests/api/test_chat_abort.py` 신설 |
| nanobot: 활성 task 없을 때 `no_active` 응답 (idempotent) | unit | 위 동일 |
| nanobot: session_lock 점유 중에도 abort route 응답 빠름 | integration | 위 동일 |
| deskrpg: nanobotPostAbort 실패가 chatAbort을 throw 시키지 않음 | unit (node:test) | `nanobot-chat-streaming.test.ts` 확장 |
| deskrpg: chatAbort 후 nanobot 측 fetch 호출 발생 | unit | 위 동일 |

---

## 5. 미해결 질문 (구현 전 합의 필요)

### 5.1 session_id 매핑

- deskrpg는 abort key를 `${npcId}::${sessionKey}` 로 만들고, sessionKey가 nanobot session_id의 source.
- nanobot은 `f"api:{session_id}" if session_id else API_SESSION_KEY` 로 변환.
- **결정 필요**: deskrpg가 `nanobotPostAbort`에 전달하는 값이 nanobot의 `session_id` (prefix `api:` 없음) 인지 확인. 현재 `nanobot-client.js`는 `buildNanobotRequestBody`에서 `body.session_id = String(opts.sessionId)`로 raw sessionKey를 보내고 있어 정합성 OK로 보임 — 단위 테스트에서 재확인.

### 5.2 Partial token 기록

- cancel 시점까지 사용된 partial tokens는 LLMUsageRecord에 어떻게?
- 현재(seed-v9 AC-020): 응답 완료 시 1건 INSERT.
- **결정**: 본 RFC scope 외. partial token 기록은 별 issue — 우선은 abort 시 LLMUsageRecord 미기록(현행 유지).

### 5.3 Authorization

- chat completions 자체가 internal traffic (`NANOBOT_API_URL=http://localhost:8900/v1`, no auth header in current client).
- 신규 abort route도 동일한 internal 모델 — 별 인증 없음.
- **결정**: 본 RFC scope 외 — 인증은 nanobot HTTP API 전체에 적용되어야 할 별 이슈.

### 5.4 SSE sentinel

- abort로 stream이 중간에 닫힐 때 deskrpg client는 `data: [DONE]` 만 정의된 sentinel을 받음.
- 현재 deskrpg `nanobotChatStream`은 reader.read() done 또는 [DONE]로 종료 인식 — 둘 다 무탈히 정리됨.
- **결정**: 새 sentinel(`[CANCELLED]`) 도입 불요. 기존 [DONE] 흐름 그대로.

---

## 6. 다음 단계

1. **본 RFC 머지** (chore/v9-evolve branch에 포함, 다른 컴퓨터에서도 git pull로 가용).
2. **seed-v10 후속 (또는 seed-v9 living-spec evolve)**: 본 변경은 새 AC가 필요한가? 의견:
   - 기존 AC-014(Chat streaming parity) 안에 chatAbort가 명시되어 있고, 본 RFC는 그 구현 충실도 개선 — **별 AC 신설 없이 AC-014 verification 강화로 처리** 권장.
   - 즉 seed-v10이 별도로 필요한 변경이 아님. evolve loop으로 충분.
3. **/decompose 또는 followup decomposition에 task 추가**:
   - T-F06 (logic, nanobot): `nanobot/api/server.py` 에 `handle_chat_abort` + route 등록 + pytest 3건.
   - T-F07 (logic, deskrpg): `nanobot-client.js` `chatAbort` 에 `nanobotPostAbort` 호출 추가 + unit test 2건.
4. **머지 순서**: deskrpg 변경은 nanobot 변경에 의존(404 fallback 가능하지만 정상 path 확보 위해) → nanobot PR 머지 → deskrpg PR 머지.

---

## 7. 변경 이력

- 2026-05-19T17:30:00 — Draft 생성. seed-v9 amendment 2 backlog-4 진입점.
- 2026-05-19T18:00:00 — 사전 조사 결과 반영. Option A 채택 확정. nanobot 내부에 `_cancel_active_tasks` + `cmd_stop`이 이미 존재 — 본 변경은 thin route wrapper로 축소. session_lock 우회 필수 사항 명시.
