// seed-v9 AC-015 T-029 — legacy openclaw path one-shot migration.
//
// 첫 부팅 시 ~/.openclaw + ~/.openclaw-devices 디렉토리를 ~/.nanobot +
// ~/.nanobot-devices로 rename. 멱등 — 이미 .nanobot이 있으면 충돌 회피 위해
// skip하고 경고만 로그.
//
// 호출: 서버 부팅 직후 1회 (dev-server.ts / server.js). 실패해도 부팅은 계속.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getNanobotHomeDir } from "./nanobot-agent-lifecycle";

export type MigrationStep = {
  from: string;
  to: string;
  action: "moved" | "skipped_target_exists" | "skipped_source_missing" | "error";
  error?: string;
};

export type MigrationResult = {
  steps: MigrationStep[];
};

function defaultLegacyHome(env: Record<string, string | undefined>): string {
  return env.HOME || os.homedir();
}

async function existsAsDir(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function migrateOne(
  from: string,
  to: string,
  steps: MigrationStep[],
): Promise<void> {
  if (!(await existsAsDir(from))) {
    steps.push({ from, to, action: "skipped_source_missing" });
    return;
  }
  if (await existsAsDir(to)) {
    steps.push({ from, to, action: "skipped_target_exists" });
    return;
  }
  try {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    steps.push({ from, to, action: "moved" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push({ from, to, action: "error", error: message });
  }
}

/**
 * ~/.openclaw → ~/.nanobot 이동 + ~/.openclaw-devices → ~/.nanobot-devices 이동.
 * 두 작업은 독립적으로 실행 — 하나가 실패해도 다른 하나는 계속 시도.
 */
export async function migrateLegacyOpenClawPaths(
  env: Record<string, string | undefined> = process.env,
): Promise<MigrationResult> {
  const home = defaultLegacyHome(env);
  const steps: MigrationStep[] = [];

  // 1) workspace home
  await migrateOne(
    path.join(home, ".openclaw"),
    getNanobotHomeDir(env),
    steps,
  );

  // 2) device identities
  // seed-v9 D-21: ~/.nanobot-devices/ — sibling of ~/.nanobot
  const nanobotDevices = path.join(path.dirname(getNanobotHomeDir(env)), ".nanobot-devices");
  await migrateOne(
    path.join(home, ".openclaw-devices"),
    nanobotDevices,
    steps,
  );

  return { steps };
}
