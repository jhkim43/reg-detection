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

  // ★ 신규 (AC-006)
  metadata: {
    user_id: string (UUID),         // 사용자 user.id — internal endpoint body의 ownerUserId
    character_id: string (UUID),    // 사용자 character.id — internal endpoint body의 assignerCharacterId
    channel_id: string (UUID),
    parent_npc_id?: string (UUID)   // sub-agent의 chat인 경우 parent NPC의 npcs.id
  }
}
```

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

## 변경 이력

- 2026-05-23T16:30:00 — Initial draft (seed-v10 spec phase, T-V06)
- 2026-05-23T17:00:00 — Section 5 (cleanup endpoint) 제거. 사용자 + 다른 팀원 합의로 NPC 삭제 시 nanobot 측 파일은 그대로 유지 (layer 경계 명확성 우선). AC-007 + P-NB03 작업 둘 다 불필요. Section 6 (body.metadata) motivation + 현재 nanobot 코드 상태 + wiring 가이드 보강.
