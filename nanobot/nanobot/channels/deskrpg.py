"""DeskRPG sync channel — translates OutboundMessage into DeskRPG HTTP API calls.

This channel is outbound-only: it never polls for inbound messages.
All sync logic (NPC create/delete, task lifecycle, chat-push) is triggered
by ``OutboundMessage`` metadata dispatched from ``SubagentManager`` via the bus.

Channel auto-discovery
----------------------
``registry.py`` scans ``nanobot.channels`` with ``pkgutil.iter_modules``,
so placing this file in ``nanobot/channels/`` is sufficient — no manual
registration required.

Enable via ``~/.nanobot/config.json``::

    {"channels": {"deskrpg": {"enabled": true}}}
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from nanobot.bus.events import OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel
from nanobot.utils.deskrpg_client import DeskRPGClient

# ── session_key construction helper ──────────────────────────────────────


def _build_chat_push_session_key(
    channel_id: str,
    parent_agent_id: str,
    owner_user_id: str,
) -> str:
    """Construct the DeskRPG chat-push session key format.

    Format: ``api:ot-{channel_short}-{parent_agent_id}-dm-{owner_short}``
    """
    ch = channel_id.split("-")[0] if "-" in channel_id else channel_id[:8]
    ow = owner_user_id.split("-")[0] if "-" in owner_user_id else owner_user_id[:8]
    return f"api:ot-{ch}-{parent_agent_id}-dm-{ow}"


_DESKRPG_SYNC_TYPES = frozenset({
    "npc_create",
    "npc_delete",
    "task_create",
    "task_update",
    "task_complete",
    "task_cancel",
    "chat_push",
})


class DeskRPGChannel(BaseChannel):
    """Outbound-only channel that syncs subagent events to DeskRPG."""

    name = "deskrpg"
    display_name = "DeskRPG"
    send_progress = False
    send_tool_hints = False

    def __init__(self, config: Any, bus: MessageBus) -> None:
        super().__init__(config, bus)
        self.client = DeskRPGClient()

    # ── BaseChannel interface ──────────────────────────────────────────

    async def start(self) -> None:
        """No inbound polling needed; mark ready."""
        self._running = True
        self.logger.info("DeskRPG sync channel ready")

    async def stop(self) -> None:
        self._running = False

    async def send(self, msg: OutboundMessage) -> None:
        """Translate OutboundMessage metadata into DeskRPG API calls.

        Relies on ``msg.metadata["deskrpg_sync_type"]`` to determine action.
        Silently skips messages without a recognised sync type.
        """
        sync_type: str | None = msg.metadata.get("deskrpg_sync_type")
        if not sync_type or sync_type not in _DESKRPG_SYNC_TYPES:
            return

        payload: dict = msg.metadata.get("deskrpg_payload", {})
        self.logger.info(
            "[DeskRPG Channel] send() called: sync_type={} npc_id={} channel_id={}",
            sync_type, payload.get("npc_id", "?"), payload.get("channel_id", "?"),
        )

        try:
            if sync_type == "npc_create":
                await self.client.create_npc(**payload)
            elif sync_type == "npc_delete":
                await self.client.delete_npc(payload["npc_id"])
            elif sync_type in ("task_create", "task_update", "task_complete", "task_cancel"):
                # Map sync type → DeskRPG action string
                action_map = {
                    "task_create": "create",
                    "task_update": "update",
                    "task_complete": "complete",
                    "task_cancel": "cancel",
                }
                status_map = {
                    "task_create": "in_progress",
                    "task_update": payload.get("status", "in_progress"),
                    "task_complete": "complete",
                    "task_cancel": "cancelled",
                }
                await self.client.push_task(
                    channel_id=payload["channel_id"],
                    npc_id=payload["npc_id"],
                    npc_task_id=payload["npc_task_id"],
                    title=payload.get("title", ""),
                    summary=payload.get("summary", ""),
                    status=status_map[sync_type],
                    action=action_map[sync_type],
                    assigner_character_id=payload.get("assigner_character_id"),
                    owner_user_id=payload.get("owner_user_id"),
                    metadata=payload.get("metadata"),
                )
            elif sync_type == "chat_push":
                await self.client.chat_push(
                    session_key=payload.get(
                        "session_key",
                        _build_chat_push_session_key(
                            payload.get("channel_id", ""),
                            payload.get("parent_agent_id", ""),
                            payload.get("owner_user_id", ""),
                        ),
                    ),
                    channel_id=payload["channel_id"],
                    npc_id=payload["npc_id"],
                    message=payload["message"],
                    kind=payload.get("kind", "subagent_push"),
                    subagent_id=payload.get("subagent_id"),
                    subagent_label=payload.get("subagent_label"),
                    task_npc_task_id=payload.get("task_npc_task_id"),
                    metadata=payload.get("metadata"),
                )
        except KeyError as e:
            self.logger.warning(
                "[DeskRPG] Missing required field {} for sync_type={}",
                e, sync_type,
            )
        except Exception:
            self.logger.exception(
                "[DeskRPG] Sync failed for sync_type={}", sync_type,
            )

    # ── Config ─────────────────────────────────────────────────────────

    @classmethod
    def default_config(cls) -> dict[str, Any]:
        return {"enabled": True}
