// seed-v9 Phase 1 verify-only test (T-001 회귀 보호 baseline, AC-012 LPC).
// 실코드 변경 0 — LPC sprite composition logic 회귀 방지.
//
// 원래 decomposition은 Playwright E2E를 요구했으나 Playwright 미설치 +
// 신규 dep는 사용자 승인 필요 (CLAUDE.md). 대안: pure function 단위 테스트로
// 핵심 합성 로직(getLayerPaths + normalizeAppearance) 회귀 보호.
// 실제 canvas 렌더 검증은 추후 Playwright 도입 시 추가 PR.
//
// run: npm test (tsx --test)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getLayerPaths,
  FRAME_WIDTH,
  FRAME_HEIGHT,
  WALK_COLS,
  WALK_ROWS,
  WALK_SHEET_WIDTH,
  WALK_SHEET_HEIGHT,
} from "./sprite-compositor";
import { normalizeAppearance, CharacterAppearance } from "./lpc-registry";

// ─── 상수 회귀 보호 (FRAME 크기 변경 시 spritesheet 좌표 전체 깨짐) ───

test("walk-only sheet dimensions are stable (FRAME=64x64, 9 cols × 4 rows)", () => {
  assert.equal(FRAME_WIDTH, 64);
  assert.equal(FRAME_HEIGHT, 64);
  assert.equal(WALK_COLS, 9);
  assert.equal(WALK_ROWS, 4);
  assert.equal(WALK_SHEET_WIDTH, 576);
  assert.equal(WALK_SHEET_HEIGHT, 256);
  assert.equal(WALK_SHEET_WIDTH, FRAME_WIDTH * WALK_COLS);
  assert.equal(WALK_SHEET_HEIGHT, FRAME_HEIGHT * WALK_ROWS);
});

// ─── normalizeAppearance: JSON 문자열 / legacy / 신규 포맷 모두 처리 ───

test("normalizeAppearance: empty input returns object with layers", () => {
  const norm = normalizeAppearance({} as CharacterAppearance);
  assert.equal(typeof norm, "object");
  assert.ok(norm.layers !== undefined || "layers" in norm);
});

test("normalizeAppearance: invalid JSON string degrades gracefully (no throw)", () => {
  const norm = normalizeAppearance("not-valid-json");
  // 빈 객체로 fallback (JSON.parse 실패 catch)
  assert.equal(typeof norm, "object");
});

test("normalizeAppearance: pre-normalized input passes through", () => {
  const input: CharacterAppearance = {
    bodyType: "male",
    layers: {
      body: { itemKey: "body_human_light", variant: "light" },
    },
  };
  const norm = normalizeAppearance(input);
  assert.equal(norm.bodyType, "male");
  assert.deepEqual(norm.layers.body, { itemKey: "body_human_light", variant: "light" });
});

// ─── getLayerPaths: AC-012 핵심 — 부품 변경이 path 목록에 반영 ───

test("getLayerPaths: empty appearance returns empty array (no body = no head auto-include)", () => {
  const norm = normalizeAppearance({} as CharacterAppearance);
  const paths = getLayerPaths(norm);
  assert.equal(Array.isArray(paths), true);
  // body 없으면 auto head도 없음
  assert.equal(paths.length, 0);
});

test("getLayerPaths: all returned values are strings", () => {
  const input: CharacterAppearance = {
    bodyType: "male",
    layers: {
      body: { itemKey: "body_human_light", variant: "light" },
    },
  };
  const paths = getLayerPaths(input);
  for (const p of paths) {
    assert.equal(typeof p, "string");
    assert.ok(p.startsWith("/assets/spritesheets/"), `path should start with /assets/spritesheets/: ${p}`);
  }
});

test("getLayerPaths: body selection auto-includes head layer", () => {
  const input: CharacterAppearance = {
    bodyType: "male",
    layers: {
      body: { itemKey: "body_human_light", variant: "light" },
    },
  };
  const paths = getLayerPaths(input);
  const hasHead = paths.some((p) => p.includes("/head/human/"));
  assert.equal(hasHead, true, "body 선택 시 head layer 자동 포함되어야 함");
});

test("getLayerPaths: returns walk-only sheet paths (path contains '/walk/')", () => {
  const input: CharacterAppearance = {
    bodyType: "male",
    layers: {
      body: { itemKey: "body_human_light", variant: "light" },
    },
  };
  const paths = getLayerPaths(input);
  for (const p of paths) {
    assert.ok(p.includes("/walk/"), `path should use walk-only sheet: ${p}`);
  }
});
