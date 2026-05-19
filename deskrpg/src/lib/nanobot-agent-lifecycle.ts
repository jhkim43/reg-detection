// seed-v9 AC-013 — NPC/Agent lifecycle parity for AI_PROVIDER=nanobot.
//
// nanobot은 stateless이므로 agents.create RPC는 no-op (DB에 personaConfig 저장이
// source of truth, seed-v9 D-22). 하지만 워크스페이스에 IDENTITY.md/SOUL.md를
// **write-only mirror**로 작성하여 인간 디버깅·tail 가능하게 한다
// (seed-v9 constraints.must + D-22 결정).
//
// 워크스페이스 경로: ~/.nanobot/workspace-${agentId} (seed-v9 D-21).
// 기존 ~/.openclaw/* 경로의 1회용 마이그레이션은 별도 스크립트(T-029).

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
  name: "IDENTITY.md" | "SOUL.md" | "AGENTS.md";
  content: string;
};

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
  if (typeof files.identity === "string") {
    list.push({ name: "IDENTITY.md", content: files.identity });
  }
  if (typeof files.soul === "string") {
    list.push({ name: "SOUL.md", content: files.soul });
  }
  if (typeof files.meetingProtocol === "string") {
    list.push({ name: "AGENTS.md", content: files.meetingProtocol });
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
