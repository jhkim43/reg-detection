// seed-v9 AC-013 — NPC/Agent lifecycle parity for AI_PROVIDER=nanobot.
//
// nanobot은 stateless이므로 agents.create RPC는 no-op (DB에 personaConfig 저장이
// source of truth, seed-v9 D-22). 워크스페이스에 AGENTS.md / SOUL.md를 작성하면
// nanobot agent loop의 BOOTSTRAP_FILES(["AGENTS.md","SOUL.md","USER.md","TOOLS.md"])
// 가 system prompt로 자동 로드한다 — 즉 read-side는 nanobot이 담당.
//
// seed-v10 옵션 B1 정리:
//   - 기존 IDENTITY.md는 BOOTSTRAP에 포함되지 않아 nanobot이 무시 → 사문화.
//   - identity를 AGENTS.md 안의 "# Identity" 섹션으로 흡수 (buildAgentsFileContent).
//   - meetingProtocol은 "# Meeting Protocol" 섹션으로 함께 들어감.
//   - 결과: workspace가 nanobot persona의 single source of truth → user message에서
//     [Identity]/[Soul] 이중 inject가 사라져 LLM 컨텍스트 부담/혼란 제거.
//
// 워크스페이스 경로: ~/.nanobot/workspace-${agentId} (seed-v9 D-21).
// 기존 IDENTITY.md 파일은 nanobot이 안 읽으므로 자연 deprecation (마이그레이션 불필요).

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** seed-v9 D-21: nanobot 워크스페이스 root */
export function getNanobotHomeDir(env: Record<string, string | undefined> = process.env): string {
  return env.NANOBOT_HOME || path.join(os.homedir(), ".nanobot");
}

/** ~/.nanobot/workspace-${agentId} */
export function getNanobotAgentWorkspaceDir(agentId: string, env: Record<string, string | undefined> = process.env): string {
  return path.join(getNanobotHomeDir(env), `workspace-${agentId}`);
}

export type AgentFile = {
  name: "AGENTS.md" | "SOUL.md";
  content: string;
};

/**
 * identity + meetingProtocol을 nanobot의 AGENTS.md 단일 파일에 흡수.
 *
 * nanobot BOOTSTRAP_FILES가 AGENTS.md 하나만 persona로 읽으므로, deskrpg가 분리
 * 보관하던 두 필드를 한 파일에 섹션으로 합친다. 둘 다 비어 있으면 빈 문자열을
 * 반환 — 호출자는 그 경우 파일 자체를 작성하지 않는다.
 */
export function buildAgentsFileContent(
  identity: string | null | undefined,
  meetingProtocol: string | null | undefined,
): string {
  const parts: string[] = [];
  const id = (identity ?? "").trim();
  const mp = (meetingProtocol ?? "").trim();
  if (id) parts.push(`# Identity\n${id}`);
  if (mp) parts.push(`# Meeting Protocol\n${mp}`);
  return parts.join("\n\n");
}

/**
 * Write-only mirror: nanobot 워크스페이스에 .md 파일 작성.
 *
 * - nanobot agent loop은 이 파일들을 read 하지 않는다 (DB가 source of truth, D-22).
 * - 디렉토리는 멱등 생성, 파일은 덮어쓰기.
 * - openclaw mode와 달리 RPC 호출 없음 — 파일 시스템 직접 write.
 */
export async function writeNanobotAgentFiles(
  agentId: string,
  files: ReadonlyArray<AgentFile>,
  env: Record<string, string | undefined> = process.env,
): Promise<{ workspacePath: string; written: string[] }> {
  if (!agentId || !agentId.trim()) {
    throw new Error("writeNanobotAgentFiles: agentId required");
  }
  const workspacePath = getNanobotAgentWorkspaceDir(agentId.trim(), env);
  await fs.mkdir(workspacePath, { recursive: true });

  const written: string[] = [];
  for (const file of files) {
    const filePath = path.join(workspacePath, file.name);
    await fs.writeFile(filePath, file.content, "utf8");
    written.push(file.name);
  }
  return { workspacePath, written };
}

/**
 * seed-v9 AC-015 T-028 — updateNpcPersona side-effect.
 *
 * 페르소나 update 시 mirror 파일도 갱신. writeNanobotAgentFiles 위의 typed
 * wrapper로, identity/soul/meetingProtocol 중 제공된 것만 골라서 쓴다.
 * undefined인 키는 건드리지 않음(부분 update 의미).
 *
 * - nanobot agent loop은 이 파일들을 read 하지 않는다 (D-22, DB가 SoT).
 * - 디버깅·tail 용도 mirror — 파일은 단방향 write.
 */
export async function setAgentFiles(
  agentId: string,
  files: { identity?: string; soul?: string; meetingProtocol?: string },
  env: Record<string, string | undefined> = process.env,
): Promise<{ workspacePath: string; written: string[] }> {
  const list: AgentFile[] = [];

  // seed-v10 옵션 B1: identity + meetingProtocol을 AGENTS.md 한 파일에 통합.
  // 둘 중 하나라도 undefined가 아니면 (caller가 명시적으로 update 의도) AGENTS.md를
  // 갱신. 양쪽이 모두 undefined일 때만 건너뜀 — 부분 update 의미 유지.
  const identityProvided = typeof files.identity === "string";
  const meetingProtocolProvided = typeof files.meetingProtocol === "string";
  if (identityProvided || meetingProtocolProvided) {
    list.push({
      name: "AGENTS.md",
      content: buildAgentsFileContent(files.identity, files.meetingProtocol),
    });
  }
  if (typeof files.soul === "string") {
    list.push({ name: "SOUL.md", content: files.soul });
  }
  if (list.length === 0) {
    const workspacePath = getNanobotAgentWorkspaceDir(agentId.trim(), env);
    return { workspacePath, written: [] };
  }
  return writeNanobotAgentFiles(agentId, list, env);
}

/**
 * agent 삭제: workspace 디렉토리 cleanup.
 * DB persona 삭제는 호출자 책임 (route에서 npcs row DELETE).
 */
export async function deleteNanobotAgentWorkspace(
  agentId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ workspacePath: string; deleted: boolean }> {
  if (!agentId || !agentId.trim()) {
    throw new Error("deleteNanobotAgentWorkspace: agentId required");
  }
  const workspacePath = getNanobotAgentWorkspaceDir(agentId.trim(), env);
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
    return { workspacePath, deleted: true };
  } catch (err) {
    // ENOENT는 이미 삭제된 상태 — idempotent
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { workspacePath, deleted: false };
    }
    throw err;
  }
}

/**
 * 워크스페이스 존재 여부 확인 (디버깅·헬스체크용).
 */
export async function nanobotAgentWorkspaceExists(
  agentId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (!agentId || !agentId.trim()) return false;
  const workspacePath = getNanobotAgentWorkspaceDir(agentId.trim(), env);
  try {
    const stat = await fs.stat(workspacePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
