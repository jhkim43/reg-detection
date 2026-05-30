# Internal Events Contract — nanobot ↔ deskrpg

| 항목 | 값 |
|---|---|
| Status | **Draft (seed-v10 spec phase)** — feedback 환영 |
| Owner (deskrpg) | 본인 |
| Owner (nanobot fork) | 다른 팀원 |
| Source | seed-v10.yaml (AC-001/002/006/007/010) + TRD-RegTrack-2026-05-23-v10-task-push.md (TRD-D-36/37) |
| Created | 2026-05-23 |

본 문서는 **nanobot fork ↔ deskrpg server 간 internal HTTP API contract**의 단일 진실 원천. seed-v10 작업 분담의 contract layer.

---

## 1. 인증

모든 internal endpoint는 단일 secret으로 인증.

```http
POST /api/internal/...
x-deskrpg-internal-secret: ${INTERNAL_RPC_SECRET}
Content-Type: application/json
```

- `INTERNAL_RPC_SECRET`은 deskrpg + nanobot이 같은 값으로 공유 (docker-compose-integration.yml의 `JWT_SECRET` env로 매핑되어 양쪽 컨테이너에 주입)
- secret 누락/불일치 시 모든 endpoint는 `401 unauthorized` 반환
- ❌ `x-user-id` 헤더 불요 — `ownerUserId`는 body로 명시 전달

---

## 2. `POST /api/internal/tasks` (AC-001)

### 용도
nanobot의 agent loop이 tool을 실행하는 lifecycle event(시작/진행/완료/취소)를 deskrpg에 push. deskrpg는 tasks 테이블 row 생성/갱신 + socket broadcast.

### Request body

```typescript
{
  // 필수
  channelId: string (UUID),
  npcId: string (UUID),               // 이 task를 emit한 NPC (또는 sub-agent)의 deskrpg npcs.id
  npcTaskId: string (max 64),         // nanobot 발급 idempotency key — UNIQUE
  title: string (max 200),
  status: "backlog" | "in_progress" | "complete" | "cancelled",  // deskrpg TaskBoard 기존 enum (단수 "complete")
  action: "create" | "update" | "complete" | "cancel",
  assignerCharacterId: string (UUID), // task 의뢰자 (사용자 character)
  ownerUserId: string (UUID),         // 권한 검증용 — channel.ownerId와 일치해야

  // 선택
  summary?: string,
  metadata?: {
    started_at?: string (ISO8601),
    progressing_at?: string,
    completed_at?: string,
    error_message?: string,            // status="cancelled" 시 nanobot이 "user_aborted" 등 명시
    partial_result_summary?: string
  }
}
```

### Action별 동작

| action | 동작 | DB op |
|---|---|---|
| `create` | 새 task row 생성 | `INSERT INTO tasks (..., npc_name_snapshot)` — npcTaskId UNIQUE 충돌 시 onConflictDoUpdate. `npc_name_snapshot`은 npcs.name 캡처 (backlog-1 A: NPC 삭제 후 작업자 attribution 보존) |
| `update` | 진행 상황 갱신 | `UPDATE tasks SET status=$, updatedAt=now() WHERE npcTaskId=$` |
| `complete` | 정상 완료 | `UPDATE tasks SET status='complete', completedAt=now() WHERE npcTaskId=$` |
| `cancel` | 취소 처리 | `UPDATE tasks SET status='cancelled', completedAt=now() WHERE npcTaskId=$` |

모든 action 종료 후 deskrpg는 socket.io로 `task:event` broadcast:

```typescript
socket.to(channelId).emit("task:event", {
  taskId: string,
  npcId: string,
  npcTaskId: string,
  status: string,
  action: string,
})
```

### Response

```typescript
// 201 (create 성공)
{ id: string, status: string, createdAt: string }

// 200 (update/complete/cancel 성공)
{ id: string, status: string, updatedAt: string }

// 401 — internal-secret 누락/불일치
{ errorCode: "unauthorized" }

// 400 — 필수 field 누락
{ errorCode: "missing_required_field", field: string }

// 403 — ownerUserId가 channel.ownerId와 불일치
{ errorCode: "forbidden_channel" }

// 404 — channelId 또는 npcId가 DB에 없음
{ errorCode: "channel_not_found" | "npc_not_found" }

// 409 — npcTaskId 중복 + action!=create/update (충돌 가능 시)
{ errorCode: "task_id_conflict", existing_status: string }
```

### Cancel propagation 흐름 (TRD-D-36 + D-37)

