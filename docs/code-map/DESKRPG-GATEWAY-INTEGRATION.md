# Deskrpg Gateway Integration Plan — nanobot 연결 전략

> **출처**: walking skeleton spike (`feat/deskrpg-fork`) 중 deskrpg 5개 파일 분석
> **작성일**: 2026-05-16
> **목적**: deskrpg의 OpenClaw gateway 구조 파악 + nanobot 통합 2단계 전략 (spike 우회 + 정식 in-place 교체)
> **선행 자료**: [NANOBOT-CODEMAP.md](./NANOBOT-CODEMAP.md), seed-v8 D-1/D-2

---

## 1. 결론 (TL;DR)

deskrpg는 이미 **OpenClaw**라는 다른 AI agent와 통합되어 있음. 우리 RegTrack은 OpenClaw 자리에 nanobot을 끼움(in-place 교체). 단 **프로토콜이 호환되지 않아** spike 단계엔 우회·정식 통합은 M3-M4로 분리.

- **Spike (지금, W1-W2)**: 새 React 컴포넌트 + 직접 WS connect — 1-2h
- **정식 통합 (M3-M4)**: `nanobot-gateway.ts` adapter + socket-handlers.ts 분기 — 1-2주

---

## 2. deskrpg의 OpenClaw 통합 구조 (5개 파일)

| 파일 | 역할 | 라인 수 |
|------|------|--------|
| `src/lib/openclaw-gateway.js` | `OpenClawGateway` 클래스 + WebSocket RPC 클라이언트 | 653 |
| `src/lib/gateway-resources.ts` | DB 추상화 (등록·암호화·바인딩) — **OpenClaw hardcoded** | 513 |
| `src/server/socket-handlers.ts` | 채팅/NPC/회의 로직에서 `new OpenClawGateway()` 직접 instantiate | 700+ |
| `src/app/api/channels/test-gateway/route.ts` | gateway 등록 시 round-trip 검증 REST API | 76 |
| `src/lib/env.ts` | `OPENCLAW_WS_URL`, `OPENCLAW_TOKEN` 환경변수 | ~13 |

### 2.1 OpenClaw 프로토콜 (복잡)

```
deskrpg ──┬─ WebSocket connect (url, token)
          │     └─ Ed25519 device identity + pairing challenge
          ├─ chatSend(agentId, sessionKey, message, onDelta) ─ streaming RPC
          ├─ agentsList() ────────── RPC
          ├─ agentsCreate(name, workspace, emoji)
          ├─ agentsDelete(agentId)
          ├─ agentsFileGet/Set/List(agentId, name, content)
          └─ disconnect()
```

핵심 특성:
- **RPC 패턴**: seq 번호, pending Map, 30s timeout
- **agent 관리**: 여러 agent 생성·삭제·파일 read/write 지원
- **streaming chat**: `onDelta(text)` 콜백
- **인증**: Ed25519 키 페어 + pairing challenge (device identity)

### 2.2 호출 위치 (socket-handlers.ts 등)

```typescript
// line 58
const { OpenClawGateway } = require("../lib/openclaw-gateway.js");

// line 369, 600, 655 (3곳)
const response = await gateway.chatSend(agentId, sessionKey, prompt, onDelta);

// line 467, 492
const gatewayConfig = await getGatewayRuntimeConfigForChannel(channelId);
```

---

## 3. nanobot 프로토콜 (단순)

```
deskrpg ──┬─ WebSocket connect (ws://127.0.0.1:8765/?client_id=alice)
          ├─ send: {"content": "hello"}
          └─ recv: {"event": "ready", ...} → {"text": "응답", ...}
```

- 인증: query string `client_id` + (옵션) `token`
- 메시지: simple JSON
- agent 관리: 없음 (default agent 1개, config로 모델 변경)
- streaming: server-pushed messages

---

## 4. 호환성 분석 — 왜 in-place 교체가 spike에 부적합한가

| 항목 | OpenClaw | nanobot |
|------|---------|---------|
| 인증 | Ed25519 + pairing | query string token |
| Agent 모델 | 다수 agent 생성·관리 | default agent 1개 |
| RPC | seq 기반 pending Map | 없음 (event 메시지) |
| chatSend | streaming onDelta callback | server-pushed event messages |
| File ops | agentsFileGet/Set/List | nanobot session 파일 (workspace/sessions) |

**결론**: nanobot을 OpenClawGateway 인터페이스로 wrap하려면 어댑터가 500-1000줄 규모 필요. agentsList 같은 RPC는 fake 응답 필요. Spike에 부적합.

