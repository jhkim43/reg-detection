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
import { buildAgentsFileContent } from "./nanobot-workspace-content";

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

export type NpcEmit = (channelId: string, event: "npc:added" | "npc:removed", payload: unknown) => void | Promise<void>;

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

async function findParentAndOccupied(
  dbHandle: typeof defaultDb,
  channelId: string,
  parentAgentId: string,
): Promise<{
  parent: { id: string; positionX: number; positionY: number } | null;
  occupied: Set<string>;
}> {
  // openclawConfig.agentId == parentAgentId — JSON column이라 application filter.
  // 같은 query에서 channel의 모든 NPC 위치도 함께 추출 (자동 spatial 배치용).
  const rows = await dbHandle
    .select({
      id: npcs.id,
      positionX: npcs.positionX,
      positionY: npcs.positionY,
      openclawConfig: npcs.openclawConfig,
    })
    .from(npcs)
    .where(eq(npcs.channelId, channelId));

  let parent: { id: string; positionX: number; positionY: number } | null = null;
  const occupied = new Set<string>();
  for (const row of rows) {
    occupied.add(`${row.positionX},${row.positionY}`);
    if (!parent) {
      const cfg = parseOpenClawConfig(row.openclawConfig);
      if (cfg.agentId === parentAgentId) {
        parent = { id: row.id, positionX: row.positionX, positionY: row.positionY };
      }
    }
  }
  return { parent, occupied };
}

/**
 * parent 중심으로 빈 자리를 우선순위 순서대로 탐색. 첫 후보(`parent.x+1, parent.y`)는
 * 기존 default와 동일해 단일 spawn 시 UX 변화 없음. 충돌 시 좌/상/하 → 대각선 → radius 2/3
 * 순으로 fallback. 모두 점령되어 있으면 null → 호출자가 explicit 409 반환.
 */
const POSITION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  // radius 1 — parent 인접 (오른쪽 우선 = 기존 default 호환)
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
  // radius 2
  [2, 0], [-2, 0], [0, 2], [0, -2],
  [2, 1], [2, -1], [-2, 1], [-2, -1],
  [1, 2], [1, -2], [-1, 2], [-1, -2],
  [2, 2], [2, -2], [-2, 2], [-2, -2],
  // radius 3
  [3, 0], [-3, 0], [0, 3], [0, -3],
  [3, 1], [3, -1], [-3, 1], [-3, -1],
  [1, 3], [1, -3], [-1, 3], [-1, -3],
  [3, 2], [3, -2], [-3, 2], [-3, -2],
  [2, 3], [2, -3], [-2, 3], [-2, -3],
  [3, 3], [3, -3], [-3, 3], [-3, -3],
];

function nextAvailablePosition(
  occupied: Set<string>,
  centerX: number,
  centerY: number,
): { x: number; y: number } | null {
  for (const [dx, dy] of POSITION_OFFSETS) {
    const x = centerX + dx;
    const y = centerY + dy;
    if (x < 0 || y < 0) continue;
    if (!occupied.has(`${x},${y}`)) return { x, y };
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

  const { parent, occupied } = await findParentAndOccupied(dbHandle, input.channelId, input.parentAgentId);
  if (!parent) return { ok: false, statusCode: 404, errorCode: "parent_npc_not_found" };

  // 자동 spatial 배치: 사용자가 명시한 positionX/Y는 그대로(occupied여도 insert 시 catch가
  // 409로 응답). 미명시 시 parent 중심 spiral 탐색으로 빈 자리 자동 선택. radius 4까지 다
  // 막혀 있으면 명시적 409.
  let positionX: number;
  let positionY: number;
  if (typeof input.positionX === "number" && typeof input.positionY === "number") {
    positionX = input.positionX;
    positionY = input.positionY;
  } else {
    const slot = nextAvailablePosition(occupied, parent.positionX, parent.positionY);
    if (!slot) return { ok: false, statusCode: 409, errorCode: "position_conflict" };
    positionX = slot.x;
    positionY = slot.y;
  }
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
    // Drizzle Error.toString()은 "Error: Failed query: insert into ..." 형태라 unique 정보가
    // 없음. 실제 constraint 이름은 err.cause.constraint("npcs_channel_position_unique") 또는
    // err.cause.code/message에 있어 함께 검사. (Phase 3 검증 중 500 internal_error 발견 후 fix)
    const errStr = String(err) + " " + String((err as { cause?: unknown })?.cause ?? "");
    if (errStr.match(/unique|UNIQUE|duplicate key/i)) {
      return { ok: false, statusCode: 409, errorCode: "position_conflict" };
    }
    throw err;
  }

  try {
    // seed-v10 옵션 B1: identity는 AGENTS.md의 # Identity 섹션으로 흡수.
    // sub-agent는 meetingProtocol을 별도 지정받지 않으므로 identity만 들어감.
    const files: AgentFile[] = [
      { name: "AGENTS.md", content: buildAgentsFileContent(input.identity, null) },
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
    // GameScene NpcSprite가 layers + bodyType 기반으로 sprite composite. 누락 시
    // 파란 fallback Rectangle로 렌더되므로 raw appearance(input)를 그대로 emit.
    appearance,
    positionX: inserted.positionX,
    positionY: inserted.positionY,
    direction: inserted.direction ?? "down",
  };

  // emit payload는 GameScene이 listen하는 NpcData 형식 (단일 객체).
  await safeEmit(deps.emit, input.channelId, "npc:added", npcSummary);

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

  await safeEmit(deps.emit, target.channelId, "npc:removed", { npcId });

  return { ok: true, statusCode: 200, deletedCount };
}

async function safeEmit(
  emit: NpcEmit,
  channelId: string,
  event: "npc:added" | "npc:removed",
  payload: unknown,
): Promise<void> {
  try {
    await emit(channelId, event, payload);
  } catch (err) {
    console.warn(`[internal-npc-handler] socket emit ${event} failed:`, err);
  }
}