```
사용자 task board "취소" 클릭
   ↓
deskrpg: POST /api/internal/tasks (action=cancel, npcTaskId)
   ↓ (deskrpg 내부, DB op)
deskrpg: tasks.status="cancelled" + completedAt 기록
   ↓ (deskrpg → nanobot)
deskrpg: POST /v1/chat/abort/{session_id} (phase 4.5 endpoint 재사용)
   ↓ (nanobot 내부)
nanobot: _cancel_active_tasks(api:session_id) → in-flight tool cancel (asyncio chain)
   ↓ (nanobot → deskrpg, idempotent — 사용자 측에서 이미 cancelled로 update했어도 push)
nanobot: POST /api/internal/tasks (action=cancel, npcTaskId, error_message="user_aborted")
```

→ deskrpg가 두 번 cancel update 받음 (사용자 측 + nanobot push). DB op는 멱등이라 안전.

---

## 3. `POST /api/internal/npcs` (AC-002 sub-agent create)

### 용도
nanobot agent loop이 자체적으로 child sub-agent를 spawn할 때 deskrpg에 NPC row 생성 요청.

### Request body

```typescript
{
  // 필수
  ownerUserId: string (UUID),         // parent agent를 hire한 사용자의 user.id
  channelId: string (UUID),
  name: string (max 100),
  agentId: string (max 64),           // ★ nanobot이 발급. deskrpg는 그대로 사용
  parentAgentId: string (max 64),     // parent NPC의 agentId (= 사용자가 hire한 일반 NPC)
  identity: string,                   // NPC persona Identity 본문
  soul: string,                       // NPC persona Soul 본문

  // 선택
  appearance?: { ... },               // 미지정 시 deskrpg가 default sprite
  positionX?: number,                 // 미지정 시 parent NPC 근처 자동 배치
  positionY?: number,
  locale?: "ko" | "en" | "ja" | "zh"  // 미지정 시 channel locale
}
```

### 동작

1. 권한 검증: `channel.ownerId == ownerUserId` 또는 channel 멤버
2. parent 존재 검증: 같은 channel에서 `npcs.openclawConfig.agentId == parentAgentId`인 row 존재해야
3. position/appearance default 채우기 (Phase 6 디자인)
4. `INSERT INTO npcs (..., parent_agent_id = body.parentAgentId, ...)` — parent_agent_id는 string
5. `writeNanobotAgentFiles(agentId, [IDENTITY.md, SOUL.md, AGENTS.md])` — mirror 작성
6. socket emit `npc:spawned` → 맵 UI 동적 등장

### Response

```typescript
// 201
{
  npc: {
    id: string (UUID),
    name: string,
    parentAgentId: string,
    openclawConfig: {
      agentId: string,
      sessionKeyPrefix: string,
      personaConfig: { identity: string, soul: string },
      locale: string
    },
    positionX: number,
    positionY: number,
    direction: string
  }
}

// 401 / 403 / 404 (parent NPC 없음) — POST /api/internal/tasks와 동일 shape
```

---

## 4. `DELETE /api/internal/npcs/{id}` (AC-002 sub-agent delete)

### 용도
nanobot이 자체 결정으로 sub-agent를 종료할 때 deskrpg에 NPC 정리 요청.

### Request

```http
DELETE /api/internal/npcs/{npcId}
x-deskrpg-internal-secret: ${INTERNAL_RPC_SECRET}
```

### 동작

1. npcs row 조회 + `agentId` + `channelId` 추출
2. 같은 channel에서 `parent_agent_id == 본 NPC의 agentId` 인 sub-agent 자식들 재귀 삭제 (application layer cascade)
3. `DELETE FROM npcs WHERE id=$` — PostgreSQL FK 처리:
   - **chat_messages**: ON DELETE CASCADE (관련 채팅 함께 삭제)
   - **tasks**: ON DELETE **SET NULL** (backlog-1 A) — task row 생존, npc_id만 NULL. UI는 `npc_name_snapshot` fallback으로 작업자 라벨 유지
   - **nanobot_agent_sessions**: ON DELETE CASCADE (session FK 정리)
4. `deleteNanobotAgentWorkspace(agentId)` — deskrpg 측 mirror 정리
5. socket emit `npc:deleted` → 맵 UI 동적 제거

### Response

```typescript
// 200
{ success: true, deletedCount: number /* 자기 + sub-agent 자식들 */ }

// 401 / 404 (npc 없음)
```

---

## 5. NPC 삭제 시 nanobot 측 파일 cleanup — **하지 않음 (2026-05-23 결정)**

### 정책

deskrpg에서 NPC를 삭제해도 **nanobot 측 파일(`~/.nanobot/api-workspace/sessions/*` + `~/.nanobot/workspace-{agentId}/`)은 그대로 유지**한다.

### 이유 (사용자 + 다른 팀원 합의)

