"""Tool to push a markdown report to DeskRPG ReportPanel.

Registered in subagent tool registry so subagents can push reports
without exec() workarounds — the tool call handles auth and HTTP
internally via DeskRPGClient.
"""

from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.schema import StringSchema, tool_parameters_schema
from nanobot.utils.deskrpg_client import DeskRPGClient


@tool_parameters(
    tool_parameters_schema(
        channel_id=StringSchema("DeskRPG channel UUID"),
        npc_id=StringSchema("DeskRPG parent NPC UUID (parent_npc_uuid, NOT subagent's own npc_id)"),
        character_id=StringSchema("DeskRPG character UUID"),
        body_markdown=StringSchema("Full markdown report body"),
        title=StringSchema("Optional report title (default: empty)", nullable=True),
        creator_sub_agent_label=StringSchema("Optional label identifying the creator agent", nullable=True),
        required=["channel_id", "npc_id", "character_id", "body_markdown"],
    )
)
class PushReportTool(Tool):
    """Push a markdown report to DeskRPG ReportPanel.

    Uses DeskRPGClient internally — auth (INTERNAL_RPC_SECRET) and base URL
    are read from environment variables automatically.  No exec() needed.
    """

    name = "push_report"
    description = (
        "Push a formatted markdown report to the DeskRPG ReportPanel. "
        "The report appears as a clickable card in the parent NPC chat and opens in a slide-in panel. "
        "Requires channel_id, npc_id (parent_npc_uuid), character_id, and body_markdown."
    )

    async def execute(
        self,
        channel_id: str,
        npc_id: str,
        character_id: str,
        body_markdown: str,
        title: str | None = None,
        creator_sub_agent_label: str | None = None,
    ) -> str:
        dc = DeskRPGClient()
        result = await dc.create_report(
            channel_id=channel_id,
            npc_id=npc_id,
            character_id=character_id,
            body_markdown=body_markdown,
            title=title,
            creator_sub_agent_label=creator_sub_agent_label,
            metadata={"source": "subagent", "skill": "report-composer"},
        )
        if result:
            rid = result.get("persisted_report_id", "unknown")
            return f"Report pushed successfully. persisted_report_id: {rid}"
        return (
            "Error: Report push failed. Check INTERNAL_RPC_SECRET env var "
            "and that npc_id is the parent_npc_uuid (not your own temp npc_id)."
        )