---

## 5. 2단계 통합 전략

### 5.1 Spike 단계 (지금, W1-W2) — 우회

**목적**: deskrpg(node) ↔ nanobot(python) WebSocket 통신이 실제 가능함을 시각적으로 증명.

**구현**:
```
deskrpg frontend (Next.js)
   └─ 새 React 컴포넌트 NanobotChat.tsx
        └─ 직접 ws://127.0.0.1:8765 connect (browser WebSocket API)
              └─ "hello" send → 응답 받아서 화면에 표시
```

**위치**:
- `deskrpg/src/components/NanobotChat.tsx` (신규)
- 또는 `deskrpg/src/app/game/GamePageClient.tsx`에 임시 인라인

**socket-handlers.ts·openclaw-gateway.js·gateway-resources.ts 미터치**.

**검증 결과물**:
- Game 화면 한 모서리에 "nanobot: <응답 텍스트>" 표시
- 또는 NPC 머리 위 dialog bubble
- 동작하면 spike 완료, 본인 + 팀원 + 어드바이저에게 데모 가능

### 5.2 정식 통합 (M3-M4) — In-place 교체

**목적**: OpenClaw 자리에 nanobot이 들어가 채널·NPC·회의 전체 흐름이 nanobot으로 동작.

**구현 (3가지 핵심 작업)**:

1. **`nanobot-gateway.ts` adapter 작성** (신규 ~500줄)
   - `OpenClawGateway` 같은 시그니처 (`connect`, `chatSend`, `agentsList`, `agentsCreate` 등)
   - 내부에서 nanobot WS 프로토콜로 변환
   - agent 관리는 fake 또는 nanobot agents 명령어 호출

2. **`socket-handlers.ts` 분기**
   ```typescript
   // line 58 수정
   const gatewayKind = await getGatewayKind(channelId);  // "openclaw" | "nanobot"
   const GatewayClass = gatewayKind === "nanobot"
     ? require("../lib/nanobot-gateway").NanobotGateway
     : require("../lib/openclaw-gateway.js").OpenClawGateway;
   ```

3. **DB schema 확장**
   - `gateway_resources.kind` 필드 추가 (`"openclaw" | "nanobot"`)
   - drizzle migration 1개

**참조 task**: decomposition T-051~T-054, T-067 (M4 W7-W10)

---

## 6. 스파이크 우회 구현 — 1-2h 작업 계획

### Step 1: 신규 컴포넌트 작성

```tsx
// deskrpg/src/components/NanobotChat.tsx (신규, ~80줄)
"use client";
import { useEffect, useState, useRef } from "react";

export default function NanobotChat() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket("ws://127.0.0.1:8765/?client_id=deskrpg-spike");
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.text) setMessages(m => [...m, `nanobot: ${data.text}`]);
    };
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  const send = () => {
    wsRef.current?.send(JSON.stringify({ content: input }));
    setMessages(m => [...m, `me: ${input}`]);
    setInput("");
  };

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-slate-900 p-2 rounded">
      <div className="h-40 overflow-y-auto text-xs text-white">
        {messages.map((m, i) => <div key={i}>{m}</div>)}
      </div>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === "Enter" && send()}
        className="w-full text-black mt-1"
      />
    </div>
  );
}
```

### Step 2: GamePageClient에 임시 import

```tsx
// deskrpg/src/app/game/GamePageClient.tsx
import NanobotChat from "@/components/NanobotChat";
// ... 컴포넌트 return 안에
<NanobotChat />
```

### Step 3: 검증

1. `nanobot gateway` 떠있는 상태에서
2. deskrpg 게임 화면 진입 → 우측 하단에 채팅창
3. "hello" 입력·전송 → "nanobot: ..." 응답 표시
4. **여기까지 동작하면 walking skeleton 완료**

---

## 7. CORS 주의사항

