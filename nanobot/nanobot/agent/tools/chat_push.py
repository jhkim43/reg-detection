"""Tool to push a short progress message to parent NPC chat during sub-agent execution.

Different from push_report:
  - push_report  = full markdown report → ReportPanel slide-in (heavy, final output)
  - chat_push    = short in-line chat message (light, intermediate progress)

Use chat_push between Steps in a long-running skill so the user sees
incremental progress instead of staring at silence.

Registered in subagent tool registry alongside push_report.
"""

from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.schema import StringSchema, tool_parameters_schema
from nanobot.utils.deskrpg_client import DeskRPGClient


@tool_parameters(
    tool_parameters_schema(
        channel_id=StringSchema("DeskRPG channel UUID"),
        npc_id=StringSchema(
            "DeskRPG parent NPC UUID (parent_npc_uuid, NOT subagent's own npc_id)"
        ),
        message=StringSchema(
            "Short progress message in Korean. Recommended: emoji prefix + role tag. "
            "Examples: '🕷 [크롤러] 4 발행처 7건 수집 완료', "
            "'🔄 [변환] PDF→MD 24건 변환', '🔍 [분석] 분류 + 매칭 18건'"
        ),
        subagent_label=StringSchema(
            "Persona role label (e.g., '크롤러', '변환', '분석', '판정', '영향도'). "
            "Optional but recommended for UI grouping.",
            nullable=True,
        ),
        required=["channel_id", "npc_id", "message"],
    )
)
class ChatPushTool(Tool):
    """Push a short progress message to the parent NPC chat.

    Uses DeskRPGClient.chat_push internally — auth (INTERNAL_RPC_SECRET) and base
    URL are read from environment variables automatically.

    Use this between Steps in a long-running skill to keep the user informed of
    incremental progress. For the final result, use push_report instead.
    """

    name = "chat_push"
    description = (
        "Push a short in-line progress message to the parent NPC chat. "
        "Use between Steps in a long-running skill (crawl→convert→analyze→…) "
        "so the user sees incremental progress, not silence. "
        "Different from push_report — this is a chat message, not a slide-in panel. "
        "npc_id MUST be parent_npc_uuid (not your own temp subagent npc_id)."
    )

    async def execute(
        self,
        channel_id: str,
        npc_id: str,
        message: str,
        subagent_label: str | None = None,
    ) -> str:
        dc = DeskRPGClient()
        # deskrpg가 sessionKey를 required로 강제하므로 (chat-push handler validation),
        # subagent label 기반 placeholder를 보냄. 본질적으로 chat_push는 channel/npc
        # 기반 라우팅이라 session_key는 식별·로깅용으로만 쓰임.
        result = await dc.chat_push(
            session_key=f"subagent:{subagent_label or 'unknown'}",
            channel_id=channel_id,
            npc_id=npc_id,
            message=message,
            kind="subagent_push",
            subagent_label=subagent_label,
            metadata={"source": "subagent", "kind": "progress"},
        )
        if result:
            mid = result.get("persisted_message_id", "unknown")
            return f"Chat message pushed. persisted_message_id: {mid}"
        return (
            "Error: chat_push failed. Check INTERNAL_RPC_SECRET env var "
            "and that npc_id is the parent_npc_uuid (not your own temp npc_id)."
        )
