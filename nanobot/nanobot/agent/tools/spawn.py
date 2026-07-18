"""Spawn tool for creating background subagents and syncing via DeskRPG channel."""

import asyncio
import re
import uuid
from contextvars import ContextVar
from typing import TYPE_CHECKING, Any

from loguru import logger

from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.schema import StringSchema, tool_parameters_schema
from nanobot.utils.deskrpg_client import DeskRPGClient

if TYPE_CHECKING:
    from nanobot.agent.subagent import SubagentManager


@tool_parameters(
    tool_parameters_schema(
        task=StringSchema("The task description for the subagent to handle contextually"),
        label=StringSchema("The display nickname/label for this NPC asset inside the virtual office"),
        identity=StringSchema("The core persona instruction, role or prompt guidance context"),
        soul=StringSchema("The psychological profile, behavioral boundaries, or unique background story"),
        required=["task", "label", "identity", "soul"],
    )
)
class SpawnTool(Tool):
    """Tool to spawn a subagent for background task execution with DeskRPG sync."""

    def __init__(self, manager: "SubagentManager"):
        self._manager = manager
        self._origin_channel: ContextVar[str] = ContextVar("spawn_origin_channel", default="cli")
        self._origin_chat_id: ContextVar[str] = ContextVar("spawn_origin_chat_id", default="direct")
        self._session_key: ContextVar[str] = ContextVar("spawn_session_key", default="cli:direct")
        self._origin_message_id: ContextVar[str | None] = ContextVar("spawn_origin_message_id", default=None)

        # DeskRPG routing metadata (injected from API request body)
        self._owner_user_id: ContextVar[str | None] = ContextVar("spawn_owner_user_id", default=None)
        self._channel_id: ContextVar[str | None] = ContextVar("spawn_channel_id", default=None)
        self._parent_agent_id: ContextVar[str | None] = ContextVar("spawn_parent_agent_id", default=None)
        self._character_id: ContextVar[str | None] = ContextVar("spawn_character_id", default=None)
        self._parent_npc_uuid: ContextVar[str | None] = ContextVar("spawn_parent_npc_uuid", default=None)

    def set_context(
        self,
        channel: str,
        chat_id: str,
        effective_key: str | None = None,
        owner_user_id: str | None = None,
        channel_id: str | None = None,
        parent_agent_id: str | None = None,
        character_id: str | None = None,
        parent_npc_uuid: str | None = None,
    ) -> None:
        """Store routing and DeskRPG metadata from the agent loop."""
        self._origin_channel.set(channel)
        self._origin_chat_id.set(chat_id)
        self._session_key.set(effective_key or f"{channel}:{chat_id}")
        self._owner_user_id.set(owner_user_id)
        self._channel_id.set(channel_id)
        self._parent_agent_id.set(parent_agent_id)
        self._character_id.set(character_id)
        self._parent_npc_uuid.set(parent_npc_uuid)

    def set_origin_message_id(self, message_id: str | None) -> None:
        self._origin_message_id.set(message_id)

    @property
    def name(self) -> str:
        return "spawn"

    @property
    def description(self) -> str:
        return (
            "MANDATORY: Use this tool IMMEDIATELY whenever the user explicitly asks to assign a task "
            "to a subagent, background agent, or requests a task to run 'independently' or 'in the background'. "
            "Spawning a subagent will offload complex jobs and visually register a new coworker NPC in DeskRPG. "
            "You MUST provide label, identity, and soul arguments based on the requested role."
        )

    async def execute(self, task: str, label: str, identity: str, soul: str, **kwargs: Any) -> str:
        """Create a subagent and sync its lifecycle to DeskRPG via the deskrpg channel."""
        running = self._manager.get_running_count()
        limit = self._manager.max_concurrent_subagents
        if running >= limit:
            return (
                f"Cannot spawn subagent: concurrency limit reached "
                f"({running}/{limit} running). Wait for a running subagent "
                f"to complete before spawning a new one."
            )

        # 1. Extract DeskRPG routing context
        owner_id = self._owner_user_id.get()
        parent_id = self._parent_agent_id.get()
        channel_uuid = self._channel_id.get() or self._origin_chat_id.get()
        parent_npc_uuid = self._parent_npc_uuid.get()
        has_deskrpg_context = bool(owner_id and parent_id and channel_uuid)

        # 2. Derive subagent_id before spawning (needed for DeskRPG NPC create)
        subagent_id = f"sub_{uuid.uuid4().hex[:8]}"

        # 3. If DeskRPG context is available, create NPC and push task_create
        npc_uuid: str | None = None
        if has_deskrpg_context:
            client = DeskRPGClient()
            npc_resp = await client.create_npc(
                owner_user_id=owner_id,
                channel_id=channel_uuid,
                name=label,
                agent_id=subagent_id,
                parent_agent_id=parent_id,
                identity=identity,
                soul=soul,
            )
            if npc_resp:
                npc_uuid = npc_resp.get("npc", {}).get("id")
                logger.info(
                    "[SpawnTool] DeskRPG NPC created: {} (agent_id={}, channel={})",
                    npc_uuid, subagent_id, channel_uuid,
                )

                # Push task_create via DeskRPGClient directly
                logger.info(
                    "[DeskRPG Spawn] task_create: npc={} agent_id={} label={}",
                    npc_uuid, subagent_id, label,
                )
                character_id_val = self._character_id.get()
                if not character_id_val:
                    logger.warning(
                        "[SpawnTool] Skipping task_create: character_id not available "
                        "(must send valid characters.id UUID in metadata.character_id)",
                    )
                else:
                    await client.push_task(
                        channel_id=channel_uuid,
                        npc_id=npc_uuid,
                        npc_task_id=subagent_id,
                        title=label,
                        summary=task[:200],
                        status="in_progress",
                        action="create",
                        assigner_character_id=character_id_val,
                        owner_user_id=owner_id,
                    )
            else:
                logger.warning("[SpawnTool] DeskRPG NPC creation failed for {}", label)

        # 4. Build deskrpg_meta for subagent lifecycle tracking
        deskrpg_meta: dict[str, Any] | None = None
        if has_deskrpg_context and npc_uuid:
            deskrpg_meta = {
                "channel_id": channel_uuid,
                "parent_agent_id": parent_id,
                "parent_npc_uuid": parent_npc_uuid or parent_id,  # deskrpg npcs.id UUID
                "npc_id": npc_uuid,
                "subagent_id": subagent_id,
                "owner_user_id": owner_id,
                "character_id": self._character_id.get() or "",
                "session_key": self._session_key.get(),
                "subagent_label": label,
            }

        # 5. Spawn the subagent
        result = await self._manager.spawn(
            task=task,
            label=label,
            origin_channel=self._origin_channel.get(),
            origin_chat_id=self._origin_chat_id.get(),
            session_key=self._session_key.get(),
            origin_message_id=self._origin_message_id.get(),
            deskrpg_meta=deskrpg_meta,
        )
        logger.info(
            "[SpawnTool] Spawned subagent: {} label={} npc={}",
            subagent_id, label, npc_uuid or "N/A",
        )

        if deskrpg_meta:
            return f"{result}\n[DeskRPG Sync] NPC '{label}' created and task synced."

        logger.warning(
            "[SpawnTool] Skipped DeskRPG sync: missing metadata "
            "(owner={}, parent={}, channel={})",
            owner_id, parent_id, channel_uuid,
        )
        return f"{result}\n[DeskRPG Sync] Skipped — no DeskRPG context available."