- nanobot의 sessions/workspace는 nanobot agent loop의 working set + 자체 운영 history
- deskrpg가 외부에서 그 file system을 정리하는 것은 **layer 경계 침범** — deskrpg는 nanobot 내부 구현 모름
- 사용자 NPC 삭제는 **deskrpg 측 정리**만 의미 (chat_messages cascade, mirror dir cleanup, DB row 삭제)
- nanobot 측 파일은 nanobot이 자체 lifecycle로 관리 (운영자 수동 또는 future cron sweep)

### deskrpg 측 동작 (확정)

```
NPC 삭제 (deskrpg):
  ✅ PostgreSQL chat_messages CASCADE / nanobot_agent_sessions CASCADE
  ✅ tasks는 SET NULL — task row 살아남고 npc_id만 NULL. UI는 npc_name_snapshot fallback (backlog-1 A)
  ✅ deskrpg 컨테이너 내 workspace-{agentId}/ mirror 정리 (T-F03 deleteNanobotAgentWorkspace)
  ❌ nanobot 컨테이너 내 api-workspace/sessions/* — 미정리 (nanobot 자체 lifecycle)
  ❌ nanobot 컨테이너 내 workspace-{agentId}/ — 미정리 (nanobot 자체 lifecycle)
```

→ AC-007 (`postNanobotAgentCleanup`) **제거**. nanobot 측에 `/v1/agents/{agentId}/cleanup` endpoint 신설도 **불필요**.

### Trade-off (수용)

- nanobot sessions/ 파일이 NPC 삭제 후에도 잔존 — 운영 위생 차원의 디스크 누수 가능
- 그러나 layer 경계 명확성이 우선. nanobot 측 정리는 future cron sweep (seed-v10 `non_blocking_backlog` v10-backlog-3 참조) 또는 운영자 수동.

---

## 6. chatSend body.metadata (AC-006)

### 왜 필요한가 (motivation)

nanobot이 deskrpg internal API(`/api/internal/tasks`, `/api/internal/npcs`)를 호출할 때 body에 **`ownerUserId`, `channelId`, `assignerCharacterId` 필수** (권한 검증·DB op 식별자). 그러나 nanobot은 그 값을 어떻게 알 수 있는가?

기존 방식 (현재 sessionKey 패턴):
```
session_id = "ot-{channelId8}-{agentId}-dm-{userUUID}"
                                          ↑
                                user 정보가 string에 임베드되어 있음
```

→ parsing으로 추출은 가능하지만 brittle:
- type별 패턴 다름 (`dm` vs `meeting-meet-{ts}` vs `poll-meet-{ts}`)
- userUUID에 hyphen이 있어 단순 split 어려움
- channelId는 prefix 8자만 → 전체 UUID 추출 불가
- characterId는 sessionKey에 없음

해결: **body.metadata 필드로 structured 명시 전달**.

### deskrpg → nanobot body 확장

기존 `POST /v1/chat/completions` body에 `metadata` field 추가:

```typescript
{
  model: "qwen/qwen3.6-35b-a3b",
  messages: [{ role: "user", content: "..." }],
  session_id: "ot-{ch8}-{agentId}-dm-{userUUID}",
  stream: true,

  // ★ 신규 (AC-006), 2026-05-30 npc_id 추가
  metadata: {
    user_id: string (UUID),         // 사용자 user.id — internal endpoint body의 ownerUserId
    character_id: string (UUID),    // 사용자 character.id — internal endpoint body의 assignerCharacterId
    channel_id: string (UUID),
    parent_npc_id?: string,         // openclawConfig.agentId 문자열 (예: "Supervisor", "pm-a")
                                    // — internal-npc-handler.findParentNpc가 이걸로 매칭
    npc_id?: string (UUID)          // 현재 chat 대상 NPC의 npcs.id (DB row PK)
                                    // — 2026-05-30 nanobot 팀원 요청. session 식별 시 사용
  }
}
```

`parent_npc_id` vs `npc_id` 차이:
- `parent_npc_id`: nanobot agent loop의 self-식별자 (string, openclawConfig.agentId)
- `npc_id`: deskrpg DB의 npc row의 PK (UUID, npcs.id)
- 둘은 다른 식별자 — sub-agent flow에서 parent에 대해 동일 값이지만 형식이 다름

### 현재 nanobot 코드의 metadata 처리 상태

| Layer | 상태 |
|---|---|
| `nanobot/api/server.py` (HTTP API) | ❌ `body.get("metadata")` 호출 없음 — 현재 무시됨. **다른 팀원이 wiring 추가 필요** |
| `nanobot/agent/loop.py` (agent context) | ✅ metadata 인프라 **이미 존재** (`process_direct(metadata=...)` 시그니처, `self._metadata` 저장 등) |

→ 다른 팀원이 server.py에 ~10줄 wiring 추가하면 즉시 활용 가능:

