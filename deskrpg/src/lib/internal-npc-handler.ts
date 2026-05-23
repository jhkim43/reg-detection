// seed-v10 AC-002 / T-V11/T-V12 — Logic Layer: nanobot sub-agent lifecycle.
//
// spawnSubAgent: nanobot agent loop이 child sub-agent를 spawn할 때 npcs row 생성
//                + nanobot mirror 파일 작성 + socket broadcast.
// deleteNpcInternal: NPC 삭제 — application-layer cascade (parent_agent_id 트리),
//                    deskrpg mirror cleanup only (D-29: nanobot 측은 건드리지 않음).

import { eq, and } from "drizzle-orm";
import { db as defaultDb, channels, npcs, jsonForDb } from "@/db";
import {
  writeNanobotAgentFiles as defaultWriteFiles,
  deleteNanobotAgentWorkspace as defaultDeleteWorkspace,
  type AgentFile,
} from "./nanobot-agent-lifecycle";

export type SpawnSubAgentInput = {
  ownerUserId: string;
  channelId: string;
  name: string;
  agentId: string;            // nanobot이 발급
  parentAgentId: string;       // parent NPC의 openclawConfig.agentId
  identity: string;
  soul: string;
  appearance?: Record<string, unknown>;
  positionX?: number;
  positionY?: number;
  locale?: "ko" | "en" | "ja" | "zh";
};

export type SpawnSubAgentOk = {
  ok: true;
  statusCode: 201;
  npc: {
    id: string;
    name: string;
    parentAgentId: string;
    openclawConfig: {
      agentId: string;
      sessionKeyPrefix: string;
      personaConfig: { identity: string; soul: string };
      locale: string;
    };
    positionX: number;
    positionY: number;
    direction: string;
  };
};

export type NpcHandlerErr = {
  ok: false;
  statusCode: 400 | 403 | 404 | 409 | 500;
  errorCode:
    | "missing_required_field"
    | "forbidden_channel"
    | "channel_not_found"
    | "parent_npc_not_found"
    | "npc_not_found"
    | "position_conflict"
    | "internal_error";
  field?: string;
};

export type SpawnSubAgentResult = SpawnSubAgentOk | NpcHandlerErr;

export type DeleteNpcOk = { ok: true; statusCode: 200; deletedCount: number };
export type DeleteNpcResult = DeleteNpcOk | NpcHandlerErr;

export type NpcEmit = (channelId: string, event: "npc:spawned" | "npc:deleted", payload: unknown) => void | Promise<void>;

export type NpcHandlerDeps = {
  emit: NpcEmit;
  db?: typeof defaultDb;
  writeFiles?: typeof defaultWriteFiles;
  deleteWorkspace?: typeof defaultDeleteWorkspace;
};

const REQUIRED_SPAWN_FIELDS: Array<keyof SpawnSubAgentInput> = [
  "ownerUserId",
  "channelId",
  "name",
  "agentId",
  "parentAgentId",
  "identity",
  "soul",
];

function validateSpawn(input: SpawnSubAgentInput): NpcHandlerErr | null {
  for (const field of REQUIRED_SPAWN_FIELDS) {
    const value = input[field];
    if (value == null || (typeof value === "string" && value.trim() === "")) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: "missing_required_field",
        field: String(field),
      };
    }
  }
  return null;
}

type OpenClawConfig = {
  agentId?: string;
  sessionKeyPrefix?: string;
  personaConfig?: { identity?: string; soul?: string };
  locale?: string;
};

function parseOpenClawConfig(raw: unknown): OpenClawConfig {
  if (raw && typeof raw === "object") return raw as OpenClawConfig;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as OpenClawConfig;
    } catch {
      return {};
    }
  }
  return {};
}

async function findParentNpc(
  dbHandle: typeof defaultDb,
  channelId: string,
  parentAgentId: string,
): Promise<{ id: string; positionX: number; positionY: number } | null> {
  // openclawConfig.agentId == parentAgentId — JSON column이라 application filter.
  const rows = await dbHandle
    .select({
      id: npcs.id,
      positionX: npcs.positionX,
      positionY: npcs.positionY,
      openclawConfig: npcs.openclawConfig,
    })
    .from(npcs)
    .where(eq(npcs.channelId, channelId));

  for (const row of rows) {
    const cfg = parseOpenClawConfig(row.openclawConfig);
    if (cfg.agentId === parentAgentId) {
      return { id: row.id, positionX: row.positionX, positionY: row.positionY };
    }
  }
  return null;
}

