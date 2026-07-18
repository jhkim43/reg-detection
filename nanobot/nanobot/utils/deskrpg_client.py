"""Pure HTTP client for DeskRPG internal API.

No nanobot dependencies — usable from any context (channels, tools, scripts).
All methods are best-effort: errors are logged, return None on failure.

Uses aiohttp with a module-level ClientSession for TCP keep-alive across calls
(spawn/task/chat-push/report 등 연속 호출 시 connection 재사용).
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import aiohttp
from loguru import logger


# 모듈 레벨 ClientSession — 첫 호출에 lazy init, 프로세스 살아있는 한 재사용.
# TCP keep-alive로 deskrpg-app과 connection 재사용 → 연속 호출 latency 단축.
_session: aiohttp.ClientSession | None = None
_session_lock = asyncio.Lock()


async def _get_session() -> aiohttp.ClientSession:
    """모듈 레벨 ClientSession 반환 (lazy init, thread-safe via asyncio.Lock)."""
    global _session
    if _session is None or _session.closed:
        async with _session_lock:
            if _session is None or _session.closed:
                _session = aiohttp.ClientSession(
                    connector=aiohttp.TCPConnector(
                        limit=50,
                        keepalive_timeout=60,
                    ),
                )
                logger.debug("[DeskRPG] aiohttp ClientSession initialized")
    return _session


async def close_session() -> None:
    """프로세스 종료 시 호출 권장 (atexit / signal handler)."""
    global _session
    if _session is not None and not _session.closed:
        await _session.close()
        _session = None
        logger.debug("[DeskRPG] aiohttp ClientSession closed")


class DeskRPGClient:
    """HTTP client for DeskRPG internal API endpoints.

    Reads configuration from environment variables:

        DESKRPG_INTERNAL_URL   — base URL (default: http://deskrpg-app:3000)
        INTERNAL_RPC_SECRET   — shared secret for x-deskrpg-internal-secret header
    """

    def __init__(
        self,
        base_url: str | None = None,
        secret: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.environ.get(
            "DESKRPG_INTERNAL_URL"
        ) or os.environ.get(
            "REGTRACK_INTERNAL_URL", "http://deskrpg-app:3000"
        )).rstrip("/")
        self.secret = secret or os.environ.get("INTERNAL_RPC_SECRET")
        if not self.secret:
            logger.warning(
                "[DeskRPG] INTERNAL_RPC_SECRET not set — requests will fail with 401. "
                "Set env var INTERNAL_RPC_SECRET to match deskrpg's x-deskrpg-internal-secret.",
            )

    # ------------------------------------------------------------------
    # Public API methods
    # ------------------------------------------------------------------

    async def create_npc(
        self,
        owner_user_id: str,
        channel_id: str,
        name: str,
        agent_id: str,
        parent_agent_id: str,
        identity: str,
        soul: str,
        locale: str = "ko",
    ) -> dict[str, Any] | None:
        """POST /api/internal/npcs — create a sub-agent NPC.

        Returns the response JSON (containing ``npc.id``) or None on failure.
        """
        payload = {
            "ownerUserId": owner_user_id,
            "channelId": channel_id,
            "name": name,
            "agentId": agent_id,
            "parentAgentId": parent_agent_id,
            "identity": identity,
            "soul": soul,
            "locale": locale,
            "appearance": {
                "bodyType": "male",
                "layers": {
                    "body": {"itemKey": "body", "variant": "light"},
                    "eye_color": {"itemKey": "eye_color", "variant": "blue"},
                },
            },
        }
        return await self._request("POST", "/api/internal/npcs", payload)

    async def delete_npc(self, npc_id: str) -> bool:
        """DELETE /api/internal/npcs/:id — remove a sub-agent NPC.

        Returns True if the server responded 200.
        """
        result = await self._request("DELETE", f"/api/internal/npcs/{npc_id}")
        return result is not None

    async def push_task(
        self,
        channel_id: str,
        npc_id: str,
        npc_task_id: str,
        title: str,
        summary: str,
        status: str,
        action: str,  # create | update | complete | cancel
        assigner_character_id: str | None = None,
        owner_user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """POST /api/internal/tasks — create / update / complete / cancel a task.

        Returns the response JSON or None on failure.
        """
        payload: dict[str, Any] = {
            "channelId": channel_id,
            "npcId": npc_id,
            "npcTaskId": npc_task_id,
            "title": title,
            "summary": summary,
            "status": status,
            "action": action,
            "assignerCharacterId": assigner_character_id or "",
            "ownerUserId": owner_user_id or "",
        }
        if metadata:
            payload["metadata"] = metadata
        return await self._request("POST", "/api/internal/tasks", payload)

    async def chat_push(
        self,
        session_key: str,
        channel_id: str,
        npc_id: str,
        message: str,
        kind: str = "subagent_push",
        subagent_id: str | None = None,
        subagent_label: str | None = None,
        task_npc_task_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """POST /api/internal/chat-push — push a short notification to parent NPC chat.

        Returns the response JSON (containing ``persisted_message_id``) or None.
        """
        payload: dict[str, Any] = {
            "session_key": session_key,
            "channel_id": channel_id,
            "npc_id": npc_id,
            "message": message,
            "kind": kind,
        }
        if subagent_id:
            payload["subagent_id"] = subagent_id
        if subagent_label:
            payload["subagent_label"] = subagent_label
        if task_npc_task_id:
            payload["task_npc_task_id"] = task_npc_task_id
        if metadata:
            payload["metadata"] = metadata
        return await self._request("POST", "/api/internal/chat-push", payload)

    async def relay_subagent_result(
        self,
        session_key: str,
        channel_id: str,
        user_id: str,
        character_id: str,
        parent_npc_id: str,
        parent_npc_label: str,
        subagent_label: str,
        result_summary: str,
        status: str,
    ) -> dict[str, Any] | None:
        """POST /api/internal/relay-subagent-result — trigger main LLM next turn.

        OpenAI API 서버 모드에선 일반 daemon consume_inbound 루프가 없어 sub-agent
        publish_inbound 가 메인 turn을 깨우지 못한다. deskrpg가 nanobot OpenAI
        endpoint 를 새 채팅 요청으로 호출해 메인 LLM 의 새 turn 을 강제 시작.
        """
        payload: dict[str, Any] = {
            "session_key": session_key,
            "channel_id": channel_id,
            "user_id": user_id,
            "character_id": character_id,
            "parent_npc_id": parent_npc_id,
            "parent_npc_label": parent_npc_label,
            "subagent_label": subagent_label,
            "result_summary": result_summary,
            "status": status,
        }
        return await self._request("POST", "/api/internal/relay-subagent-result", payload)

    async def create_report(
        self,
        channel_id: str,
        npc_id: str,
        character_id: str,
        body_markdown: str,
        title: str | None = None,
        creator_sub_agent_label: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """POST /api/internal/reports — push a long markdown report to the ReportPanel.

        Best for full analysis results (KB-scale markdown).
        Returns the response JSON (containing ``persisted_report_id``) or None.
        """
        payload: dict[str, Any] = {
            "channel_id": channel_id,
            "npc_id": npc_id,
            "character_id": character_id,
            "body_markdown": body_markdown,
        }
        if title:
            payload["title"] = title
        if creator_sub_agent_label:
            payload["creator_sub_agent_label"] = creator_sub_agent_label
        if metadata:
            payload["metadata"] = metadata
        return await self._request("POST", "/api/internal/reports", payload)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        timeout: float = 5.0,
    ) -> dict[str, Any] | None:
        """Low-level HTTP request via aiohttp ClientSession (keep-alive).

        Best-effort — returns None on failure (예외 안 던짐, 호출자가 None 처리).
        """
        url = f"{self.base_url}{path}"
        headers = {
            "x-deskrpg-internal-secret": self.secret or "",
            "Content-Type": "application/json",
        }
        req_timeout = aiohttp.ClientTimeout(total=timeout)

        try:
            session = await _get_session()
            async with session.request(
                method,
                url,
                json=body,
                headers=headers,
                timeout=req_timeout,
            ) as resp:
                text = await resp.text()
                status = resp.status
                logger.info("[DeskRPG HTTP] {} {} -> {}", method, path, status)

                # 200~299: 성공
                if 200 <= status < 300:
                    if not text:
                        return {}
                    try:
                        return json.loads(text)
                    except json.JSONDecodeError:
                        logger.warning(
                            "[DeskRPG] Non-JSON response {} {}: {}",
                            method, path, text,
                        )
                        return {}

                # 4xx/5xx: 경고 + None
                logger.warning(
                    "[DeskRPG] HTTP {} {} -> {}: {}",
                    method, path, status, text,
                )
                return None

        except asyncio.TimeoutError:
            logger.warning(
                "[DeskRPG] Timeout {} {} (after {}s)",
                method, path, timeout,
            )
            return None
        except aiohttp.ClientError as e:
            logger.warning(
                "[DeskRPG] Client error {} {}: {}",
                method, path, e,
            )
            return None
        except Exception as e:
            logger.warning(
                "[DeskRPG] Request failed {} {}: {}",
                method, path, e,
            )
            return None
