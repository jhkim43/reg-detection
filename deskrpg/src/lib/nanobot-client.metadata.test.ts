// seed-v10 AC-006 / T-V18 — chatSend가 metadata를 nanobot HTTP body에 그대로 실어
// 보내는지 단위 검증.
//
// 검증 포인트:
//   (1) opts.metadata가 body.metadata로 그대로 전달된다 (passthrough).
//   (2) opts.metadata가 없으면 body에 "metadata" 키 자체가 없다 (legacy compat).
//   (3) snake_case 키가 변환 없이 보존된다 (nanobot contract의 표준 키 모양).
//   (4) 잘못된 모양(array)은 metadata로 받지 않는다 (방어).
//
// buildNanobotRequestBody만 단독 검증 — fetch 자체 mock은 nanobot-chat-streaming.test에서.

import { test } from "node:test";
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildNanobotRequestBody } = require("./nanobot-client.cjs");

const baseMsgs = [{ role: "user", content: "hi" }];

test("buildNanobotRequestBody: metadata is attached as body.metadata", () => {
  const body = buildNanobotRequestBody(
    baseMsgs,
    { sessionId: "sk-1", metadata: { user_id: "u-1", channel_id: "c-1" } },
  );
  assert.deepEqual(body.metadata, { user_id: "u-1", channel_id: "c-1" });
  assert.equal(body.session_id, "sk-1");
});

test("buildNanobotRequestBody: omits metadata when not provided", () => {
  const body = buildNanobotRequestBody(baseMsgs, { sessionId: "sk-1" });
  assert.equal("metadata" in body, false);
});

test("buildNanobotRequestBody: preserves snake_case keys in metadata", () => {
  const body = buildNanobotRequestBody(baseMsgs, {
    sessionId: "sk-1",
    metadata: {
      user_id: "u-1",
      character_id: "ch-1",
      channel_id: "c-1",
      parent_npc_id: "p-1",
    },
  });
  // nanobot contract는 snake_case 표준. deskrpg가 camelCase로 변환하지 않아야 함.
  assert.equal(body.metadata.user_id, "u-1");
  assert.equal(body.metadata.character_id, "ch-1");
  assert.equal(body.metadata.channel_id, "c-1");
  assert.equal(body.metadata.parent_npc_id, "p-1");
});

test("buildNanobotRequestBody: rejects array shape (treated as no metadata)", () => {
  const body = buildNanobotRequestBody(baseMsgs, {
    sessionId: "sk-1",
    metadata: ["bad", "shape"],
  });
  assert.equal("metadata" in body, false);
});

test("buildNanobotRequestBody: null metadata is treated as no metadata", () => {
  const body = buildNanobotRequestBody(baseMsgs, {
    sessionId: "sk-1",
    metadata: null,
  });
  assert.equal("metadata" in body, false);
});
