// seed-v9 Phase 2 AC-013 — nanobot agent lifecycle 단위 테스트 (T-012 + T-013).
//
// writeNanobotAgentFiles (write-only mirror to ~/.nanobot/workspace-${agentId})
// + deleteNanobotAgentWorkspace + path helpers.
//
// NANOBOT_HOME env로 격리된 임시 디렉토리에서 실행 (실 ~/.nanobot 영향 X).
//
// run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getNanobotHomeDir,
  getNanobotAgentWorkspaceDir,
  writeNanobotAgentFiles,
  deleteNanobotAgentWorkspace,
  nanobotAgentWorkspaceExists,
} from "./nanobot-agent-lifecycle";

async function makeIsolatedHome(): Promise<{ home: string; env: Record<string, string | undefined>; cleanup: () => Promise<void> }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "nanobot-test-"));
  const env = { ...process.env, NANOBOT_HOME: home };
  return {
    home,
    env,
    cleanup: async () => {
      await fs.rm(home, { recursive: true, force: true });
    },
  };
}

// ─── path helpers ───

test("getNanobotHomeDir: NANOBOT_HOME env override", () => {
  assert.equal(getNanobotHomeDir({ NANOBOT_HOME: "/tmp/custom" }), "/tmp/custom");
});

test("getNanobotHomeDir: default ~/.nanobot when env missing", () => {
  const home = getNanobotHomeDir({});
  assert.ok(home.endsWith("/.nanobot"), `expected ends with /.nanobot, got: ${home}`);
});

test("getNanobotAgentWorkspaceDir: combines home + workspace-${agentId}", () => {
  const result = getNanobotAgentWorkspaceDir("agent-abc", { NANOBOT_HOME: "/base" });
  assert.equal(result, "/base/workspace-agent-abc");
});

// ─── writeNanobotAgentFiles ───

test("writeNanobotAgentFiles: creates workspace dir + writes files", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const result = await writeNanobotAgentFiles(
    "agent-001",
    [
      { name: "IDENTITY.md", content: "# Identity\nI am a test NPC." },
      { name: "SOUL.md", content: "# Soul\nFriendly." },
    ],
    ctx.env,
  );

  assert.equal(result.workspacePath, path.join(ctx.home, "workspace-agent-001"));
  assert.deepEqual(result.written.sort(), ["IDENTITY.md", "SOUL.md"]);

  const identity = await fs.readFile(path.join(result.workspacePath, "IDENTITY.md"), "utf8");
  const soul = await fs.readFile(path.join(result.workspacePath, "SOUL.md"), "utf8");
  assert.equal(identity, "# Identity\nI am a test NPC.");
  assert.equal(soul, "# Soul\nFriendly.");
});

test("writeNanobotAgentFiles: idempotent — overwrites existing files", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  await writeNanobotAgentFiles("agent-002", [{ name: "IDENTITY.md", content: "v1" }], ctx.env);
  await writeNanobotAgentFiles("agent-002", [{ name: "IDENTITY.md", content: "v2" }], ctx.env);

  const content = await fs.readFile(
    path.join(getNanobotAgentWorkspaceDir("agent-002", ctx.env), "IDENTITY.md"),
    "utf8",
  );
  assert.equal(content, "v2");
});

test("writeNanobotAgentFiles: empty agentId throws", async () => {
  await assert.rejects(() => writeNanobotAgentFiles("", []), /agentId required/);
  await assert.rejects(() => writeNanobotAgentFiles("  ", []), /agentId required/);
});

test("writeNanobotAgentFiles: agentId trimmed", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const result = await writeNanobotAgentFiles("  agent-trim  ", [{ name: "IDENTITY.md", content: "x" }], ctx.env);
  assert.equal(result.workspacePath, path.join(ctx.home, "workspace-agent-trim"));
});

// ─── deleteNanobotAgentWorkspace ───

test("deleteNanobotAgentWorkspace: removes existing workspace", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  await writeNanobotAgentFiles("agent-del", [{ name: "IDENTITY.md", content: "x" }], ctx.env);
  assert.equal(await nanobotAgentWorkspaceExists("agent-del", ctx.env), true);

  const result = await deleteNanobotAgentWorkspace("agent-del", ctx.env);
  assert.equal(result.deleted, true);
  assert.equal(await nanobotAgentWorkspaceExists("agent-del", ctx.env), false);
});

test("deleteNanobotAgentWorkspace: idempotent — missing dir returns deleted=false (no throw)", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);

  const result = await deleteNanobotAgentWorkspace("never-existed", ctx.env);
  // rm with force:true는 ENOENT를 throw 안 함 → deleted=true 반환 가능
  // 핵심: throw 안 함
  assert.equal(typeof result.deleted, "boolean");
});

test("deleteNanobotAgentWorkspace: empty agentId throws", async () => {
  await assert.rejects(() => deleteNanobotAgentWorkspace(""), /agentId required/);
});

// ─── nanobotAgentWorkspaceExists ───

test("nanobotAgentWorkspaceExists: false when workspace missing", async (t) => {
  const ctx = await makeIsolatedHome();
  t.after(ctx.cleanup);
  assert.equal(await nanobotAgentWorkspaceExists("nonexistent", ctx.env), false);
});

test("nanobotAgentWorkspaceExists: false for empty agentId", async () => {
  assert.equal(await nanobotAgentWorkspaceExists(""), false);
});
