import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels } from "@/db";
import { eq } from "drizzle-orm";
import { internalRpc, getUserId } from "@/lib/internal-rpc";
import {
  buildGatewayAgentFiles,
  getDefaultMeetingProtocol,
  hasNpcPresetDefaults,
  localizeNpcPromptDocument,
} from "@/lib/npc-agent-defaults";
import { normalizeLocale } from "@/lib/i18n/server";
import { buildGatewayErrorPayload, getGatewayErrorStatus } from "@/lib/openclaw-gateway.js";
import { isNanobotProvider } from "@/lib/nanobot-api-client";
import { writeNanobotAgentFiles } from "@/lib/nanobot-agent-lifecycle";
import { buildAgentsFileContent } from "@/lib/nanobot-workspace-content";

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ errorCode: "unauthorized", error: "Unauthorized" }, { status: 401 });

    const { channelId, agentId, identity, soul, presetId, npcName, locale } = await req.json();
    const normalizedLocale = normalizeLocale(locale);

    if (!channelId || !agentId?.trim()) {
      return NextResponse.json(
        { errorCode: "missing_channel_or_agent_id", error: "Missing channelId or agentId" },
        { status: 400 },
      );
    }

    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel) {
      return NextResponse.json(
        { errorCode: "channel_not_found", error: "Channel not found" },
        { status: 404 },
      );
    }
    if (channel.ownerId !== userId) {
      return NextResponse.json({ errorCode: "forbidden", error: "Not authorized" }, { status: 403 });
    }

    if (presetId && !hasNpcPresetDefaults(presetId)) {
      return NextResponse.json(
        { errorCode: "unknown_preset_id", error: `Unknown presetId: ${presetId}` },
        { status: 400 },
      );
    }

    // seed-v10 옵션 B1: nanobot이 BOOTSTRAP_FILES로 자동 read하는 AGENTS.md / SOUL.md에
    // identity + meetingProtocol을 통합. openclaw legacy 경로(아래 else)는 동일 files를
    // 받지만 deprecated path라 IDENTITY.md 별도 보존은 의도적으로 생략.
    const files = hasNpcPresetDefaults(presetId)
      ? buildGatewayAgentFiles({
          presetId,
          npcName: npcName?.trim() || "NPC",
          locale: normalizedLocale,
          identityOverride: identity?.trim(),
          soulOverride: soul?.trim(),
        })
      : [
          {
            name: "AGENTS.md" as const,
            content: buildAgentsFileContent(
              identity?.trim()
                ? localizeNpcPromptDocument(identity.trim(), normalizedLocale, "identity")
                : null,
              getDefaultMeetingProtocol(normalizedLocale),
            ),
          },
          ...(soul?.trim() ? [{
            name: "SOUL.md" as const,
            content: localizeNpcPromptDocument(soul.trim(), normalizedLocale, "soul"),
          }] : []),
        ];

    // seed-v9 D-22 / seed-v10 옵션 B1: persona의 source of truth는 DB npcs.openclawConfig.
    // nanobot mode (default): agents.create RPC는 no-op (stateless). AGENTS.md/SOUL.md를
    //   ~/.nanobot/workspace-${agentId}/에 작성 — nanobot agent loop의 BOOTSTRAP_FILES가
    //   system prompt로 자동 load (read-side는 nanobot 담당).
    // openclaw mode (deprecated): agents.create + agents.files.set RPC로 워크스페이스 동기화.
    if (isNanobotProvider()) {
      await writeNanobotAgentFiles(agentId.trim(), files);
    } else {
      await internalRpc(channelId, "agents.create", {
        name: agentId.trim(),
        workspace: `~/.openclaw/workspace-${agentId.trim()}`,
      });

      for (const file of files) {
        await internalRpc(channelId, "agents.files.set", {
          agentId: agentId.trim(),
          name: file.name,
          content: file.content,
        });
      }
    }

    return NextResponse.json({ success: true, agentId: agentId.trim(), files: files.map((file) => file.name) });
  } catch (err) {
    console.error("Failed to create agent:", err);
    return NextResponse.json(
      buildGatewayErrorPayload(err, {
        fallbackErrorCode: "failed_to_create_agent",
        fallbackError: "Failed to create agent",
      }),
      { status: getGatewayErrorStatus(err, 502) },
    );
  }
}
