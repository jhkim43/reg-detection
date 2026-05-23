"""seed-v9 T-F06 — Tests for POST /v1/chat/abort/{session_id} endpoint.

RFC-nanobot-cancel-endpoint Option A acceptance criteria.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

from nanobot.api.server import create_app

try:
    from aiohttp.test_utils import TestClient, TestServer

    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False

pytest_plugins = ("pytest_asyncio",)


def _make_agent_with_cancel(cancel_return: int = 0) -> MagicMock:
    """Build a mock agent_loop whose _cancel_active_tasks returns *cancel_return*."""
    agent = MagicMock()
    agent._connect_mcp = AsyncMock()
    agent.close_mcp = AsyncMock()
    agent._cancel_active_tasks = AsyncMock(return_value=cancel_return)
    # chat completions 흐름이 abort 테스트에서 호출될 일은 없지만 안전하게 stub.
    agent.process_direct = AsyncMock(return_value="ok")
    return agent


@pytest_asyncio.fixture
async def aiohttp_client():
    clients: list[TestClient] = []

    async def _make_client(app):
        client = TestClient(TestServer(app))
        await client.start_server()
        clients.append(client)
        return client

    try:
        yield _make_client
    finally:
        for client in clients:
            await client.close()


# ---------------------------------------------------------------------------
# AC §3.2 (1)(2)(3)(5): happy path — active task 1건 cancel
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_chat_abort_cancels_active_task(aiohttp_client) -> None:
    """active task 1건 cancel 시 status='cancelled', cancelled_count=1."""
    agent = _make_agent_with_cancel(cancel_return=1)
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    resp = await client.post("/v1/chat/abort/sess-1")

    assert resp.status == 200
    body = await resp.json()
    assert body == {
        "session_id": "sess-1",
        "status": "cancelled",
        "cancelled_count": 1,
    }
    # _cancel_active_tasks가 정확히 "api:sess-1" session_key로 호출됨
    agent._cancel_active_tasks.assert_awaited_once_with("api:sess-1")


# ---------------------------------------------------------------------------
# AC §3.2 (5): idempotent — 활성 task 없을 때 no_active
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_chat_abort_idempotent_no_active(aiohttp_client) -> None:
    """활성 task 0건 → status='no_active', cancelled_count=0, 200 OK."""
    agent = _make_agent_with_cancel(cancel_return=0)
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    # 같은 session에 대해 두 번 호출 — idempotent 보장
    resp1 = await client.post("/v1/chat/abort/empty-sess")
    resp2 = await client.post("/v1/chat/abort/empty-sess")

    assert resp1.status == 200
    assert resp2.status == 200
    for resp in (resp1, resp2):
        body = await resp.json()
        assert body["status"] == "no_active"
        assert body["cancelled_count"] == 0
        assert body["session_id"] == "empty-sess"


# ---------------------------------------------------------------------------
# AC §3.2 (4): session_lock 점유 중에도 abort route 응답 < 100ms
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_chat_abort_independent_of_session_lock(aiohttp_client) -> None:
    """abort route는 session_lock과 독립 — chat completions 점유 중에도 즉시 응답.

    핵심 시나리오: 같은 session_key의 session_lock을 사전에 점유해두고,
    abort route를 호출. lock을 acquire하지 않고 빠르게 (< 100ms) 응답해야 한다.
    """
    agent = _make_agent_with_cancel(cancel_return=1)
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    # 사전에 같은 session_key("api:locked-sess")의 lock을 외부에서 점유
    session_locks = app["session_locks"]
    held = asyncio.Lock()
    session_locks["api:locked-sess"] = held
    await held.acquire()

    try:
        # abort 호출이 lock을 기다리지 않고 빠르게 응답해야 한다 (timeout 0.5s 안전 여유).
        resp = await asyncio.wait_for(
            client.post("/v1/chat/abort/locked-sess"),
            timeout=0.5,
        )
        assert resp.status == 200
        body = await resp.json()
        assert body["status"] == "cancelled"
        assert body["cancelled_count"] == 1
    finally:
        held.release()


# ---------------------------------------------------------------------------
# 에러 처리: _cancel_active_tasks 가 throw 시 500 + abort failed
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_chat_abort_returns_500_on_cancel_error(aiohttp_client) -> None:
    """_cancel_active_tasks가 예외 발생 시 500 응답 — chat 흐름 미영향."""
    agent = MagicMock()
    agent._connect_mcp = AsyncMock()
    agent.close_mcp = AsyncMock()
    agent._cancel_active_tasks = AsyncMock(side_effect=RuntimeError("internal boom"))
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    resp = await client.post("/v1/chat/abort/broken-sess")

    assert resp.status == 500
    body = await resp.json()
    # _error_json shape: { error: { message, type } }
    assert "error" in body
    assert body["error"]["message"] == "abort failed"


def test_handle_chat_completions_catches_connection_reset_during_stream() -> None:
    """seed-v9 phase 4.5 follow-up — SSE write가 ConnectionResetError를 catch.

    deskrpg "중단" 버튼이 TCP 연결을 끊을 때 ClientConnectionResetError가
    traceback으로 노출되던 문제 (smoke test 2026-05-23). 실제 streaming 중
    client disconnect 시나리오는 aiohttp test_utils로 simulate하기 까다로워
    정적 검사로 회귀 방지한다.
    """
    import inspect
    from nanobot.api import server as api_server

    src = inspect.getsource(api_server.handle_chat_completions)
    assert "ConnectionResetError" in src, (
        "handle_chat_completions must catch ConnectionResetError "
        "around resp.write to avoid abort traceback noise"
    )
    # chunk write 루프 + [DONE] terminator write 양쪽 모두 가드 (최소 2회 등장).
    assert src.count("ConnectionResetError") >= 2, (
        "both the chunk write loop AND the [DONE] terminator write "
        "must guard against ConnectionResetError"
    )