export async function spawnSubAgent(
  input: SpawnSubAgentInput,
  deps: NpcHandlerDeps,
): Promise<SpawnSubAgentResult> {
  const validation = validateSpawn(input);
  if (validation) return validation;

  const dbHandle = deps.db ?? defaultDb;
  const writeFiles = deps.writeFiles ?? defaultWriteFiles;

  const [channel] = await dbHandle
    .select({ id: channels.id, ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, input.channelId))
    .limit(1);
  if (!channel) return { ok: false, statusCode: 404, errorCode: "channel_not_found" };
  if (channel.ownerId !== input.ownerUserId) {
    return { ok: false, statusCode: 403, errorCode: "forbidden_channel" };
  }

  const parent = await findParentNpc(dbHandle, input.channelId, input.parentAgentId);
  if (!parent) return { ok: false, statusCode: 404, errorCode: "parent_npc_not_found" };

  // Position default: parent NPC 옆 (+1, +0). Phase 6 디자인 시 collision 회피 로직 추가.
  const positionX = typeof input.positionX === "number" ? input.positionX : parent.positionX + 1;
  const positionY = typeof input.positionY === "number" ? input.positionY : parent.positionY;
  const locale = input.locale ?? "ko";

  const openclawConfig = {
    agentId: input.agentId,
    sessionKeyPrefix: `sub-${input.agentId}`,
    personaConfig: { identity: input.identity, soul: input.soul },
    locale,
  };
  const appearance = input.appearance ?? {};

  let inserted: { id: string; name: string; positionX: number; positionY: number; direction: string | null };
  try {
    const [row] = await dbHandle
      .insert(npcs)
      .values({
        channelId: input.channelId,
        name: input.name,
        positionX,
        positionY,
        appearance: jsonForDb(appearance) as never,
        openclawConfig: jsonForDb(openclawConfig) as never,
        parentAgentId: input.parentAgentId,
      })
      .returning({
        id: npcs.id,
        name: npcs.name,
        positionX: npcs.positionX,
        positionY: npcs.positionY,
        direction: npcs.direction,
      });
    inserted = row;
  } catch (err) {
    if (String(err).match(/unique|UNIQUE/)) {
      return { ok: false, statusCode: 409, errorCode: "position_conflict" };
    }
    throw err;
  }

  try {
    const files: AgentFile[] = [
      { name: "IDENTITY.md", content: input.identity },
      { name: "SOUL.md", content: input.soul },
    ];
    await writeFiles(input.agentId, files);
  } catch (err) {
    console.warn("[internal-npc-handler] writeNanobotAgentFiles failed:", err);
  }

  const npcSummary = {
    id: inserted.id,
    name: inserted.name,
    parentAgentId: input.parentAgentId,
    openclawConfig,
    positionX: inserted.positionX,
    positionY: inserted.positionY,
    direction: inserted.direction ?? "down",
  };

  await safeEmit(deps.emit, input.channelId, "npc:spawned", { npc: npcSummary });

  return { ok: true, statusCode: 201, npc: npcSummary };
}

export async function deleteNpcInternal(
  npcId: string,
  deps: NpcHandlerDeps,
): Promise<DeleteNpcResult> {
  if (!npcId || npcId.trim() === "") {
    return { ok: false, statusCode: 400, errorCode: "missing_required_field", field: "npcId" };
  }

  const dbHandle = deps.db ?? defaultDb;
  const deleteWorkspace = deps.deleteWorkspace ?? defaultDeleteWorkspace;

  const [target] = await dbHandle
    .select({ id: npcs.id, channelId: npcs.channelId, openclawConfig: npcs.openclawConfig })
    .from(npcs)
    .where(eq(npcs.id, npcId))
    .limit(1);
  if (!target) return { ok: false, statusCode: 404, errorCode: "npc_not_found" };

  const cfg = parseOpenClawConfig(target.openclawConfig);
  const myAgentId = cfg.agentId;

  // application-layer cascade: 같은 channel에서 parent_agent_id == myAgentId 인 자식 재귀.
  let deletedCount = 0;
  if (myAgentId) {
    const children = await dbHandle
      .select({ id: npcs.id })
      .from(npcs)
      .where(and(eq(npcs.channelId, target.channelId), eq(npcs.parentAgentId, myAgentId)));
    for (const child of children) {
      const childResult = await deleteNpcInternal(child.id, deps);
      if (childResult.ok) deletedCount += childResult.deletedCount;
    }
  }

  await dbHandle.delete(npcs).where(eq(npcs.id, npcId));
  deletedCount += 1;

  if (myAgentId) {
    try {
      await deleteWorkspace(myAgentId);
    } catch (err) {
      console.warn("[internal-npc-handler] deleteNanobotAgentWorkspace failed:", err);
    }
  }

  await safeEmit(deps.emit, target.channelId, "npc:deleted", { npcId });

  return { ok: true, statusCode: 200, deletedCount };
}

async function safeEmit(
  emit: NpcEmit,
  channelId: string,
  event: "npc:spawned" | "npc:deleted",
  payload: unknown,
): Promise<void> {
  try {
    await emit(channelId, event, payload);
  } catch (err) {
    console.warn(`[internal-npc-handler] socket emit ${event} failed:`, err);
  }
}

