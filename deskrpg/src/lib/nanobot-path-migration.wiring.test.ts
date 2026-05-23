// T-F01 — server.js (production)와 dev-server.ts (dev) 양쪽의 boot 흐름에
// migrateLegacyOpenClawPaths() 호출이 와이어링되어 있는지 회귀 방지 가드.
//
// 단순 grep 수준이지만 production 경로가 누락되었을 때(Phase 3 smoke test에서 실제로
// 발생) 컴파일/런타임 통과로 인해 못 잡는 회귀를 차단한다.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

test("server.js (production) imports nanobot-path-migration and calls migrateLegacyOpenClawPaths", () => {
  const serverJs = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
  assert.match(serverJs, /nanobot-path-migration/, "server.js must import nanobot-path-migration");
  assert.match(serverJs, /migrateLegacyOpenClawPaths\(\)/, "server.js must invoke migrateLegacyOpenClawPaths()");
});

test("dev-server.ts (dev) also invokes migrateLegacyOpenClawPaths (parity)", () => {
  const devServer = fs.readFileSync(path.join(repoRoot, "dev-server.ts"), "utf8");
  assert.match(devServer, /migrateLegacyOpenClawPaths\(\)/, "dev-server.ts must invoke migrateLegacyOpenClawPaths()");
});

test("migrate call sits inside an async block with non-fatal error handling", () => {
  // 부팅 실패를 방지하기 위해 try/catch로 감싸야 한다.
  const serverJs = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
  const migrateRegion = serverJs.match(/try\s*{[^}]*migrateLegacyOpenClawPaths[\s\S]*?}\s*catch/);
  assert.ok(migrateRegion, "migrate call must be wrapped in try/catch (non-fatal on failure)");
});
