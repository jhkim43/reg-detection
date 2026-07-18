"""seed-v9 AC-014 T-027 — deskrpg ↔ nanobot SSE contract verify-only test.

deskrpg/src/lib/nanobot-chat-streaming.ts의 chatSendStream이 nanobot에 의존하는
계약을 명시적으로 lock-in. 변경 시 양쪽이 동시에 깨지도록 한다.

검증 사항:
  - POST /v1/chat/completions (path)
  - body: {messages: [{role, content}], stream: true, session_id?}
  - response Content-Type: text/event-stream
  - chunk format: "data: {chatcmpl-...}\\n\\n"
  - terminator: "data: [DONE]\\n\\n"
  - chunk JSON: {choices: [{delta: {content}, finish_reason?}]}
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanobot.api.server import create_app

try:
    from aiohttp.test_utils import TestClient, TestServer

    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False


def _make_streaming_agent(tokens: list[str]) -> MagicMock:
    """deskrpg가 보내는 user message에 응답하는 mock agent."""
    agent = MagicMock()
    agent._connect_mcp = AsyncMock()
    agent.close_mcp = AsyncMock()

    async def fake_process_direct(
        *, content="", media=None, session_key="", channel="",
        chat_id="", on_stream=None, on_stream_end=None, **kwargs,
    ):
        if on_stream:
            for token in tokens:
                await on_stream(token)
        if on_stream_end:
            await on_stream_end()
        return "".join(tokens)

    agent.process_direct = fake_process_direct
    return agent


@pytest.fixture
async def aiohttp_client():
    clients: list = []

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


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_deskrpg_contract_endpoint_path_v1_chat_completions(aiohttp_client):
    """deskrpg buildEndpoint: ${baseUrl}/chat/completions (baseUrl ends with /v1)."""
    agent = _make_streaming_agent(["ok"])
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    # exact path deskrpg가 hit하는 경로
    resp = await client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
    )
    assert resp.status == 200, f"deskrpg chatSendStream expects 200 at /v1/chat/completions, got {resp.status}"


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_deskrpg_contract_accepts_session_id_field(aiohttp_client):
    """deskrpg chatSendStream sends `session_id` in body — must not 400."""
    agent = _make_streaming_agent(["ok"])
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    resp = await client.post(
        "/v1/chat/completions",
        json={
            "session_id": "api:npc-x-dm-user-1",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": True,
        },
    )
    assert resp.status == 200, "session_id field must be accepted (deskrpg sessionKey)"


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_deskrpg_contract_content_type_is_text_event_stream(aiohttp_client):
    """deskrpg SSE 파서는 res.body를 ReadableStream으로 읽음 → Content-Type 확인."""
    agent = _make_streaming_agent(["ok"])
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    resp = await client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
    )
    assert resp.content_type == "text/event-stream"


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_deskrpg_contract_chunk_format_data_prefix_double_newline(aiohttp_client):
    """deskrpg SSE 파서: buffer.split('\\n') + line.startswith('data:')."""
    agent = _make_streaming_agent(["Hello", " ", "world"])
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    resp = await client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
    )
    body = await resp.text()

    # 모든 비-empty 라인이 'data: '로 시작
    non_empty = [line for line in body.split("\n") if line]
    for line in non_empty:
        assert line.startswith("data: "), f"All SSE lines must start with 'data: ', got: {line!r}"


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_deskrpg_contract_terminator_is_data_done(aiohttp_client):
    """deskrpg SSE 파서: payload === '[DONE]' 시 break."""
    agent = _make_streaming_agent(["x"])
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    resp = await client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
    )
    body = await resp.text()
    data_lines = [line[len("data: "):] for line in body.split("\n") if line.startswith("data: ")]
    assert data_lines[-1] == "[DONE]", "stream must terminate with 'data: [DONE]'"


@pytest.mark.skipif(not HAS_AIOHTTP, reason="aiohttp not installed")
@pytest.mark.asyncio
async def test_deskrpg_contract_chunk_json_shape_choices_delta_content(aiohttp_client):
    """deskrpg SSE 파서: json.choices?.[0]?.delta?.content 추출."""
    agent = _make_streaming_agent(["A", "B"])
    app = create_app(agent, model_name="test-model")
    client = await aiohttp_client(app)

    resp = await client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
    )
    body = await resp.text()

    json_lines = [
        line[len("data: "):]
        for line in body.split("\n")
        if line.startswith("data: ") and not line.endswith("[DONE]")
    ]
    chunks = [json.loads(line) for line in json_lines]
    # 첫 N개는 content 들어있음, 마지막은 finish_reason=stop with empty delta
    content_chunks = [c for c in chunks if c["choices"][0].get("delta", {}).get("content")]
    assert [c["choices"][0]["delta"]["content"] for c in content_chunks] == ["A", "B"]
