"""Shared lifecycle hook primitives for agent runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import json
from typing import Any

from loguru import logger

from nanobot.providers.base import LLMResponse, ToolCallRequest
from nanobot.utils.helpers import safe_filename

@dataclass(slots=True)
class AgentHookContext:
    """Mutable per-iteration state exposed to runner hooks."""

    iteration: int
    messages: list[dict[str, Any]]
    response: LLMResponse | None = None
    usage: dict[str, int] = field(default_factory=dict)
    tool_calls: list[ToolCallRequest] = field(default_factory=list)
    tool_results: list[Any] = field(default_factory=list)
    tool_events: list[dict[str, str]] = field(default_factory=list)
    streamed_content: bool = False
    final_content: str | None = None
    stop_reason: str | None = None
    error: str | None = None
    session_key: str | None = None


class AgentHook:
    """Minimal lifecycle surface for shared runner customization."""

    def __init__(self, reraise: bool = False) -> None:
        self._reraise = reraise

    def wants_streaming(self) -> bool:
        return False

    async def before_iteration(self, context: AgentHookContext) -> None:
        pass

    async def on_stream(self, context: AgentHookContext, delta: str) -> None:
        pass

    async def on_stream_end(self, context: AgentHookContext, *, resuming: bool) -> None:
        pass

    async def before_execute_tools(self, context: AgentHookContext) -> None:
        pass

    async def after_iteration(self, context: AgentHookContext) -> None:
        pass

    def finalize_content(self, context: AgentHookContext, content: str | None) -> str | None:
        return content


class CompositeHook(AgentHook):
    """Fan-out hook that delegates to an ordered list of hooks.

    Error isolation: async methods catch and log per-hook exceptions
    so a faulty custom hook cannot crash the agent loop.
    ``finalize_content`` is a pipeline (no isolation — bugs should surface).
    """

    __slots__ = ("_hooks",)

    def __init__(self, hooks: list[AgentHook]) -> None:
        super().__init__()
        self._hooks = list(hooks)

    def wants_streaming(self) -> bool:
        return any(h.wants_streaming() for h in self._hooks)

    async def _for_each_hook_safe(self, method_name: str, *args: Any, **kwargs: Any) -> None:
        for h in self._hooks:
            if getattr(h, "_reraise", False):
                await getattr(h, method_name)(*args, **kwargs)
                continue

            try:
                await getattr(h, method_name)(*args, **kwargs)
            except Exception:
                logger.exception("AgentHook.{} error in {}", method_name, type(h).__name__)

    async def before_iteration(self, context: AgentHookContext) -> None:
        await self._for_each_hook_safe("before_iteration", context)

    async def on_stream(self, context: AgentHookContext, delta: str) -> None:
        await self._for_each_hook_safe("on_stream", context, delta)

    async def on_stream_end(self, context: AgentHookContext, *, resuming: bool) -> None:
        await self._for_each_hook_safe("on_stream_end", context, resuming=resuming)

    async def before_execute_tools(self, context: AgentHookContext) -> None:
        await self._for_each_hook_safe("before_execute_tools", context)

    async def after_iteration(self, context: AgentHookContext) -> None:
        await self._for_each_hook_safe("after_iteration", context)

    def finalize_content(self, context: AgentHookContext, content: str | None) -> str | None:
        for h in self._hooks:
            content = h.finalize_content(context, content)
        return content


class SDKCaptureHook(AgentHook):
    """Record tool names and the final message list for ``RunResult``.

    The runner mutates ``context.messages`` in place across iterations, so the
    snapshot is refreshed on every ``after_iteration`` call; the last call
    reflects the end-of-turn state the SDK caller cares about.
    """

    def __init__(self) -> None:
        super().__init__()
        self.tools_used: list[str] = []
        self.messages: list[dict[str, Any]] = []

    async def after_iteration(self, context: AgentHookContext) -> None:
        for call in context.tool_calls:
            self.tools_used.append(call.name)
        self.messages = list(context.messages)

class TokenTrackingHook(AgentHook):
    """Track token usage per iteration and persist session metadata to JSON."""

    def __init__(self, workspace_path: str) -> None:
        super().__init__(reraise=False)  # Don't crash on logging errors
        self.workspace = Path(workspace_path)
        self.sessions_dir = self.workspace / "sessions"
        # Ensure the workspace and sessions directories exist
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        logger.info(
            "TokenTrackingHook initialized: will write session metadata files in {}",
            self.sessions_dir,
        )

    async def after_iteration(self, context: AgentHookContext) -> None:
        usage = context.usage or {}
        prompt_tokens = usage.get("prompt_tokens", 0)
        completion_tokens = usage.get("completion_tokens", 0)
        cached_tokens = usage.get("cached_tokens", 0)
        total_tokens = prompt_tokens + completion_tokens

        logger.info(
            "TokenTrackingHook.after_iteration called: iteration={}, usage={}",
            context.iteration,
            usage,
        )

        session_key = context.session_key or "default"
        session_id = safe_filename(session_key.replace(":", "_"))
        session_file = self.sessions_dir / f"{session_id}.token.json"
        timestamp = datetime.now().isoformat()

        session_data: dict[str, Any] = {}
        if session_file.exists():
            try:
                session_data = json.loads(session_file.read_text(encoding="utf-8"))
            except Exception:
                session_data = {}

        iterations = session_data.get("iterations", [])
        event_phase = "llm_response"
        if context.tool_results:
            event_phase = "tool_execution"
        elif context.response is not None and context.response.should_execute_tools:
            event_phase = "tool_request"
        elif context.response is not None and context.response.finish_reason == "length":
            event_phase = "length_recovery"
        elif context.response is not None and context.response.finish_reason == "error":
            event_phase = "llm_error"
        elif context.final_content is not None and context.stop_reason == "ask_user":
            event_phase = "ask_user"
        elif context.final_content is not None:
            event_phase = "final_response"

        iterations.append(
            {
                "event_index": len(iterations) + 1,
                "iteration": context.iteration,
                "phase": event_phase,
                "response_finish_reason": context.response.finish_reason if context.response is not None else None,
                "tool_calls": [tc.name for tc in context.tool_calls],
                "tool_results": [type(result).__name__ for result in context.tool_results],
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cached_tokens": cached_tokens,
                "total_tokens": total_tokens,
                "timestamp": timestamp,
            }
        )

        totals = {
            "prompt_tokens": sum(item.get("prompt_tokens", 0) for item in iterations),
            "completion_tokens": sum(item.get("completion_tokens", 0) for item in iterations),
            "cached_tokens": sum(item.get("cached_tokens", 0) for item in iterations),
            "total_tokens": sum(item.get("total_tokens", 0) for item in iterations),
        }

        session_data["session_key"] = session_key
        session_data["last_updated"] = timestamp
        session_data["totals"] = totals
        session_data["iterations"] = iterations

        try:
            session_file.write_text(
                json.dumps(session_data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            logger.info("Session token metadata saved to {}", session_file)
        except Exception as e:
            logger.error(
                "Failed to save session token metadata to {}: {}",
                session_file,
                e,
                exc_info=True,
            )
