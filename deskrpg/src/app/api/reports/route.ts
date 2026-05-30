// seed-v11 AC-008 / T-V11-010 — Presentation Layer: 사용자용 agent_reports fetch.
//
// GET /api/reports?npcId=&limit=
//   ReportPanel mount 시 (npcId 지정) + HistoryModal 열 때 (npcId 미지정) fetch.
//   인증: x-user-id 헤더 (기존 user-auth 패턴, v10 tasks/characters route와 동일).
//   character_id는 헤더 user → characters.user_id로 lookup (사용자당 1 character 가정).

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, characters } from "@/db";
import { getUserId } from "@/lib/internal-rpc";
import { listReportsByCharacter } from "@/lib/report-list-service";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ errorCode: "unauthorized" }, { status: 401 });
  }

  const characterRows = await db
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.userId, userId))
    .limit(1);
  const character = characterRows[0];
  if (!character) {
    return NextResponse.json({ errorCode: "character_not_found" }, { status: 404 });
  }

  const npcId = req.nextUrl.searchParams.get("npcId") || undefined;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam != null ? Number(limitParam) : undefined;

  try {
    const reports = await listReportsByCharacter(character.id, { npcId, limit });
    return NextResponse.json({ reports });
  } catch (err) {
    console.error("[api/reports] list failed:", err);
    return NextResponse.json({ errorCode: "internal_error" }, { status: 500 });
  }
}