```python
# nanobot/api/server.py — handle_chat_completions 안 (예시)
session_metadata = body.get("metadata") or {}
# ...
response = await agent_loop.process_direct(
    content=text,
    session_key=session_key,
    channel="api",
    chat_id=API_CHAT_ID,
    metadata=session_metadata,  # ← 신규
    on_stream=_on_stream,
    on_stream_end=_on_stream_end,
)
```

### nanobot 측 처리 흐름 (다른 팀원 작업)

1. chat 요청 받을 때 `body.metadata`를 session 메모리(또는 agent context `_metadata`)에 저장
2. tool execution 시점에 `/api/internal/tasks` POST body에 그 metadata 풀어서 forward:
   - `metadata.user_id` → `body.ownerUserId`
   - `metadata.character_id` → `body.assignerCharacterId`
   - `metadata.channel_id` → `body.channelId`
3. sub-agent spawn 시점에 `/api/internal/npcs` body에:
   - `metadata.user_id` → `body.ownerUserId`
   - `metadata.channel_id` → `body.channelId`
   - parent NPC의 agentId → `body.parentAgentId` (nanobot 자체 추적)

### 호환성

`body.metadata`는 **선택 필드** — deskrpg 구버전이 metadata 안 보내도 nanobot은 그냥 빈 dict로 처리. 점진적 도입 가능.

---

## 7. 인증 secret 공유

```yaml
# docker-compose-integration.yml
nanobot-api:
  environment:
    - INTERNAL_RPC_SECRET=${JWT_SECRET}
    - REGTRACK_INTERNAL_URL=http://deskrpg-app:3000

deskrpg-app:
  environment:
    JWT_SECRET: ${JWT_SECRET}
    # JWT_SECRET을 INTERNAL_RPC_SECRET으로도 활용 — internal-transport.js의 getInternalSecret 참조
```

`INTERNAL_RPC_SECRET` 환경변수 = 동일 값 (`.env.integration`의 `JWT_SECRET`).

검증 패턴 (deskrpg 측):

```typescript
import { isInternalRequestAuthorized } from "@/lib/internal-transport";

export async function POST(req: NextRequest) {
  if (!isInternalRequestAuthorized(req.headers)) {
    return NextResponse.json({ errorCode: "unauthorized" }, { status: 401 });
  }
  // ...
}
```

---

## 8. ToolExecutionEvent stable shape (참고)

nanobot이 emit하는 모든 event는 다음 normalized shape 따름 (deskrpg 측 `/api/internal/tasks` body로 매핑):

```typescript
type ToolExecutionEvent = {
  event_type: "task",
  action: "create" | "update" | "complete" | "cancel",
  status: "backlog" | "in_progress" | "complete" | "cancelled",  // deskrpg TaskBoard 기존 enum (단수 "complete")
  
  // task 식별
  npc_id: string,                    // 어느 NPC가 emit?
  npc_task_id: string,               // idempotency key
  
  // task 내용
  title: string,
  summary?: string,
  
  // metadata
  user_id: string,
  character_id: string,
  channel_id: string,
  timing: {
    started_at?: string (ISO8601),
    progressing_at?: string,
    completed_at?: string
  },
  error_message?: string             // cancel 시 "user_aborted" 등
}

type SubAgentEvent = {
  event_type: "sub_agent",
  action: "spawn" | "delete",
  
  // sub-agent 식별
  agent_id: string,                  // nanobot 발급
  parent_agent_id: string,
  
  // spawn 시
  name?: string,
  identity?: string,
  soul?: string,
  
  // metadata
  user_id: string,
  channel_id: string
}
```

nanobot 측에서 이 shape으로 normalize 후 deskrpg endpoint 호출.

---

## 9. 동시 작업 가능성

본 contract가 안착되면 deskrpg + nanobot 작업이 **완전히 parallel** 가능:

| 본인 (deskrpg) | 다른 팀원 (nanobot fork) |
|---|---|
| AC-001: `/api/internal/tasks` route + handler + test | P-NB01: agent loop emission hook + task push |
| AC-002: `/api/internal/npcs` route + handler + test | P-NB02: sub-agent spawn/delete push |
| AC-005: `parent_agent_id` migration | (대기 — AC-005 머지 후 P-NB02 활성화) |
| AC-006: chatSend metadata 전달 (request side) | P-NB04: server.py에 body.metadata wiring + session 저장 + forward |
| ~~AC-007: cleanup~~ — **제거됨** | ~~P-NB03~~ — **불요** (NPC 삭제해도 nanobot 측 파일 유지) |
| (없음) | P-NB05: cancel 후 status=cancelled push |

→ 본 PR 머지 후 다른 팀원이 P-NB01 시작 가능 (`/api/internal/tasks` endpoint가 본 PR에 함께 신설되면 즉시 통합 테스트 가능).

---

## 10. Feedback

