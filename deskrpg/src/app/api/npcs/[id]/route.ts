import { NextRequest, NextResponse } from "next/server";
import { db, isPostgres, jsonForDb } from "@/db";
import { npcs, channels } from "@/db";
import { eq } from "drizzle-orm";
import { internalRpc, getUserId } from "@/lib/internal-rpc";
import {
  buildGatewayAgentFiles,
  buildPersonaConfig,
  getDefaultMeetingProtocol,
  getNpcPresetDefaults,
  hasNpcPresetDefaults,
  localizeNpcPromptDocument,
} from "@/lib/npc-agent-defaults";
import { normalizeLocale } from "@/lib/i18n/server";
import { deleteNanobotAgentWorkspace, setAgentFiles, writeNanobotAgentFiles } from "@/lib/nanobot-agent-lifecycle";
import { buildAgentsFileContent } from "@/lib/nanobot-workspace-content";
import { parseDbJson, parseDbObject } from "@/lib/db-json";
import { isNanobotProvider } from "@/lib/nanobot-api-client";

async function verifyNpcOwnership(req: NextRequest, npcId: string) {
  const userId = getUserId(req);
  if (!userId) return { errorCode: "unauthorized", error: "Unauthorized", status: 401 };

  const [npc] = await db.select().from(npcs).where(eq(npcs.id, npcId));
  if (!npc) return { errorCode: "npc_not_found", error: "NPC not found", status: 404 };

  const [channel] = await db.select().from(channels).where(eq(channels.id, npc.channelId));
  if (!channel || channel.ownerId !== userId) {
    return { errorCode: "only_channel_owner_can_modify_npcs", error: "Only channel owner can modify NPCs", status: 403 };
  }

  return { npc, channel, userId };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await verifyNpcOwnership(req, id);
    if ("error" in result) {
      return NextResponse.json({ errorCode: result.errorCode, error: result.error }, { status: result.status });
    }

    const { npc } = result;
    const body = await req.json();
    const updates: Record<string, unknown> = { updatedAt: (isPostgres ? new Date() : new Date().toISOString()) as unknown as Date };
    const nextName = body.name?.trim() || npc.name;
    const normalizedLocale = normalizeLocale(body.locale);

    if (body.name?.trim()) updates.name = body.name.trim().slice(0, 100);
    if (body.appearance) updates.appearance = jsonForDb(body.appearance);
    if (typeof body.direction === "string") {
      updates.direction = ["up", "down", "left", "right"].includes(body.direction) ? body.direction : "down";
    }
    if (body.presetId && !hasNpcPresetDefaults(body.presetId)) {
      return NextResponse.json({ errorCode: "unknown_preset_id", error: `Unknown presetId: ${body.presetId}` }, { status: 400 });
    }

    // Handle persona/identity/soul updates
    const existingConfig = parseDbObject(npc.openclawConfig) || {};
    const existingAgentId = existingConfig.agentId as string | null;
    const presetDefaults = hasNpcPresetDefaults(body.presetId)
      ? getNpcPresetDefaults({ presetId: body.presetId, npcName: nextName, locale: normalizedLocale })
      : null;
    const resolvedIdentity = body.identity?.trim() ?? body.persona?.trim() ?? presetDefaults?.identity ?? "";
    const resolvedSoul = body.soul?.trim() ?? presetDefaults?.soul ?? "";

    // Handle agent connection change
    if (body.agentAction === "select" && body.agentId) {
      updates.openclawConfig = {
        ...existingConfig,
        agentId: body.agentId,
        sessionKeyPrefix: `ot-${id.slice(0, 8)}-${body.agentId}`,
      };
    } else if (body.agentAction === "create" && body.agentId) {
      // seed-v9 D-22: nanobot mode는 agents.create RPC no-op + DB persona가 source of truth.
      // 단 .md write-only mirror는 작성 (T-012). openclaw mode는 RPC + 워크스페이스 동기화.
      if (!isNanobotProvider()) {
        await internalRpc(npc.channelId, "agents.create", {
          name: body.agentId,
          workspace: `~/.openclaw/workspace-${body.agentId}`,
        });
      }

      // seed-v10 옵션 B1: identity + meetingProtocol을 AGENTS.md 한 파일에 흡수.
      const files = hasNpcPresetDefaults(body.presetId)
        ? buildGatewayAgentFiles({
            presetId: body.presetId,
            npcName: nextName,
            locale: normalizedLocale,
            identityOverride: body.identity?.trim(),
            soulOverride: body.soul?.trim(),
            fallbackPersona: body.persona?.trim(),
          })
        : [
            {
              name: "AGENTS.md" as const,
              content: buildAgentsFileContent(
                body.identity?.trim()
                  ? localizeNpcPromptDocument(body.identity.trim(), normalizedLocale, "identity")
                  : null,
                getDefaultMeetingProtocol(normalizedLocale),
              ),
            },
            ...(body.soul?.trim() ? [{
              name: "SOUL.md" as const,
              content: localizeNpcPromptDocument(body.soul.trim(), normalizedLocale, "soul"),
            }] : []),
          ];

      if (isNanobotProvider()) {
        await writeNanobotAgentFiles(body.agentId, files);
      } else {
        for (const file of files) {
          await internalRpc(npc.channelId, "agents.files.set", {
            agentId: body.agentId,
            name: file.name,
            content: file.content,
          });
        }
      }

      const personaConfig = hasNpcPresetDefaults(body.presetId)
        ? buildPersonaConfig({
            presetId: body.presetId,
            npcName: nextName,
            locale: normalizedLocale,
            identityOverride: body.identity?.trim(),
            soulOverride: body.soul?.trim(),
            fallbackPersona: body.persona?.trim(),
          })
        : {
            identity: localizeNpcPromptDocument(body.identity?.trim() || "", normalizedLocale, "identity"),
            soul: localizeNpcPromptDocument(body.soul?.trim() || "", normalizedLocale, "soul"),
          };

      updates.openclawConfig = {
        ...existingConfig,
        agentId: body.agentId,
        sessionKeyPrefix: `ot-${id.slice(0, 8)}-${body.agentId}`,
        personaConfig,
        locale: normalizedLocale,
      };
    }

    if (body.passPolicy !== undefined) {
      const currentConfig = (updates.openclawConfig as Record<string, unknown>) || existingConfig;
      updates.openclawConfig = {
        ...currentConfig,
        passPolicy: body.passPolicy?.trim() || null,
        locale: normalizedLocale,
      };

      // Also write to IDENTITY.md if agent exists (OpenClaw only — nanobot rebuilds prompt per call).
      if (!isNanobotProvider() && existingAgentId && body.passPolicy?.trim()) {
        try {
          let identityContent = "";
          try {
            const currentIdentity = await internalRpc(npc.channelId, "agents.files.get", {
              agentId: existingAgentId, name: "IDENTITY.md",
            });
            identityContent = (currentIdentity as { content?: string })?.content || "";
          } catch { /* file may not exist yet */ }

          const sectionHeader = "## 회의 행동 가이드";
          const newSection = `${sectionHeader}\n${body.passPolicy.trim()}`;
          const updated = identityContent.includes(sectionHeader)
            ? identityContent.replace(/## 회의 행동 가이드[\s\S]*?(?=\n## |$)/, newSection)
            : identityContent + "\n\n" + newSection;

          await internalRpc(npc.channelId, "agents.files.set", {
            agentId: existingAgentId, name: "IDENTITY.md", content: updated,
          });
        } catch (err) {
          console.warn("Failed to update IDENTITY.md with pass policy:", err);
        }
      }
    }

    if (
      body.identity !== undefined ||
      body.soul !== undefined ||
      body.persona !== undefined ||
      body.locale !== undefined ||
      body.presetId !== undefined
    ) {
      const newIdentity = resolvedIdentity;
      const newSoul = resolvedSoul;
      const personaConfig = hasNpcPresetDefaults(body.presetId)
        ? buildPersonaConfig({
            presetId: body.presetId,
            npcName: nextName,
            locale: normalizedLocale,
            identityOverride: body.identity?.trim(),
            soulOverride: body.soul?.trim(),
            fallbackPersona: body.persona?.trim(),
          })
        : {
            identity: localizeNpcPromptDocument(newIdentity, normalizedLocale, "identity"),
            soul: localizeNpcPromptDocument(newSoul, normalizedLocale, "soul"),
          };

      // If NPC has an agent and identity/soul changed, update on gateway.
      // - openclaw mode: RPC agents.files.set (gateway side mounts the persona).
      // - nanobot mode (T-028, AC-015): DB가 SoT (D-22)이므로 RPC는 no-op. 다만
      //   ~/.nanobot/workspace-${agentId}/{IDENTITY,SOUL,AGENTS}.md를 write-only
      //   mirror로 갱신해 디버깅·tail 가능하게 유지.
      const meetingProtocol = hasNpcPresetDefaults(body.presetId)
        ? getNpcPresetDefaults({
            presetId: body.presetId,
            npcName: nextName,
            locale: normalizedLocale,
          }).meetingProtocol
        : getDefaultMeetingProtocol(normalizedLocale);

      if (existingAgentId) {
        if (isNanobotProvider()) {
          try {
            await setAgentFiles(existingAgentId, {
              identity: personaConfig.identity || undefined,
              soul: personaConfig.soul || undefined,
              meetingProtocol,
            });
          } catch (err) {
            console.warn("Failed to write nanobot persona mirror files:", err);
          }
        } else {
          try {
            if (personaConfig.identity) {
              await internalRpc(npc.channelId, "agents.files.set", {
                agentId: existingAgentId,
                name: "IDENTITY.md",
                content: personaConfig.identity,
              });
            }
            if (personaConfig.soul) {
              await internalRpc(npc.channelId, "agents.files.set", {
                agentId: existingAgentId,
                name: "SOUL.md",
                content: personaConfig.soul,
              });
            }
            await internalRpc(npc.channelId, "agents.files.set", {
              agentId: existingAgentId,
              name: "AGENTS.md",
              content: meetingProtocol,
            });
          } catch (err) {
            console.warn("Failed to update persona files on gateway:", err);
          }
        }
      }

      // Update openclawConfig in DB
      updates.openclawConfig = {
        ...existingConfig,
        persona: newIdentity.slice(0, 500), // backward compat
        personaConfig,
        locale: normalizedLocale,
        meetingProtocol: hasNpcPresetDefaults(body.presetId)
          ? getNpcPresetDefaults({
              presetId: body.presetId,
              npcName: nextName,
              locale: normalizedLocale,
            }).meetingProtocol
          : getDefaultMeetingProtocol(normalizedLocale),
      };
    }

    if (updates.openclawConfig !== undefined) {
      updates.openclawConfig = jsonForDb(updates.openclawConfig);
    }

    const [updated] = await db.update(npcs).set(updates).where(eq(npcs.id, id)).returning();
    return NextResponse.json({
      npc: {
        ...updated,
        appearance: parseDbJson(updated.appearance) ?? updated.appearance,
        openclawConfig: parseDbObject(updated.openclawConfig) ?? updated.openclawConfig,
      },
    });
  } catch (err) {
    console.error("Failed to update NPC:", err);
    return NextResponse.json({ errorCode: "failed_to_update_npc", error: "Failed to update NPC" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await verifyNpcOwnership(req, id);
    if ("error" in result) {
      return NextResponse.json({ errorCode: result.errorCode, error: result.error }, { status: result.status });
    }

    const { npc } = result;

    // If NPC has an agent, clean up workspace + remote gateway state.
    const openclawConfig = parseDbObject(npc.openclawConfig);
    const agentId = openclawConfig?.agentId as string | null;

    if (agentId) {
      if (isNanobotProvider()) {
        // seed-v9 T-013: nanobot mode는 RPC 없이 워크스페이스 디렉토리 cleanup만.
        // (DB의 npcs row 삭제는 아래에서 cascade로 처리)
        try {
          await deleteNanobotAgentWorkspace(agentId);
        } catch (err) {
          console.warn(`Failed to cleanup nanobot workspace for ${agentId} (proceeding with NPC deletion):`, err);
        }
      } else {
        try {
          await internalRpc(npc.channelId, "agents.delete", { agentId, deleteFiles: true });
        } catch (err) {
          console.warn(`Failed to remove agent ${agentId} from gateway (proceeding with NPC deletion):`, err);
        }
      }
    }

    await db.delete(npcs).where(eq(npcs.id, id));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete NPC:", err);
    return NextResponse.json({ errorCode: "failed_to_delete_npc", error: "Failed to delete NPC" }, { status: 500 });
  }
}
