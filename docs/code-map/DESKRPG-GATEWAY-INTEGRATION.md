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

## 9. M3-M4 정식 통합 진입 시 체크리스트

- [ ] nanobot gateway protocol 안정성 검증 (agent persistence·multi-channel)
- [ ] `gateway_resources` DB schema에 `kind` 필드 추가 + drizzle migration
- [ ] `nanobot-gateway.ts` adapter 작성 (시그니처 매칭)
- [ ] `socket-handlers.ts` 분기 (line 58, 369, 600, 655)
- [ ] `test-gateway/route.ts` 분기 (line 5)
- [ ] OpenClaw 옵션 유지 vs 제거 결정 (PRD scope)
- [ ] 게이트 통과 + PR
- [ ] retro 안건: 본 문서 §5.2의 작업 분량(1-2주) 일정 위치 결정