본 contract는 draft 상태. 다른 팀원의 nanobot fork 구현 경험상 발생하는 의문/제안은:
- 본 문서 직접 수정 → PR (의미 있는 변경은 seed-v11 cycle에서 진화)
- 또는 `.harness/ouroboros/interviews/2026-05-19-seed-v10-candidates.md` 의 변경 이력에 명시

---

## 11. `POST /api/internal/chat-push` (AC-008 chat push)

### 용도

sub-agent가 백그라운드에서 작업 완료 후 결과를 parent NPC chat(supervisor 등)에 자동으로 표시하기 위한 push endpoint. **deskrpg-side: phase5 v1 구현 완료. nanobot-side: 별도 PR로 진행.**

### Motivation

| 경로 | 동작 |
|---|---|
| **텔레그램** (nanobot-gw native loop) | sub-agent 완료 시 nanobot이 outbound message를 parent session에 자동 inject → 사용자에게 자동 표시 ✅ |
| **deskrpg api** (`/v1/chat/completions`) | nanobot이 본 endpoint 호출 → deskrpg가 socket broadcast → 클라이언트 ChatPanel listener가 받아 화면에 표시 ✅ |

기대 UX: 사용자가 supervisor에게 "백그라운드에서 리서치하고 보고해" 요청 → 잠시 후 supervisor가 자율적으로 "리서치 완료, 결과는 ..." 메시지 추가 표시.

### Request body

```typescript
{
  // 필수
  session_key: string;       // nanobot parent session key. e.g. "ot-247148b5-Supervisor-dm-6060c836-..."
                             //   deskrpg는 prefix 의존 0 — channel_id/npc_id를 body 명시값으로만 사용 (결정 1).
  channel_id: string;        // UUID, deskrpg channels.id
  npc_id: string;            // UUID, deskrpg npcs.id of the speaking NPC (parent)
  message: string;           // 사용자에게 보일 자연어 텍스트

  // 선택
  kind?: "subagent_report" | "subagent_progress" | "scheduled_reminder";
  // 어떤 종류의 push인지. 클라이언트 표시 모드 분기에 사용 (결정 2: 3개로 고정,
  // 확장은 future PR).

  subagent_id?: string;      // 완료/진행 보고 시 어느 sub-agent의 결과인지
  subagent_label?: string;   // UI 표시용 prefix (e.g. "[리서치담당] " — 결정 3)
  task_npc_task_id?: string; // 연결된 task가 있으면. /api/internal/tasks와 join 가능
  metadata?: Record<string, unknown>;  // free-form (sources, timestamps 등)
}
```

### Headers

```http
x-deskrpg-internal-secret: ${INTERNAL_RPC_SECRET}     // 필수
Idempotency-Key: <nanobot-issued-unique-id>           // 선택 — 중복 push 회피용
```

### Response

```typescript
// 성공
201 { persisted_message_id: string (UUID) }

// 실패 (errorCode 표준)
401 { errorCode: "unauthorized" }
400 { errorCode: "missing_required_field", field: string }
400 { errorCode: "invalid_json" | "invalid_body" }
404 { errorCode: "channel_not_found" }
404 { errorCode: "npc_not_found" }                    // npc.channelId가 body.channel_id와 불일치인 경우도 포함
409 { errorCode: "duplicate_message" }                // 같은 Idempotency-Key가 최근 10분 내 들어옴
500 { errorCode: "internal_error" }                   // socket emit 실패 등
```

### deskrpg-side 처리 흐름 (구현된 동작 — phase5 v1)

1. `x-deskrpg-internal-secret` 검증
2. body parse + snake_case → camelCase 정규화 (`session_key` → `sessionKey` 등)
3. 필수 필드 validation (`session_key`/`channel_id`/`npc_id`/`message` 비어있으면 400)
4. Idempotency-Key 헤더가 있고 최근 10분 내 같은 키가 들어왔다면 `409 duplicate_message`
5. `channels.id == channel_id` 조회 → 없으면 `404 channel_not_found`
6. `npcs.id == npc_id` 조회 → 없거나 `npc.channelId != channel_id`이면 `404 npc_not_found`
7. `randomUUID()`로 `persisted_message_id` 생성 → socket emit `npc:push-message`:
   ```ts
   io.to(channelId).emit("npc:push-message", {
     messageId, npcId, message, kind, subagentId, subagentLabel,
     taskNpcTaskId, metadata,
   })
   ```
8. 정상이면 Idempotency-Key를 in-memory cache에 저장 (TTL 10분) + `201 { persisted_message_id }`

### 클라이언트 표시 (결정 3 — 일반 chat history append)

- `socketInstance.on("npc:push-message", payload)` listener
- `payload.npcId === 현재 dialog NPC`인 경우만 `npcMessages` state에 append
- `subagent_label`이 있으면 `"[리서치담당] " + message` 형태로 prefix
- 별도 system message UI 모드 분기는 추가 안 함 (확장 시 `payload.kind` 활용)

