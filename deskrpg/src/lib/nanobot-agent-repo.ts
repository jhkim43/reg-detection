// seed-v9 AC-013 T-014 — nanobot agent 목록 조회 (channel-scoped).
//
// nanobot mode는 npcs 테이블이 source of truth. 채널 단위로 NPC 목록 + agentId 반환.
// openclaw의 agents.list RPC와 functional parity.

import { eq } from "drizzle-orm";
import { db, npcs } from "@/db";

export type NanobotAgentSummary = {
  npcId: string;
  agentId: string;
  name: string;
  hasPersona: boolean;
};

type OpenClawConfig = {
  agentId?: string;
  sessionKeyPrefix?: string;
  personaConfig?: { identity?: string; soul?: string };
};

function parseConfig(raw: unknown): OpenClawConfig {
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

/**
 * 채널 내 모든 NPC(agent) 목록 반환.
 * nanobot mode: openclawConfig.agentId 사용. 미설정 시 npcId fallback.
 */
export async function listNanobotAgents(channelId: string): Promise<NanobotAgentSummary[]> {
  if (!channelId) return [];
  const rows = await db
    .select({
      id: npcs.id,
      name: npcs.name,
      openclawConfig: npcs.openclawConfig,
    })
    .from(npcs)
    .where(eq(npcs.channelId, channelId));

  return rows.map((row) => {
    const cfg = parseConfig(row.openclawConfig);
    const agentId = cfg.agentId?.trim() || row.id;
    const persona = cfg.personaConfig;
    const hasPersona = Boolean(
      persona && ((persona.identity && persona.identity.length > 0) || (persona.soul && persona.soul.length > 0)),
    );
    return {
      npcId: row.id,
      agentId,
      name: row.name,
      hasPersona,
    };
  });
}
