// seed-v9 phase 4.5 follow-up — abort 버튼 트리거 회귀 방지 가드.
//
// 문제: 기존엔 setIsNpcStreaming(true)가 socket "npc:response-chunk" 첫 chunk
// 도착 시점에만 호출되어, reasoning 모델(qwen3.6-35b-a3b 등)의 첫 chunk가
// 30~120초 늦으면 사용자가 abort 버튼을 못 본다.
//
// 해결: socket.emit("npc:chat", ...) 직전에 setIsNpcStreaming(true)를 호출하여
// 메시지 전송 즉시 streaming 상태로 진입. 응답 완료/abort/error 시 false 처리는
// 기존 npc:response-* 이벤트 핸들러에서 유지.
//
// React 컴포넌트 단위 테스트는 jsdom + socket mock 구성 부담이 커
// 정적 grep 기반 회귀 가드로 대체.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const gamePageClient = path.join(here, "GamePageClient.tsx");

test("npc:chat emit 직전에 setIsNpcStreaming(true) 호출이 wiring 되어 있다", () => {
  const src = fs.readFileSync(gamePageClient, "utf8");

  // npc:chat emit 라인이 존재
  assert.match(src, /socket\.emit\(\s*["']npc:chat["']/, "npc:chat emit must exist");

  // setIsNpcStreaming(true) 호출이 최소 1회 존재
  assert.match(src, /setIsNpcStreaming\(true\)/, "setIsNpcStreaming(true) must be called");

  // npc:chat emit 직전 영역에 setIsNpcStreaming(true)가 포함되어 있는지 확인.
  // 두 패턴 사이의 텍스트가 30줄 이내인지(같은 함수 안인지) 검증.
  const emitIndex = src.indexOf('socket.emit("npc:chat"');
  const fallbackEmitIndex = emitIndex >= 0 ? emitIndex : src.indexOf("socket.emit('npc:chat'");
  assert.ok(fallbackEmitIndex >= 0, "npc:chat emit position must be found");

  // emit 직전 ~30줄 안에 setIsNpcStreaming(true) 호출 있어야 한다.
  const lookback = src.slice(Math.max(0, fallbackEmitIndex - 2000), fallbackEmitIndex);
  assert.match(
    lookback,
    /setIsNpcStreaming\(true\)/,
    "setIsNpcStreaming(true) must be called before socket.emit('npc:chat') so the abort button shows immediately on send (not only when first chunk arrives)",
  );
});

test("응답 완료/abort/error 시 setIsNpcStreaming(false) 처리가 다수 존재 (기존 흐름 유지)", () => {
  const src = fs.readFileSync(gamePageClient, "utf8");
  // npc:response-complete + npc:response-error + chat:abort 등 여러 이벤트에서 false 처리.
  // 최소 5회 등장해야 (기존 코드 흐름 유지 확인)
  const falseCount = (src.match(/setIsNpcStreaming\(false\)/g) || []).length;
  assert.ok(
    falseCount >= 5,
    `setIsNpcStreaming(false) should be called in multiple cleanup paths, found ${falseCount}`,
  );
});