### Idempotency (구현 디테일)

- `Idempotency-Key` 헤더 → handler의 in-memory `Map<string, { messageId, expiresAt }>` cache
- TTL: 10분 고정 (`IDEMPOTENCY_TTL_MS = 10 * 60 * 1000`)
- process restart 시 cache 비워짐 — sub-agent 완료 보고는 짧은 시간 창의 중복만 회피하면 충분, 장기 영속성 불필요
- nanobot 측 권장 key 형식: `subagent-{subagent_id}-completed-{timestamp}` 또는 `chat-push-{uuid}`

### chat_messages 영속화 (phase5 v1 의도적 제외)

현재 `chat_messages` schema가 `characterId NOT NULL`이라 push 시점 character를 모름 (sub-agent는 character 무관). 영속 저장은 추후 phase에서 schema 변경(예: `characterId nullable` 또는 `channelId` column 추가) 후 처리. **phase5 v1에서는 socket emit only** — 페이지 reload 시 push 메시지는 휘발됨.

### nanobot-side 호출 위치 (가이드)

- `nanobot/agent/subagent.py` SubagentManager의 완료 hook (성공/실패 모두)
- `nanobot/api/server.py` handle_chat_completions의 single-turn 반환 후 sub-agent가 background로 남아 있는 경우 별도 finalization push

### 구현 작업 분담

| 항목 | 담당 | 상태 |
|---|---|---|
| `POST /api/internal/chat-push` route + handler | deskrpg (본인) | ✅ phase5 v1 |
| `npc:push-message` socket emit | deskrpg (본인) | ✅ phase5 v1 |
| 클라이언트 `npc:push-message` listener + ChatPanel 표시 | deskrpg (본인) | ✅ phase5 v1 |
| `chat_messages` schema 변경 + 영속화 | deskrpg | 별도 phase |
| `SubagentManager` 완료 hook → notify_deskrpg_chat_push | nanobot 팀원 | 별도 PR |
| Idempotency-Key 생성 | nanobot 팀원 | 별도 PR |

### 결정 사항 (draft → v1 확정)

1. **session_key parsing 의존도 = 0** — body의 `channel_id`/`npc_id`만 신뢰. session_key는 식별자/로그용으로만 전달 (parsing 안 함, fallback 안 함)
2. **kind enum = 3개 고정** — `subagent_report` / `subagent_progress` / `scheduled_reminder`. 확장(`meeting_followup`, `external_event` 등)은 future PR에서 추가
3. **클라이언트 표시 위치 = 일반 chat history append** — `npc:history-append`와 동일 패턴. 별도 system message UI는 미적용. `subagent_label`로 발화자 식별

---

## 12. `POST /api/internal/reports` (seed-v11 AC-002, Claude Artifacts 스타일 보고서 push)

### 용도

sub-agent 또는 main agent가 분석·요약·리포트 형태로 **본문 큰 마크다운 결과물**을 사용자의 보고서 패널(ReportPanel)에 push할 때 호출. Section 11 chat-push와는 별 트랙:

| | chat-push (§11) | reports (§12) |
|---|---|---|
| 본문 크기 | 짧은 한 줄 (~수십 자) | 큰 마크다운 (~수 KB) |
| 저장 위치 | `chat_messages` | `agent_reports` (별 테이블) |
| UI 표시 | 채팅 메시지 (`[리서치담당] ...` prefix) | 우측 ReportPanel (sanitize markdown 렌더) |
| socket event | `npc:push-message` | `agent-report:ready` |
| 영속화 | v10 phase6 완료 | v11 phase1 완료 |
| 용도 | 진행 알림 | 완성된 결과물 |

### Request

```http
POST /api/internal/reports
x-deskrpg-internal-secret: ${INTERNAL_RPC_SECRET}
Idempotency-Key: report-<id>-<timestamp>        # (선택) 중복 push 회피, TTL 10분 in-memory
Content-Type: application/json

{
  "channel_id": "<uuid>",
  "npc_id": "<uuid>",                            # parent NPC (Supervisor 등). sub-agent 자신 아님
  "character_id": "<uuid>",                      # 보고서 소유자 (사용자의 character)
  "title": "주간 매물 분석",                     # 선택
  "body_markdown": "## 요약\n...",               # 자유 마크다운 (GFM 지원, sanitize는 클라이언트 렌더 시점)
  "creator_sub_agent_label": "리서치담당",       # 선택 — 작성자 sub-agent 표시명 snapshot
  "metadata": { "any": "free-form jsonb" }       # 선택
}
```

### Response

