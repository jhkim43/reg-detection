// seed-v11 AC-008 — Logic Layer: agent_reports 조회 서비스.
//
// GET /api/reports의 데이터 access. presentation layer가 Drizzle 직접 호출하지 않도록
// 분리 (3-tier 경계 준수).
//
//   listReportsByCharacter(characterId, opts)
//     - opts.npcId 지정 시 그 NPC가 작성한 보고서만 (ReportPanel용, default LIMIT 1)
//     - opts.npcId 미지정 시 character 전체 (HistoryModal용, default LIMIT 50)
//     - LEFT JOIN npcs → creatorNpcName resolve (npc 삭제된 row는 null)
//     - metadata.creatorSubAgentLabel snapshot은 row.metadata에서 추출

import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb, agentReports, npcs } from "@/db";

export type ReportListItem = {
  id: string;
  characterId: string;
  npcId: string | null;
  title: string | null;
  bodyMarkdown: string;
  metadata: Record<string, unknown> | null;
  createdAt: string; // ISO8601
  creatorNpcName: string | null;          // npcs.name (null if NPC deleted)
  creatorSubAgentLabel: string | null;     // metadata.creatorSubAgentLabel snapshot
};

export type ListReportsOptions = {
  npcId?: string;
  limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

function clampLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export async function listReportsByCharacter(
  characterId: string,
  opts: ListReportsOptions = {},
  dbHandle: typeof defaultDb = defaultDb,
): Promise<ReportListItem[]> {
  const limit = clampLimit(opts.limit);
  const whereClause = opts.npcId
    ? and(
        eq(agentReports.characterId, characterId),
        eq(agentReports.npcId, opts.npcId),
      )
    : eq(agentReports.characterId, characterId);

  const rows = await dbHandle
    .select({
      id: agentReports.id,
      characterId: agentReports.characterId,
      npcId: agentReports.npcId,
      title: agentReports.title,
      bodyMarkdown: agentReports.bodyMarkdown,
      metadata: agentReports.metadata,
      createdAt: agentReports.createdAt,
      creatorNpcName: npcs.name,
    })
    .from(agentReports)
    .leftJoin(npcs, eq(agentReports.npcId, npcs.id))
    .where(whereClause)
    .orderBy(desc(agentReports.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const meta = parseMetadata(row.metadata);
    const creatorSubAgentLabel =
      meta && typeof meta.creatorSubAgentLabel === "string"
        ? meta.creatorSubAgentLabel
        : null;
    const createdAtIso =
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : typeof row.createdAt === "string"
          ? row.createdAt
          : new Date().toISOString();
    return {
      id: row.id,
      characterId: row.characterId,
      npcId: row.npcId,
      title: row.title,
      bodyMarkdown: row.bodyMarkdown,
      metadata: meta,
      createdAt: createdAtIso,
      creatorNpcName: row.creatorNpcName,
      creatorSubAgentLabel,
    };
  });
}
