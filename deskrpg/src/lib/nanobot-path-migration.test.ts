// seed-v9 AC-015 T-029 — migrateLegacyOpenClawPaths 단위 테스트.
//
// HOME + NANOBOT_HOME을 tmpdir로 격리해 실 사용자 홈 영향 없이 실행.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrateLegacyOpenClawPaths } from "./nanobot-path-migration";

async function makeIsolatedHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "path-migration-test-"));
  const env: Record<string, string | undefined> = {
    HOME: home,
    NANOBOT_HOME: path.join(home, ".nanobot"),
  };
  return {
    home,
    env,
    cleanup: () => fs.rm(home, { recursive: true, force: true }),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

test("migrateLegacyOpenClawPaths: ~/.openclaw → ~/.nanobot (rename + content preserved)", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const legacyDir = path.join(ctx.home, ".openclaw");
  await fs.mkdir(path.join(legacyDir, "workspace-abc"), { recursive: true });
  await fs.writeFile(path.join(legacyDir, "workspace-abc", "IDENTITY.md"), "legacy-id");

  const result = await migrateLegacyOpenClawPaths(ctx.env);

  const moved = result.steps.find((s) => s.from.endsWith("/.openclaw"));
  assert.equal(moved?.action, "moved", "step recorded as moved");

  // ~/.openclaw 사라지고
  assert.equal(await fileExists(legacyDir), false);
  // ~/.nanobot에 콘텐츠 그대로
  const nanobotDir = path.join(ctx.home, ".nanobot");
  assert.equal(await fileExists(nanobotDir), true);
  assert.equal(
    await fs.readFile(path.join(nanobotDir, "workspace-abc", "IDENTITY.md"), "utf8"),
    "legacy-id",
  );
});

test("migrateLegacyOpenClawPaths: ~/.openclaw-devices → ~/.nanobot-devices", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const legacyDevices = path.join(ctx.home, ".openclaw-devices");
  await fs.mkdir(legacyDevices, { recursive: true });
  await fs.writeFile(path.join(legacyDevices, "deviceA.json"), '{"id":"a"}');

  const result = await migrateLegacyOpenClawPaths(ctx.env);

  const movedDevices = result.steps.find((s) => s.from.endsWith("/.openclaw-devices"));
  assert.equal(movedDevices?.action, "moved");

  assert.equal(await fileExists(legacyDevices), false);
  const nanobotDevices = path.join(ctx.home, ".nanobot-devices");
  assert.equal(await fileExists(nanobotDevices), true);
  assert.equal(
    await fs.readFile(path.join(nanobotDevices, "deviceA.json"), "utf8"),
    '{"id":"a"}',
  );
});

test("migrateLegacyOpenClawPaths: no legacy dirs → no-op (no error)", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const result = await migrateLegacyOpenClawPaths(ctx.env);

  assert.equal(result.steps.length, 2);
  for (const step of result.steps) {
    assert.equal(step.action, "skipped_source_missing");
  }
});

test("migrateLegacyOpenClawPaths: target already exists → skipped_target_exists (legacy untouched)", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const legacyDir = path.join(ctx.home, ".openclaw");
  const nanobotDir = path.join(ctx.home, ".nanobot");
  await fs.mkdir(legacyDir, { recursive: true });
  await fs.writeFile(path.join(legacyDir, "marker.txt"), "legacy");
  await fs.mkdir(nanobotDir, { recursive: true });
  await fs.writeFile(path.join(nanobotDir, "existing.txt"), "current");

  const result = await migrateLegacyOpenClawPaths(ctx.env);

  const step = result.steps.find((s) => s.from.endsWith("/.openclaw"));
  assert.equal(step?.action, "skipped_target_exists");

  // 양쪽 모두 그대로
  assert.equal(await fileExists(path.join(legacyDir, "marker.txt")), true);
  assert.equal(await fileExists(path.join(nanobotDir, "existing.txt")), true);
});

test("migrateLegacyOpenClawPaths: idempotent — 2회 실행 시 두 번째는 source_missing 또는 target_exists", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  await fs.mkdir(path.join(ctx.home, ".openclaw", "ws"), { recursive: true });
  await fs.writeFile(path.join(ctx.home, ".openclaw", "ws", "f.txt"), "x");

  const first = await migrateLegacyOpenClawPaths(ctx.env);
  assert.equal(
    first.steps.find((s) => s.from.endsWith("/.openclaw"))?.action,
    "moved",
  );

  const second = await migrateLegacyOpenClawPaths(ctx.env);
  const repeatedAction = second.steps.find((s) => s.from.endsWith("/.openclaw"))?.action;
  // legacy 소스는 이미 사라졌으므로 skipped_source_missing이 정상.
  assert.ok(
    repeatedAction === "skipped_source_missing" || repeatedAction === "skipped_target_exists",
    `expected source_missing or target_exists, got ${repeatedAction}`,
  );

  // 데이터는 보존되어야 함
  assert.equal(
    await fs.readFile(path.join(ctx.home, ".nanobot", "ws", "f.txt"), "utf8"),
    "x",
  );
});

test("migrateLegacyOpenClawPaths: workspace + devices 동시 마이그레이션", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  await fs.mkdir(path.join(ctx.home, ".openclaw"), { recursive: true });
  await fs.writeFile(path.join(ctx.home, ".openclaw", "w.txt"), "w");
  await fs.mkdir(path.join(ctx.home, ".openclaw-devices"), { recursive: true });
  await fs.writeFile(path.join(ctx.home, ".openclaw-devices", "d.txt"), "d");

  const result = await migrateLegacyOpenClawPaths(ctx.env);

  assert.equal(result.steps.length, 2);
  assert.ok(result.steps.every((s) => s.action === "moved"));
  assert.equal(await fs.readFile(path.join(ctx.home, ".nanobot", "w.txt"), "utf8"), "w");
  assert.equal(
    await fs.readFile(path.join(ctx.home, ".nanobot-devices", "d.txt"), "utf8"),
    "d",
  );
});