| status | body | 의미 |
|---|---|---|
| `201` | `{ "persisted_report_id": "<uuid>" }` | 정상 — agent_reports row 영속 + `agent-report:ready` socket broadcast 완료 |
| `400` | `{ "errorCode": "missing_required_field", "field": "<name>" }` | `channel_id`/`npc_id`/`character_id`/`body_markdown` 중 하나 누락 또는 빈 문자열 |
| `400` | `{ "errorCode": "invalid_json" }` | body가 valid JSON 아님 |
| `401` | `{ "errorCode": "unauthorized" }` | `x-deskrpg-internal-secret` 누락 또는 불일치 |
| `404` | `{ "errorCode": "channel_not_found" }` | `channel_id`가 DB에 없음 |
| `404` | `{ "errorCode": "npc_not_found" }` | `npc_id`가 DB에 없거나 NPC의 channel_id가 요청 channel_id와 불일치 |
| `404` | `{ "errorCode": "character_not_found" }` | `character_id`가 DB에 없음 |
| `409` | `{ "errorCode": "duplicate_message" }` | 같은 Idempotency-Key로 10분 내 재호출 |
| `500` | `{ "errorCode": "internal_error" }` | DB insert 실패 또는 socket emit 실패 (emit 실패 시에도 row는 영속됨 — TRD-D-41) |

### Handler 동작 흐름

1. `x-deskrpg-internal-secret` 검증 → 401
2. body JSON parse → 400 invalid_json
3. wire snake_case → 내부 camelCase 정규화
4. 필수 필드 4개 (`channelId`/`npcId`/`characterId`/`bodyMarkdown`) 비어있지 않음 검사 → 400 missing_required_field
5. Idempotency-Key cache 검사 (in-memory TTL 10분) → 409 duplicate_message
6. `channels.id == channel_id` → 없으면 404 channel_not_found
7. `npcs.id == npc_id` + `npc.channelId == channel_id` 일치 → 미일치 시 404 npc_not_found
8. `characters.id == character_id` → 없으면 404 character_not_found
9. `agent_reports` row insert (metadata에 `creatorSubAgentLabel` + `channelIdSnapshot` snapshot 합쳐 보존)
10. socket emit `agent-report:ready` (room=channelId):
    ```ts
    io.to(channelId).emit("npc:report-ready", {
      reportId, npcId, channelId, title, creatorSubAgentLabel, createdAt,
    })
    ```
11. Idempotency-Key cache 채우기 (있는 경우) + `201 { persisted_report_id }`

### npc_id 결정 규칙 (D-33)

`npc_id`는 **parent NPC**의 deskrpg UUID. sub-agent 자기 자신이 아님. 이유:
- 사용자가 직접 대화하는 건 main agent (Supervisor). sub-agent는 hidden background actor.
- UI 패널 filter가 `currentNpcId` 기준 (`agent_reports.npc_id = currentNpc.id`)이라 sub-agent npc_id로 저장하면 패널에 안 보임.
- nanobot 측은 v10 phase3에서 깔린 session metadata의 `parent_npc_id`를 그대로 사용.
- 작성자 sub-agent 식별은 `creator_sub_agent_label` snapshot으로 라벨링.

### 클라이언트 표시 (D-34 / D-36)

`socketInstance.on("npc:report-ready", payload)` listener — 두 분기:
- `payload.npcId === currentNpcId` → **ReportPanel slide-in** (refetch + slideIn 트리거)
- `payload.npcId !== currentNpcId` → 채팅 영역 위 **토스트** `"{creatorSubAgentLabel || npcName}가 보고서를 올렸어요"` (클릭 시 NPC 전환 + 패널 갱신)

새로고침 후 보고서 영속 — `GET /api/reports?npcId={currentNpc}&limit=1`로 ReportPanel이 자연 복원.

### `GET /api/reports` (user-auth fetch — v11 AC-008)

ReportPanel mount 시 + HistoryModal 열 때 클라이언트가 직접 호출:

```http
GET /api/reports?npcId=<uuid>&limit=1
x-user-id: <session user uuid>
```

- 인증: `x-user-id` 헤더 (v10 user-auth 패턴 재사용)
- `npcId` 미지정 → character의 전체 보고서 (HistoryModal용)
- `limit` 미지정 → 50 (max 50으로 clamp)
- 응답:
  ```json
  {
    "reports": [{
      "id": "<uuid>",
      "characterId": "<uuid>",
      "npcId": "<uuid> | null",
      "title": "string | null",
      "bodyMarkdown": "string",
      "metadata": { ... },
      "createdAt": "ISO8601",
      "creatorNpcName": "string | null (npc 삭제 시 null)",
      "creatorSubAgentLabel": "string | null (metadata snapshot)"
    }]
  }
  ```

### Idempotency

