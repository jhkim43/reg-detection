// POST /api/internal/relay-subagent-result
//
// nanobot OpenAI API 서버 모드에는 일반 daemon 모드의 consume_inbound 메인 루프가
// 없어 sub-agent가 publish_inbound 해도 메인 LLM이 새 turn으로 깨어나지 않는다.
// 이 endpoint가 그 트리거 역할을 한다 — sub-agent가 끝나면 nanobot subagent.py가
// 이 endpoint로 결과를 전달, deskrpg는 nanobot OpenAI endpoint에 새 채팅 요청을
// fire-and-forget 으로 보내 메인 LLM의 새 turn을 강제 시작시킨다.
//
// 인증: x-deskrpg-internal-secret 헤더 (chat-push, reports 패턴과 동일)
// fire-and-forget — 응답은 즉시 200. nanobot 응답은 sub-agent들의 chat_push로
// 이미 풍부히 보이므로 별도 영속화하지 않음.

import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const internalTransport = require("@/lib/internal-transport.js") as {
  isInternalRequestAuthorized: (headers: Headers) => boolean;
};

type RawBody = {
  channel_id?: string;
  user_id?: string;
  character_id?: string;
  parent_npc_id?: string;     // 메인 supervisor npc uuid (== nanobot metadata.npc_id)
  parent_npc_label?: string;  // 라벨 (e.g. "Supervisor") — nanobot metadata.parent_npc_id
  subagent_label?: string;
  result_summary?: string;
  status?: string;
  session_key?: string;
};

export async function POST(req: NextRequest) {
  if (!internalTransport.isInternalRequestAuthorized(req.headers)) {
    return NextResponse.json({ errorCode: "unauthorized" }, { status: 401 });
  }

  let body: RawBody;
  try {
    body = (await req.json()) as RawBody;
  } catch {
    return NextResponse.json({ errorCode: "invalid_json" }, { status: 400 });
  }

  const channelId = String(body.channel_id ?? "");
  const userId = String(body.user_id ?? "");
  const characterId = String(body.character_id ?? "");
  const parentNpcId = String(body.parent_npc_id ?? "");
  const parentNpcLabel = String(body.parent_npc_label ?? "Supervisor");
  const subagentLabel = String(body.subagent_label ?? "");
  const resultSummary = String(body.result_summary ?? "");
  const status = String(body.status ?? "ok");
  const sessionKey = String(body.session_key ?? "");

  for (const [name, value] of [
    ["channel_id", channelId],
    ["user_id", userId],
    ["character_id", characterId],
    ["parent_npc_id", parentNpcId],
    ["session_key", sessionKey],
  ] as const) {
    if (!value) {
      return NextResponse.json(
        { errorCode: "missing_required_field", field: name },
        { status: 400 },
      );
    }
  }

  const text =
    `[subagent-result:${subagentLabel}:${status}]\n${resultSummary}\n\n` +
    `⚠️ NEXT ACTION (MANDATORY): daily-regtrack-update SKILL.md 의 다음 sub-agent를 ` +
    `즉시 SpawnTool 로 호출하세요. 순서는 [수집 Agent → Ingest Agent → GAP 분석 Agent → 영향도 Agent]. ` +
    `완료된 sub-agent 의 다음 단계를 spawn 하세요. ` +
    `사용자에게 '기다리겠습니다' 같은 텍스트로 답하지 말고 즉시 SpawnTool 호출. ` +
    `4번째 (영향도 Agent) 완료 후에만 사용자에게 최종 한 줄 응답.`;
  const nanobotBaseUrl = env.NANOBOT_API_URL.replace(/\/+$/, "");
  const payload = {
    model: env.NANOBOT_MODEL,
    messages: [{ role: "user", content: text }],
    stream: true,
    metadata: {
      user_id: userId,
      character_id: characterId,
      channel_id: channelId,
      parent_npc_id: parentNpcLabel,
      npc_id: parentNpcId,
    },
    // nanobot api/server.py:248 — `session_key = f"api:{session_id}"` 처럼
    // 자체적으로 "api:" prefix 를 붙인다. session_key 그대로 넘기면 매 relay
    // 마다 "api:" 가 누적된다 (e.g. api:api:api:ot-...). prefix 제거.
    session_id: sessionKey.startsWith("api:") ? sessionKey.slice(4) : sessionKey,
  };

  // Fire-and-forget. 응답을 await 하지 않으므로 SSE 연결은 nanobot이 끝낼 때
  // 자연 종료. 실패는 비치명 — 메인 LLM이 다음 spawn 못 받아도 사용자가 다시
  // 트리거할 수 있음.
  void fetch(`${nanobotBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(
          `[relay-subagent-result] nanobot non-ok status=${res.status} label=${subagentLabel}`,
        );
      }
      // SSE body 는 의도적으로 소비하지 않음 — fetch 가 헤더 수신 직후 반환된
      // 후 nanobot이 끝까지 stream 전송, 메인 LLM은 background로 SpawnTool 호출.
    })
    .catch((err) => {
      console.warn("[relay-subagent-result] nanobot fetch error:", err);
    });

  return NextResponse.json({ ok: true });
}
