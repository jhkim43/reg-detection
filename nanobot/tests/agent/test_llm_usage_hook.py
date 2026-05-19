"""seed-v9 AC-020 T-030 — LLMUsageRecordHook provider 라벨링 + POST 페이로드 단위 테스트.

deskrpg /api/internal/llm-usage POST는 mock하고 payload만 검증.
hook 내부 asyncio.create_task(self._post(...))로 schedule되므로 각 테스트는
await asyncio.sleep(0)로 event loop에 tick을 줘서 scheduled coro 실행.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from nanobot.agent.hook import (
    AgentHookContext,
    LLMUsageRecordHook,
    _classify_provider,
)


# ─── _classify_provider — pure ───

def test_classify_provider_openrouter_prefix():
    assert _classify_provider("openrouter/anthropic/claude-3.5-sonnet") == "openrouter"


def test_classify_provider_openrouter_uppercase():
    assert _classify_provider("OPENROUTER/openai/gpt-4o") == "openrouter"


def test_classify_provider_local_qwen():
    assert _classify_provider("qwen/qwen3.6-35b-a3b") == "nanobot"


def test_classify_provider_empty_string():
    assert _classify_provider("") == "nanobot"


def test_classify_provider_plain_model_id():
    assert _classify_provider("gpt-4o-mini") == "nanobot"


# ─── LLMUsageRecordHook.after_iteration — payload 빌드 + POST ───


def _make_context(
    *,
    session_key: str = "api:agent-001-dm-user-1",
    prompt_tokens: int = 100,
    completion_tokens: int = 50,
    cached_tokens: int = 0,
    response_model: str | None = None,
    response_provider: str | None = None,
    response_present: bool = True,
) -> AgentHookContext:
    response = None
    if response_present:
        response = MagicMock()
        response.model = response_model
        response.provider = response_provider
        response.should_execute_tools = False

    ctx = MagicMock(spec=AgentHookContext)
    ctx.session_key = session_key
    ctx.usage = {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cached_tokens": cached_tokens,
    }
    ctx.response = response
    ctx.tool_results = None
    ctx.final_content = "hello"
    return ctx


def _install_capture_post(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Replace LLMUsageRecordHook._post with an async capture and return the captured list."""
    captured: list[dict] = []

    async def fake_post(self, payload):
        captured.append(payload)

    monkeypatch.setattr(LLMUsageRecordHook, "_post", fake_post, raising=True)
    return captured


@pytest.mark.asyncio
async def test_after_iteration_uses_openrouter_label_for_openrouter_model(
    monkeypatch: pytest.MonkeyPatch,
):
    captured = _install_capture_post(monkeypatch)
    hook = LLMUsageRecordHook(regtrack_url="http://deskrpg:3000")
    ctx = _make_context(response_model="openrouter/anthropic/claude-3.5-sonnet")

    await hook.after_iteration(ctx)
    await asyncio.sleep(0)  # let scheduled _post task run

    assert len(captured) == 1
    assert captured[0]["provider"] == "OPENROUTER"
    assert captured[0]["model"] == "openrouter/anthropic/claude-3.5-sonnet"


@pytest.mark.asyncio
async def test_after_iteration_uses_nanobot_label_for_local_model(
    monkeypatch: pytest.MonkeyPatch,
):
    captured = _install_capture_post(monkeypatch)
    hook = LLMUsageRecordHook(regtrack_url="http://deskrpg:3000")
    ctx = _make_context(response_model="qwen/qwen3.6-35b-a3b")

    await hook.after_iteration(ctx)
    await asyncio.sleep(0)

    assert len(captured) == 1
    assert captured[0]["provider"] == "NANOBOT"
    assert captured[0]["model"] == "qwen/qwen3.6-35b-a3b"


@pytest.mark.asyncio
async def test_after_iteration_falls_back_to_NANOBOT_MODEL_env(
    monkeypatch: pytest.MonkeyPatch,
):
    captured = _install_capture_post(monkeypatch)
    monkeypatch.setenv("NANOBOT_MODEL", "qwen/qwen3.6-35b-a3b")

    hook = LLMUsageRecordHook(regtrack_url="http://deskrpg:3000")
    ctx = _make_context(response_present=False)

    await hook.after_iteration(ctx)
    await asyncio.sleep(0)

    assert len(captured) == 1
    assert captured[0]["provider"] == "NANOBOT"
    assert captured[0]["model"] == "qwen/qwen3.6-35b-a3b"


@pytest.mark.asyncio
async def test_after_iteration_zero_tokens_skips_post(
    monkeypatch: pytest.MonkeyPatch,
):
    captured = _install_capture_post(monkeypatch)
    hook = LLMUsageRecordHook(regtrack_url="http://deskrpg:3000")
    ctx = _make_context(prompt_tokens=0, completion_tokens=0)

    await hook.after_iteration(ctx)
    await asyncio.sleep(0)

    # 0 토큰이면 POST 안 함 (기존 동작 보존)
    assert captured == []


@pytest.mark.asyncio
async def test_after_iteration_explicit_provider_attr_wins_over_inference(
    monkeypatch: pytest.MonkeyPatch,
):
    """LLMResponse.provider가 명시적으로 설정되면 그것을 우선 사용."""
    captured = _install_capture_post(monkeypatch)
    hook = LLMUsageRecordHook(regtrack_url="http://deskrpg:3000")
    # 모델은 local처럼 보이지만 response.provider는 명시적으로 openrouter
    ctx = _make_context(
        response_model="qwen/qwen3.6-35b-a3b",
        response_provider="openrouter",
    )

    await hook.after_iteration(ctx)
    await asyncio.sleep(0)

    assert len(captured) == 1
    assert captured[0]["provider"] == "OPENROUTER"


@pytest.mark.asyncio
async def test_after_iteration_includes_required_payload_fields(
    monkeypatch: pytest.MonkeyPatch,
):
    captured = _install_capture_post(monkeypatch)
    hook = LLMUsageRecordHook(regtrack_url="http://deskrpg:3000")
    ctx = _make_context(
        prompt_tokens=200,
        completion_tokens=100,
        cached_tokens=20,
        response_model="qwen/qwen3.6-35b-a3b",
    )

    await hook.after_iteration(ctx)
    await asyncio.sleep(0)

    assert len(captured) == 1
    p = captured[0]
    assert p["sessionKey"] == "api:agent-001-dm-user-1"
    assert p["inputTokens"] == 200
    assert p["outputTokens"] == 100
    assert p["cachedTokens"] == 20
    assert p["model"] == "qwen/qwen3.6-35b-a3b"
    assert p["provider"] == "NANOBOT"
    assert "costUsd" in p
    assert "phase" in p