- 헤더 형식: `Idempotency-Key: report-<id>-<timestamp>` 권장
- TTL: 10분 in-memory cache (process restart 시 비워짐)
- nanobot 측은 SubagentManager 완료 hook에서 `report-{report_session_id}-completed-{ts}` 형태로 생성

### chat_messages와의 책임 분리 (D-37)

`agent_reports`는 새 테이블. 본문 크기·검색 패턴·생명주기가 chat 한 줄과 크게 다르므로 `chat_messages.kind='report'` 식 재활용 안 함. 책임 분리가 유지보수에 결정적.

### nanobot-side 호출 위치 (가이드)

- `nanobot/agent/subagent.py` SubagentManager의 **완료 시점** (성공 시 — 실패 시는 §11 chat-push가 더 적합)
- main agent의 명시적 `report` tool 호출 시 (LLM이 보고서 생성 의도 표명한 경우)

### 구현 작업 분담

| 항목 | 담당 | 상태 |
|---|---|---|
| `agent_reports` schema + 0009 migration | deskrpg (본인) | ✅ v11 phase1 |
| `internal-report-handler.ts` Logic + 단위 테스트 | deskrpg (본인) | ✅ v11 phase1 |
| `report-list-service.ts` Logic + 단위 테스트 | deskrpg (본인) | ✅ v11 phase1 |
| `POST /api/internal/reports` route + 통합 테스트 | deskrpg (본인) | ✅ v11 phase2 |
| `GET /api/reports` route + 통합 테스트 | deskrpg (본인) | ✅ v11 phase2 |
| `agent-report:ready` socket emit | deskrpg (본인) | ✅ v11 phase2 (route 통합) |
| 클라이언트 ReportPanel + HistoryModal + socket listener | deskrpg (본인) | v11 phase3/4 |
| `SubagentManager` 완료 hook → notify_deskrpg_report | nanobot 팀원 | 별도 PR |
| Idempotency-Key 생성 | nanobot 팀원 | 별도 PR |

### 결정 사항 (v1)

1. **테이블 분리** — `agent_reports` 별 테이블 (D-37). 기존 `npc_reports` (task queue, 0000_big_karnak.sql)와 도메인 다름.
2. **scope** — Character 주 + NPC 참조 nullable (D-32). NPC 삭제돼도 보고서 보존, metadata snapshot으로 fallback.
3. **lifecycle** — 단발성 push (D-35). PATCH 미지원 (future).
4. **본문 형식** — 자유 마크다운 + 렌더 시점 sanitize (react-markdown + rehype-sanitize, D-31). raw HTML 금지.
5. **패널 동작** — 현재 NPC의 최신 1건 (D-34). 다른 NPC 보고서 도착 시 토스트 (D-36).
6. **본문 크기 제한** — 없음 (MVP, YAGNI). 운영 이슈 시점에 추가.

---

## 변경 이력

- 2026-05-23T16:30:00 — Initial draft (seed-v10 spec phase, T-V06)
- 2026-05-23T17:00:00 — Section 5 (cleanup endpoint) 제거. 사용자 + 다른 팀원 합의로 NPC 삭제 시 nanobot 측 파일은 그대로 유지 (layer 경계 명확성 우선). AC-007 + P-NB03 작업 둘 다 불필요. Section 6 (body.metadata) motivation + 현재 nanobot 코드 상태 + wiring 가이드 보강.
- 2026-05-27 — Section 11 (chat-push endpoint, planned) draft 추가. sub-agent 비동기 완료 결과를 parent session에 push하기 위한 신규 endpoint. deskrpg + nanobot 양쪽 동시 구현 필요. seed-v10 phase4 T-V-spec.
- 2026-05-27 — Section 11 draft → v1 finalize (seed-v10 phase5 T-V34). 미결정 사항 3개 모두 결론 (session_key parsing=0, kind 3개 고정, 일반 chat history append). deskrpg-side 구현 완료 표시 (route/handler/socket emit/클라이언트 listener). chat_messages 영속화는 의도적 제외 (현 schema characterId NOT NULL 이슈 — 별도 phase). nanobot 팀원이 본 spec 따라 SubagentManager 완료 hook + Idempotency-Key 생성 추가하면 end-to-end 완성.
- 2026-05-30 — Section 12 (reports endpoint) 신설. seed-v11 AC-002 — Claude Artifacts 스타일 본문 큰 마크다운 보고서 push. `agent_reports` 별 테이블 + `POST /api/internal/reports` (internal-secret) + `GET /api/reports` (user-auth). socket event `agent-report:ready`. §11 chat-push와는 책임 분리 (한 줄 알림 vs 본문 큰 결과물). deskrpg-side phase1 (Data+Logic) + phase2 (Presentation API) 완료. UI (ReportPanel/HistoryModal)는 phase3/4. nanobot 팀원이 본 spec 따라 SubagentManager 완료 시점에 push.
