"""Pure HTTP client for DeskRPG internal API.

No nanobot dependencies — usable from any context (channels, tools, scripts).
All methods are best-effort: errors are logged, return None on failure.
"""

from __future__ import annotations

import json
import os
from typing import Any

from loguru import logger


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
        self.secret = secret or os.environ.get("INTERNAL_RPC_SECRET", "test-secret")

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
        }
        if assigner_character_id:
            payload["assignerCharacterId"] = assigner_character_id
        if owner_user_id:
            payload["ownerUserId"] = owner_user_id
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
        """Low-level HTTP request helper. Best-effort — returns None on failure."""
        import asyncio

        url = f"{self.base_url}{path}"
        headers = {
            "x-deskrpg-internal-secret": self.secret,
            "Content-Type": "application/json",
        }
        data = json.dumps(body).encode("utf-8") if body else None

        def _sync_request() -> tuple[int | None, str | None]:
            import urllib.error
            import urllib.request

            req = urllib.request.Request(
                url, data=data, headers=headers, method=method,
            )
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    resp_body = resp.read().decode("utf-8")
                    logger.info(
                        "[DeskRPG HTTP] {} {} -> {}",
                        method, path, resp.status,
                    )
                    return resp.status, resp_body
            except urllib.error.HTTPError as e:
                error_body = e.read().decode("utf-8", errors="replace")
                logger.warning(
                    "[DeskRPG] HTTP {} {} -> {}: {}",
                    method, path, e.code, error_body,
                )
                return e.code, None
            except Exception as e:
                logger.warning(
                    "[DeskRPG] Request failed {} {}: {}",
                    method, path, e,
                )
                return None, None

        status, text = await asyncio.to_thread(_sync_request)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                logger.warning("[DeskRPG] Non-JSON response {} {}: {}", method, path, text)
        if status and 200 <= status < 300:
            return {}
        return None