브라우저에서 `ws://127.0.0.1:8765`로 직접 connect 시 nanobot이 connection을 허용해야 함:
- nanobot config에 `"allowFrom": ["*"]` 이미 설정됨 (현재 config 확인됨)
- CORS는 WebSocket에 적용 안 됨 (HTTP가 아니라 ws://)
- 단 브라우저가 mixed content 경고 시 → http://localhost:3000 (not https)이면 OK

---

## 8. 산출물 정리

| 파일 | 위치 | spike or 정식 |
|------|------|--------------|
| `NanobotChat.tsx` | `deskrpg/src/components/` | spike (deskrpg/는 .gitignore) |
| `nanobot-gateway.ts` | `deskrpg/src/lib/` (M3-M4) | 정식 |
| 본 문서 | `docs/code-map/DESKRPG-GATEWAY-INTEGRATION.md` | 영구 (RegTrack repo commit) |

**spike 코드(NanobotChat.tsx)는 deskrpg/ 안이라 RegTrack git에 안 들어감**. 본인 PC에서만 검증. 동작 확인되면 본 문서를 commit해서 다음 작업자(또는 본인 M3-M4 시점)가 참조.

---

## 9. Spike 검증 결과 (2026-05-16)

### 9.1 환경 셋업 (본인 PC, macOS)

| 항목 | 사용 도구 | 비고 |
|------|----------|------|
| Node 격리 | **fnm** + Node 20 + `.nvmrc=20` | system Node 24와 충돌 회피 |
| Python 격리 | **venv** + Python 3.12 (brew) | system 3.9.6은 nanobot >=3.11 요구 미달 |
| deskrpg 설치 | `npm install` + `setup:lite` (수동 SQLite 셋업 — upstream setup-lite.js 경로 버그) | postgres 미사용. `data/deskrpg.db` 자동 생성, 27 테이블 |
| nanobot 설치 | `pip install -e ./nanobot` (editable, 우리 fork 사용) | nanobot-ai 0.1.5.post3 |
| nanobot config | `~/.nanobot/config.json` — OpenRouter + `qwen/qwen3.6-35b-a3b` | seed-v8 D-12 일치 |

### 9.2 검증 시나리오 — 실제 동작 확인

1. ✅ deskrpg dev server (port 3000) — 가입·캐릭터·채널·맵 진입·이동 정상
2. ✅ nanobot gateway (port 8765 WS + 18790 health) — `websocketRequiresToken: false` 설정 필수
3. ✅ Python websockets 클라이언트로 직접 WS 연결 → "hello" 보냄 → Qwen 응답 streaming 수신
4. ✅ 브라우저 NanobotChat 컴포넌트 → WS 연결 → 메시지 송수신
5. ✅ delta event를 stream_id로 누적해 한 줄로 표시 (ChatGPT-style streaming UI)
6. ✅ 첫 메시지에 사용자 컨텍스트(`character.name`, `channel.name`) prepend → nanobot이 응답에 자연스럽게 반영

### 9.3 발견한 함정 (정식 통합 시 주의)

| 함정 | 우회 |
|------|------|
| nanobot `websocket_requires_token` 기본 `True` | config에 `false` 명시 (production은 `true` + token 발급 필요) |
| nanobot이 토큰 단위 delta로 응답 → 줄 단위 표시 시 못생김 | `stream_id`로 누적해 한 줄로 합치기 |
| TokenTrackingHook(0bfbb55)이 `{workspace}/sessions/<channel>_<chat_id>.token.json` 자동 생성 | 정식 통합 시 `LLMUsageRecordHook`를 같이 등록해 SQLite에도 dual write — 코드맵 §4 |
| deskrpg `setup-lite.js`의 ROOT 경로 버그 (`scripts/`로 잘못 계산) | 수동 SQLite 셋업으로 우회. upstream 이슈 보고 안건 |
| better-sqlite3 native binary가 Node 버전 종속 | npm install·실행은 **동일 Node 버전(20)에서만** 수행 |
| 브라우저에서 직접 ws connect 시 nanobot이 origin 검증 X (그러나 401 인증 검증은 함) | allowFrom 와 token 두 가지 분리 — token 끄고 시연 |

### 9.4 Spike 한계 (시연 시나리오 미충족)

본 spike는 "양방향 통신 가능?" 검증만. 다음은 **정식 통합 (M3-M4)에서 구현**:

- 영구 NPC 6명 시드 — T-003
- spawn id 추출 + NPC 매핑 — 팀장 피드백, 코드맵 v2 §6.2 (예정)
- Phaser scene 안 NPC 머리 위 dialog bubble — AC-002 + T-054
- 회의 디지스트 4항목 BR-3 — AC-011 + T-039 (Pair Mode)
- Citation 강제 BR-1 — AC-003 + T-035 (Pair Mode)
- LLMUsageRecord SQLite 추적 + 단계별 임계 — AC-008 + T-027

### 9.5 Spike 산출물 (deskrpg/ 안, RegTrack git 미포함)

- `deskrpg/src/components/NanobotChat.tsx` — 임시 prototype, 정식 통합 시 폐기
- `deskrpg/src/app/game/GamePageClient.tsx` 임시 import 1줄 + JSX 1줄 — 정식 통합 시 제거
- `~/.nanobot/config.json` channels.websocket 섹션 — 정식 통합에선 token 인증 강화

→ spike PR에는 본 문서만 포함. spike 코드는 본인 PC에만 존재.

### 9.6 ⚠ Token 사용 경고 + 종료 명령

**`nanobot gateway` 떠있는 동안 백그라운드 LLM 호출 발생** (cron `dream` 2h, heartbeat 30m). 작업 끝나면 반드시 종료:

```bash
# nanobot gateway 종료 (Linux/macOS)
lsof -ti:8765 | xargs kill

# 또는 모든 spike 프로세스 한 번에
lsof -ti:8765 -ti:3000 -ti:18790 2>/dev/null | xargs -r kill && echo "✓ all stopped"
```

예산 추적은 PRD AC-008 ($30/60/90 단계별). 자세한 OS별 명령·팀원 onboarding은 [SPIKE-SETUP.md](../local-setup/SPIKE-SETUP.md) §8 참조.

---

## 10. M3-M4 정식 통합 진입 시 체크리스트

- [ ] nanobot gateway protocol 안정성 검증 (agent persistence·multi-channel)
- [ ] `gateway_resources` DB schema에 `kind` 필드 추가 + drizzle migration
- [ ] `nanobot-gateway.ts` adapter 작성 (시그니처 매칭)
- [ ] `socket-handlers.ts` 분기 (line 58, 369, 600, 655)
- [ ] `test-gateway/route.ts` 분기 (line 5)
- [ ] OpenClaw 옵션 유지 vs 제거 결정 (PRD scope)
- [ ] 게이트 통과 + PR
- [ ] retro 안건: 본 문서 §5.2의 작업 분량(1-2주) 일정 위치 결정

---

## 11. v3 업데이트 — 3-PR 점진적 전체 통합 로드맵 (2026-05-17)

> §5에서 "M3-M4 in-place 교체 1-2주"라고 추정했으나, 팀장 PR #8(docker-compose-integration.yml) 채택과 nanobot OpenAI-compat `serve` 검증으로 **전략 갱신**.

### 11.1 전략 변경 — OpenAI-compat 1차 채택

| 기존 (v2 §5.2) | v3 |
|----------|------|
| nanobot WS gateway protocol과 OpenClaw 프로토콜 매핑 adapter | **`nanobot serve` (port 8900) OpenAI-compat HTTP API 사용** — adapter 불필요 |
| WebSocket Ed25519 pairing 호환 레이어 필요 | HTTP `/v1/chat/completions` 직접 호출 — pairing 무관 |
| 1-2주 추정 | PR 1: 1~2일 / PR 2: 3~5일 / PR 3: 1주 |

**검증 결과 (2026-05-17)**:
- `nanobot serve --host 0.0.0.0 --port 8900` → `/v1/models`, `/v1/chat/completions` (non-streaming + SSE) 모두 OpenAI 표준 응답 ✓
- Qwen `qwen/qwen3.6-35b-a3b` 응답 한국어 정상
- SSE: `data: {chunk}` + `data: [DONE]` 표준 포맷 → 기존 streaming UI 변경 무 ✓
- ⚠ `usage` 필드 0 (nanobot 한계) → 토큰 추적은 `~/.nanobot/workspace/sessions/*.token.json` (TokenTrackingHook) 사용

### 11.2 핵심 의사결정 — 왜 "전체 통합" 방향이 맞는가

| 근거 | 영향 |
|------|------|
| 팀장 docker-compose-integration.yml에 `openclaw-gateway` 서비스 없음 | 팀 합의 = OpenClaw 폐기 방향 |
| nanobot 하나로 LLM + workspace + TokenTracking 일원화 가능 | 운영 복잡도 ↓, AC-008 토큰 예산 추적 자동화 |
| Ed25519 pairing/디바이스 신원 등 OpenClaw 고유 복잡도 제거 | 신규 팀원 셋업 시간 ↓ |
| Mismatch: OpenClaw는 stateful agent RPC, nanobot OpenAI는 stateless | 영속화는 deskrpg DB 측에서 처리 (단방향 dependency) |

### 11.3 3-PR 분할 로드맵

```
PR 1 (현재, feat/integration-deskrpg-nanobot)
├─ env.ts: AI_PROVIDER, NANOBOT_API_URL, NANOBOT_MODEL
├─ lib/nanobot-client.ts: OpenAI-compat HTTP 클라이언트 (streaming + non-streaming)
├─ lib/nanobot-chat.ts: persona 로드 + history → messages 빌드 + 호출
├─ socket-handlers.ts:
│   ├─ getOrConnectGateway: nanobot 모드면 facade 반환 (channelGatewayBindings 조회 skip)
│   ├─ getNpcConfig/ForChannel: nanobot 모드면 agentId=npc.id
│   ├─ streamNpcResponse: nanobot 분기 → nanobotChatSend (history는 in-memory npcChatHistory)
│   ├─ streamMeetingNpcResponse: nanobot 분기 → nanobotChatSend (meeting 룸 메시지에서 history 빌드)
│   └─ generateMeetingSummary: nanobot 분기 → nanobotChatPlain
├─ api/npcs/route.ts (GET): nanobot 모드면 gateway state 검증 skip
├─ api/npcs/create-agent/route.ts: nanobot 모드면 agents.create/files.set 호출 skip
├─ api/npcs/[id]/route.ts: 동일 (agents.* RPCs no-op)
└─ docker-compose-integration.yml: deskrpg-app에 build context: ./deskrpg

PR 2 (다음 sprint)
├─ Task automation (progress nudge, auto-execution) — runProgressNudgeForTask 이미 PR1에 분기 포함
├─ NPC files 첨부 (regulation 문서 → NPC persona context)
└─ chat_messages DB 영속화 (현재 in-memory map → reload 시에도 보존)

PR 3 (마지막)
├─ Meeting minutes 영속화 정밀화 (meetingMinutes 테이블 활용)
├─ openclaw-gateway.js 코드 제거 + env.ts에서 OPENCLAW_* 삭제
└─ gateway_resources / gatewayShares / channelGatewayBindings 테이블 deprecate
```

### 11.4 R-19 신규 위험 — deskrpg fork sync

| 항목 | 상세 |
|------|------|
| **위험** | deskrpg upstream (dandacompany/deskrpg) commit 진행 시 nanobot 분기 코드와 충돌 |
| **확률 / 영향** | Medium / Medium |
| **완화** | 본 PR 1~3 모두 분기 패턴(`if (isNanobotProvider())`) 유지 → upstream 머지 시 충돌 면적 최소화 |
| **모니터링** | 분기 wrapping을 함수 추출(예: `chatSendUnified`)로 점진 격리 — PR 3에서 |

### 11.5 PR 1 변경 파일 목록 (확정)

| 파일 | 변경 | 비고 |
|------|------|------|
| `deskrpg/src/lib/env.ts` | 3개 env getter 추가 | AI_PROVIDER, NANOBOT_API_URL, NANOBOT_MODEL |
| `deskrpg/src/lib/nanobot-client.ts` | **신규** | OpenAI HTTP 클라이언트 (streaming + 일반) |
| `deskrpg/src/lib/nanobot-chat.ts` | **신규** | persona+history+attachments → messages 빌드 |
| `deskrpg/src/server/socket-handlers.ts` | 6곳 분기 + adapter | nanobot 라우팅 |
| `deskrpg/src/app/api/npcs/route.ts` | gateway state 검증 분기 | GET에서 빈 배열 회피 |
| `deskrpg/src/app/api/npcs/create-agent/route.ts` | agents.* RPC 분기 | nanobot 모드 no-op |
| `deskrpg/src/app/api/npcs/[id]/route.ts` | agents.* RPC 분기 (5곳) | 동일 |
| `docker-compose-integration.yml` | build context + NANOBOT_MODEL env | 우리 fork 빌드 |
| `docs/code-map/DESKRPG-GATEWAY-INTEGRATION.md` | §11 추가 | 본 문서

### 11.6 PR 1 마무리 + PR 1.5 — 실 동작 정착 (2026-05-17)

§11.5는 *계획 시점* 변경 목록. PR 1(`773e51de`) 코드/빌드만으로는 Docker production에서 실 채팅이 두 곳에서 막혀, 두 차례 follow-up으로 봉합.

#### 추가 변경 — 채널 gateway pairing UI 우회 (`f642a781`)
PR 1이 `api/npcs/*` 3개만 다루고 채널 gateway pairing 쪽 3개 route는 누락. nanobot 모드 첫 진입 시 "OpenClaw 게이트웨이를 먼저 저장하세요"에서 막혀 NPC 고용 자체 불가.

| 파일 | 변경 |
|------|------|
| `api/channels/[id]/route.ts` | nanobot 모드면 `hasGateway=true` 강제 |
| `api/channels/[id]/gateway/agents/route.ts` | 빈 agents 배열 |
| `api/channels/[id]/gateway/test/route.ts` | 항상 ok=true |

#### Docker production runtime + nanobot 단일-user 모델 정렬 (`8b5df1e1`)

| 파일 | 변경 |
|------|------|
| `docker-compose-integration.yml` | `3103:3001` publish — socket.io를 host에 노출. `GamePageClient.tsx:189`가 production에서 `currentPort+1`로 붙는 컨벤션 만족 |
| `deskrpg/Dockerfile` | `nanobot-client.js` standalone COPY (Next.js trace 미포함 CommonJS) |
| `deskrpg/server.js` | production CommonJS adapter require + `isNanobotProvider()` 분기 |
| `deskrpg/src/lib/nanobot-client.js` **(신규)** | production runtime. `buildNanobotRequestBody`가 single-user fold + `session_id` |
| `deskrpg/src/lib/nanobot-client.ts` | 동일 패턴을 dev path(TS)에 정렬. `ChatOptions.sessionId` 추가 |
| `deskrpg/src/lib/nanobot-chat.ts` | client-side history 위임 폐기 (caller 호환 위해 필드만 유지). `sessionId` 전달 |
| `deskrpg/src/server/socket-handlers.ts` | `nanobotChatSend` 4 호출 지점에 `sessionId` 추가 (DM / progress nudge / gateway adapter / meeting) |

#### 발견된 contract — nanobot OpenAI-compat의 single-user 제약
- **`nanobot/api/server.py:115`** — `if not isinstance(messages, list) or len(messages) != 1: raise ValueError("Only a single user message is supported")`
- 즉 OpenClaw 패턴 `[system, ...history, user]` 다중 메시지는 항상 **HTTP 400** 응답
- **우회 전략**: client가 `system` 메시지와 마지막 `user` 메시지를 단일 user content로 fold(`[System]\n…\n\n[User]\n…` 형식), body에 `session_id` 필드 추가 → nanobot이 세션별로 history를 server-side 보존
- **영향**: deskrpg는 사용자 메시지마다 history를 재구성·전송할 필요가 없음. `npcChatHistory` in-memory map은 UI 표시(반복 채팅창 렌더링) 용도로만 유지

이 contract는 **PR 2/3 작업 시 회귀 위험**. nanobot upstream을 따라잡을 때 single-user 제약이 풀려도 양립 가능하도록 client 측 fold는 그대로 유지하는 것이 안전.

#### 검증 (수동, 2026-05-17)
- Docker stack 4개 컨테이너 정상 기동: db(healthy) / nanobot-gw / nanobot-api / deskrpg
- 브라우저 http://localhost:3102 — NPC 고용 → 채팅 → Qwen `qwen/qwen3.6-35b-a3b` streaming 응답 ✓
- nanobot API logs: `session_key=api:<sessionKey>`가 NPC별로 격리되어 기록 ✓

#### 부수 발견 (별도 PR 후보)
- `scripts/start.sh`가 `--env-file .env.integration` 미지정. Compose는 같은 디렉토리의 `.env`만 자동 로드하므로 `${POSTGRES_PASSWORD}` 등이 빈 값으로 컨테이너에 주입돼 DB 인증 실패. 팀원 셋업 시 명시적 `--env-file` 사용 가이드 필요. **권장**: `start.sh`에 옵션 추가하는 한 줄 PR.

### 11.7 PR 2a — AC-008 LLM usage widget (2026-05-17)

§11.3 PR 2 로드맵 중 **AC-008 위젯 vertical**만 분리. chat_messages 영속화는 PR 2b, spawn 통합은 PR 2c로 후속.

#### 변경 파일

| Layer | 파일 | 변경 |
|------|------|------|
| Data | `deskrpg/src/db/schema.ts` | `llmUsageRecords` 테이블 추가 (`doublePrecision` cost_usd) |
| Data | `deskrpg/drizzle/0002_llm_usage_records.sql` | 신규 migration (FK→npcs, 2 idx) |
| Data | `deskrpg/src/db/index.ts` | `llmUsageRecords` re-export |
| Logic | `deskrpg/src/app/api/internal/llm-usage/route.ts` **(신규)** | nanobot hook의 POST 수신 → DB insert → socket broadcast forward |
| Logic | `deskrpg/src/app/api/llm-usage/snapshot/route.ts` **(신규)** | 위젯 mount 시 누적 cost/call_count/cache_hit_rate/last_model fetch |
| Logic | `deskrpg/server.js` | `/_internal/emit`에 `room=null` 글로벌 broadcast 분기 추가 (`llm-usage:update` forward용) |
| Presentation | `deskrpg/src/components/LlmUsageWidget.tsx` **(신규)** | 우상단 floating, $30 yellow / $60 orange / $90 red 임계 표시 |
| Presentation | `deskrpg/src/app/game/GamePageClient.tsx` | `<LlmUsageWidget socket={socket} />` 마운트 |
| Integration | `nanobot/nanobot/agent/hook.py` | `LLMUsageRecordHook` 클래스, `_estimate_cost_usd`, `_extract_npc_id` 추가 |
| Integration | `nanobot/nanobot/nanobot.py` + `cli/commands.py` | `_build_default_hooks(workspace_path)` helper — `REGTRACK_INTERNAL_URL` env-gated 등록 |
| Integration | `docker-compose-integration.yml` | nanobot-api에 `REGTRACK_INTERNAL_URL` + `INTERNAL_RPC_SECRET` env 추가 |

#### 설계 원칙

- **TokenTrackingHook(JSON)은 source-of-truth로 유지** — `LLMUsageRecordHook`은 fire-and-forget side-channel. 네트워크 실패해도 토큰 기록 손실 없음.
- **nanobot standalone 영향 zero** — `REGTRACK_INTERNAL_URL`이 없으면 새 hook이 등록되지 않음. fork 충돌 면적 최소화.

#### 로컬 통합 테스트 가이드

```bash
# 1. .env.integration 준비 (이미 있을 것 — POSTGRES_PASSWORD, JWT_SECRET 필요)
# 2. docker stack 기동
docker compose --env-file .env.integration -f docker-compose-integration.yml up -d --build

# 3. DB 마이그레이션 (0002_llm_usage_records.sql) 자동 적용 확인
docker logs reg-detection-deskrpg | grep -i "migrate\|drizzle"

# 4. 브라우저: http://localhost:3102
#    - 우상단에 💰 $0.000 / $100 위젯이 표시되는지 (NONE 임계)
#    - NPC 채팅 1회 → 위젯의 call_count + cost 증가 (socket broadcast)

# 5. nanobot 측 hook 로그 확인
docker logs reg-detection-nanobot-api | grep -i "LLMUsageRecordHook"
# → "LLMUsageRecordHook initialized: endpoint=http://deskrpg-app:3000/api/internal/llm-usage"

# 6. DB 직접 확인 (optional)
docker exec -it reg-detection-db psql -U deskrpg -d deskrpg \
  -c "SELECT npc_id, model, input_tokens+output_tokens AS total, cost_usd, phase FROM llm_usage_records ORDER BY created_at DESC LIMIT 5;"
```

#### 후속

- PR 2b — chat_messages DB 영속화 (in-memory `npcChatHistory` → DB)
- PR 2c — spawn 통합 (NPC 고용 → nanobot agent 자동 생성·위임·결과 알림). NANOBOT-CODEMAP §5의 deskrpg-webhook channel 옵션 Y
- PR 3 — OpenClaw code / UI / gateway_resources 제거. socket-handlers.ts(dev path)도 이 단계에서 deprecate.

### 11.8 PR 2b — chat_messages DB 영속화 (2026-05-18)

§11.3 PR 2 로드맵 중 **in-memory `npcChatHistory` Map → DB 영속화**. PR 2a(LLM 위젯)와 독립 vertical이라 별도 PR로 분리.

#### 변경 파일

| Layer | 파일 | 변경 |
|------|------|------|
| Data | `deskrpg/src/db/server-db.js` | schema에 `chatMessages` 등록 (PG+SQLite 양쪽). 테이블은 기존 `0000_big_karnak.sql`에 이미 존재 — 신규 migration 없음 |
| Data | `deskrpg/src/lib/chat-history.js` **(신규, CJS)** | `loadHistory / appendMessage / resetHistory` 세 함수. role 매핑(in-memory `player`/`npc` ↔ DB `user`/`assistant`)을 라이브러리 안에서 처리 |
| Logic | `deskrpg/server.js` | in-memory `npcChatHistory` Map 제거 + 7 call site DB 호출로 위임 (`npc:chat`/`npc:history`/`npc:reset-chat`/task action/progress nudge) |
| Infra | `deskrpg/Dockerfile` | `chat-history.js` COPY 추가 (Next.js standalone trace 미포함 CJS) |

#### 설계 원칙

- **production server.js만 영속화** — `socket-handlers.ts`(dev path)는 PR3 deprecate 예정이라 손대지 않음 (외과적 변경 원칙)
- **role 매핑은 라이브러리 안에서 처리** — server.js는 in-memory shape(`player`/`npc`) 그대로 두고, `chat-history.js`가 DB 매핑 처리
- **characterId 없는 socket은 silent skip** — 미인증 트래픽 영향 zero

#### 회귀 검증

- 채팅 후 브라우저 새로고침 → 동일 NPC 다시 열면 이전 대화 복원 ✓
- 다른 NPC 열면 자기 대화만 ✓
- DB: `SELECT character_id, npc_id, role, LEFT(content, 40) FROM chat_messages ORDER BY created_at DESC LIMIT 5;`

### 11.9 hotfix/qa-blockers — 3종 봉합 (2026-05-18)

PR 2a/2b 머지 직후 QA 세션에서 surface된 3종 blocker를 1 PR로 번들. 모두 사용자 동작 흐름을 막거나 silent fail로 오해를 유발하는 케이스.

#### 변경 파일

| Layer | 파일 | 변경 |
|------|------|------|
| Logic | `deskrpg/src/lib/task-manager.js` | `nowIso()` (ISO string return) → `dbNow()` (Postgres: Date / SQLite: string). 코드베이스 컨벤션 `isPostgres ? new Date() : new Date().toISOString()` 따름 |
| Logic | `deskrpg/src/lib/task-reporting.ts` | 동일 패턴 `dbNow()` 추가 + write 경로 3곳(`buildQueuedReportRow.createdAt`, `markReportDelivered.deliveredAt`, `markReportConsumed.consumedAt`) 교체. `nowIso()`는 read normalize fallback용으로 유지 |
| Logic | `deskrpg/server.js` | `task:get-report` socket 핸들러 신규 + `getReportsByTaskId` import. `socket-handlers.ts:1643`에만 존재하던 핸들러를 production server.js로 포팅 |
| Presentation | `deskrpg/src/components/ChatPanel.tsx` | `TaskConfirmButtons` 통합 — NpcDialog.tsx와 동일 패턴(`isTaskConfirmPrompt` + 마지막 NPC 메시지 + 스트리밍 종료) |
| Presentation | `deskrpg/src/components/LlmUsageWidget.tsx` | `top-3 right-3` → `bottom-3 right-3` + collapsed badge UI (펼치기/접기 토글) |

#### 봉합 근거

- **task-manager/task-reporting `dbNow()`**: 증상 `TypeError: value.toISOString is not a function` — SQLite 시절 `nowIso()`(ISO string) 코드가 Postgres timestamp 컬럼 INSERT 시 Drizzle PG 드라이버가 `value.toISOString()`을 호출하려다 string에서 폭발. PR 2a 머지 후 처음 노출됨. `task-reporting.ts`의 `@/db` alias import는 server.js 동적 import 환경에서 resolver 부재로 MODULE_NOT_FOUND → `../db/server-db.js` 상대경로로 교체.
- **server.js `task:get-report` 누락**: PR 2b 봉합 패턴(dev↔production 핸들러 불일치)과 동일. socket-handlers.ts dev path에만 있어서 production Docker 환경에서 "보고서 조회 중..." 무한 로딩.
- **ChatPanel TaskConfirmButtons**: 사이드바 chat 컴포넌트가 NpcDialog와 별개라 ✅ 등록 버튼이 사이드바에서만 빠져있었음. 사용자가 NPC 응답 후 "등록할까요?" 봐도 버튼이 안 떠서 텍스트로 "응" 입력 → task 미등록.
- **LLM 위젯 위치**: 기존 `top-3 right-3`이 헤더(AI 연결/회의실/태스크 메뉴)와 겹쳐 클릭 방해. `bottom-3 right-3`로 이동 + collapsed badge UI로 화면 점유 면적 최소화.

#### 회귀 검증

- task 생성 flow: PM 작업 요청 → "등록할까요?" → ✅ 클릭 → `tasks` row INSERT 성공 ✓
- 완료 task 카드 클릭 → 보고서 모달 본문 표시 (이전 무한 로딩) ✓
- 위젯 우하단 표시, badge ↔ 펼침 토글 ✓
- 사이드바 chat에서도 ✅ 버튼 표시 ✓

#### 스코프 외 (별개 PR 후보)

- **nanobot agentic loop**: 일반 지식 요청 시 LLM(qwen 35B)이 web_search tool 호출 시도 → no-tool 환경에서 120s timeout. system prompt 또는 tool config 튜닝 필요. context bloat(`HISTORY_LIMIT_DEFAULT = 200`)도 함께 검토.
- **channel chat 영속화**: NPC chat은 PR 2b로 영속화 완료, channel chat은 아직 in-memory.
