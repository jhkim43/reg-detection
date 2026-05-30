# DeskRPG Interface — Nanobot ↔ DeskRPG Sync Channel

> **목적**: nanobot subagent lifecycle 이벤트(생성, 진행, 완료, 삭제)를 DeskRPG frontend에 실시간 동기화하는 인터페이스 명세.
>
> **관련 파일**:
> - `nanobot/utils/deskrpg_client.py` — 순수 HTTP client (모든 DeskRPG API 호출 담당)
> - `nanobot/channels/deskrpg.py` — DeskRPG sync channel (gateway 프로세스용, 선택적)
> - `nanobot/agent/tools/spawn.py` — SpawnTool (NPC 생성 + task create)
> - `nanobot/agent/subagent.py` — SubagentManager (checkpoint/완료 sync)
> - `nanobot/agent/loop.py` — AgentLoop (metadata → SpawnTool context 전달)
> - `nanobot/api/server.py` — API server (HTTP body metadata 파싱)
> - `docs/api/internal-events-curl-guide.md` — DeskRPG internal API 규격

---

## 1. 아키텍처 원칙

1. **DeskRPG sync는 DeskRPGClient 직접 호출** — `SpawnTool`과 `SubagentManager`가 `bus.publish_outbound()` 대신 `DeskRPGClient`를 직접 호출. 이유: `nanobot-api` 프로세스에는 `ChannelManager._dispatch_outbound()`가 없어서 bus publish가 silent drop됨.
2. **DeskRPG channel(`deskrpg.py`)은 gateway 프로세스용** — `ChannelManager`가 있는 `nanobot-gateway`에서는 bus 기반 dispatch도 동작하지만, API 서버는 직접 호출.
3. **Best-effort, non-blocking** — 모든 HTTP 호출은 실패 시 로깅만 하고 main flow는 계속 진행.
4. **npc_task_id는 subagent_id로 통일** — `SpawnTool.execute()`에서 생성한 `subagent_id`(예: `sub_aba21459`)를 모든 DeskRPG task API 호출에 사용.

---

## 2. 전체 데이터 흐름

```
deskrpg app ──POST /v1/chat/completions──→ nanobot API server
                                                 │
                                           metadata 파싱
                                           (user_id, channel_id, character_id,
                                            parent_npc_id, npc_id)
                                                 │
                                                 ▼
                                          AgentLoop._set_tool_context()
                                                 │
                                    parent_npc_uuid, character_id 전달
                                                 │
                                                 ▼
                                          SpawnTool.execute()
                                            │            │
                                            ▼            ▼
                                     DeskRPGClient   SubagentManager
                                     .create_npc()   .spawn(deskrpg_meta)
                                     → POST /npcs         │
                                     → npc_id 반환   _run_subagent()
                                     → push_task()        │
                                       (create)      [checkpoint 3회마다]
                                                          DeskRPGClient.push_task()
                                                          (update)
                                                          │
                                                          ▼
                                                   _announce_result()
                                                      │          │
                                                      ▼          ▼
                                              bus.publish    DeskRPGClient
                                              (inbound,      ├─ .chat_push()
                                               channel=      ├─ .push_task(complete)
                                               "system")     └─ .delete_npc()
```

### 2.1 Subagent 생성 흐름 (SpawnTool.execute)

```
1. DeskRPG routing context 추출
   (owner_user_id, channel_id, parent_agent_id, character_id, parent_npc_uuid)

2. subagent_id = f"sub_{uuid4.hex[:8]}"

3. DeskRPGClient.create_npc()
   → POST /api/internal/npcs
   → 응답: {"npc": {"id": "deskrpg-uuid", ...}}
   → npc_id 저장

4. DeskRPGClient.push_task(action="create")
   → POST /api/internal/tasks (assignerCharacterId, ownerUserId 포함)

5. SubagentManager.spawn(deskrpg_meta={...})
   → SubagentStatus.deskrpg_meta에 metadata 저장 (lifecycle全程 유지)
```

### 2.2 Subagent 진행 중 흐름 (checkpoint callback)

```
AgentRunner가 iteration마다 checkpoint_callback 호출
  → _on_checkpoint()에서 status.iteration 갱신
  → iteration % 3 == 0 이면:
    → DeskRPGClient.push_task(action="update", ownerUserId 포함)
    → NPC ID와 subagent_id 그대로 재사용
```

### 2.3 Subagent 완료 흐름 (_announce_result)

```
1. bus.publish_inbound(channel="system")   ← main agent loop 전달 (기존)

2. DeskRPGClient.chat_push()
   → POST /api/internal/chat-push
   → npc_id = parent_npc_uuid (deskrpg DB npcs.id UUID)
   → parent_npc_uuid 없으면 graceful skip

3. DeskRPGClient.push_task(action="complete"/"cancel")
   → POST /api/internal/tasks (assignerCharacterId, ownerUserId 포함)

4. DeskRPGClient.delete_npc()
   → DELETE /api/internal/npcs/{npc_id}
```

---

## 3. Metadata 필드 (HTTP Request Body → nanobot)

deskrpg app이 nanobot API를 호출할 때 **HTTP body에 포함해야 하는 metadata 필드**:

### 3.1 필드 목록

| 필드 | 타입 | 설명 | 비고 |
|---|---|---|---|
| `user_id` | UUID string | deskrpg users.id | `ownerUserId`로 전달 |
| `channel_id` | UUID string | deskrpg channels.id | 모든 API에 사용 |
| `character_id` | UUID string | deskrpg characters.id | `assignerCharacterId`로 전달 |
| `parent_npc_id` | string | `openclaw_config->>'agentId'` (예: `"pm-a"`) | spawn `parentAgentId`, session_key용 |
| `npc_id` | UUID string **deskrpg npcs.id** | **chat-push npc_id로 사용** | **중요**: UUID여야 함 |

### 3.2 `parent_npc_id` vs `npc_id` 구분

| 필드 | 값 예시 | 출처 | 용도 |
|---|---|---|---|
| `parent_npc_id` | `"pm-a"` | `npcs.openclaw_config->>'agentId'` | spawn 시 parent NPC lookup, session_key |
| `npc_id` | `"cb315e86-..."` | `npcs.id` (UUID) | **chat-push npc_id** |

> ⚠️ **chat-push `npc_id`는 반드시 deskrpg DB의 `npcs.id` UUID여야 한다.** agentId 문자열을 보내면 `invalid input syntax for type uuid` 에러 발생.

### 3.3 metadata 흐름 경로

```
HTTP body["metadata"]
  → server.py inbound_metadata
  → msg.metadata
  → AgentLoop._set_tool_context()
    → metadata.get("npc_id")        → parent_npc_uuid (1순위)
    → metadata.get("character_id")  → character_id
  → SpawnTool.set_context(...)
  → SpawnTool.execute() → deskrpg_meta
  → SubagentManager.spawn(deskrpg_meta)
  → SubagentStatus.deskrpg_meta
  → _announce_result() → chat_push(npc_id=parent_npc_uuid)
```

---

## 4. DeskRPGClient API 규격

### 4.1 `DeskRPGClient()` 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DESKRPG_INTERNAL_URL` | `http://deskrpg-app:3000` | DeskRPG API base URL (1순위) |
| `REGTRACK_INTERNAL_URL` | (fallback) | docker-compose 하위호환용 (2순위) |
| `INTERNAL_RPC_SECRET` | `test-secret` | `x-deskrpg-internal-secret` 헤더 값 |

### 4.2 Public Methods

| 메서드 | HTTP | DeskRPG Endpoint | nanobot 호출 시점 |
|---|---|---|---|
| `create_npc()` | `POST` | `/api/internal/npcs` | spawn 시 (subagent 생성 직전) |
| `delete_npc()` | `DELETE` | `/api/internal/npcs/{npc_id}` | subagent 완료/실패 시 |
| `push_task(action)` | `POST` | `/api/internal/tasks` | 생성·진행·완료·취소 시점 각각 |
| `chat_push()` | `POST` | `/api/internal/chat-push` | subagent 완료 시 (parent_npc_uuid 있을 때만) |

### 4.3 push_task action별 호출 규격

모든 action에 공통 필수값: `channelId`, `npcId`, `npcTaskId`, `title`, `summary`, `assignerCharacterId`, `ownerUserId`.

#### create

```json
{ "action": "create", "status": "in_progress" }
```

#### update

```json
{ "action": "update", "status": "in_progress" }
```

#### complete

```json
{ "action": "complete", "status": "complete" }
```

#### cancel

```json
{ "action": "cancel", "status": "cancelled" }
```

> **npcTaskId는 subagent_id로 통일**: `SpawnTool`에서 생성한 `sub_aba21459` 형태의 ID. SubagentManager 내부 `task_id`(uuid4[:8])와 다름.

### 4.4 chat_push 규격

```json
{
  "session_key": "api:ot-{channel_short}-{parent_agent_id}-dm-{owner_short}",
  "channel_id": "953e8584-...",
  "npc_id": "cb315e86-...",      // ← 반드시 npcs.id UUID
  "message": "{label} 태스크 완료/실패: ...",
  "kind": "subagent_push",
  "subagent_id": "agent-research-001",
  "subagent_label": "리서치담당",
  "task_npc_task_id": "sub_aba21459"
}
```

---

## 5. 채널 설정

`~/.nanobot/config.json`:

```json
{
  "channels": {
    "deskrpg": {
      "enabled": true
    }
  }
}
```

> `ChannelsConfig`가 `extra="allow"`이므로 deskrpg 필드는 Pydantic 검증 없이 통과됨.
> `nanobot-gateway`에서 deskrpg channel이 활성화되면 OutboundMessage 기반 dispatch도 동작.

---

## 6. Sync 동작 상세

### 6.1 NPC 생성 (create_npc)

- **호출**: `SpawnTool.execute()` / `DeskRPGClient` 직접 호출
- **endpoint**: `POST /api/internal/npcs`
- **응답 추출**: `response["npc"]["id"]` → `deskrpg_meta["npc_id"]`
- **실패 시**: NPC UUID 없으므로 이후 모든 sync skip

### 6.2 NPC 삭제 (delete_npc)

- **호출**: `_announce_result()` / `DeskRPGClient` 직접 호출
- **endpoint**: `DELETE /api/internal/npcs/{npc_id}`
- **항상 수행**: subagent 종료 시 무조건 NPC 삭제 (리소스 정리)

### 6.3 Task 생성 (task_create)

- **호출**: NPC 생성 성공 직후, `DeskRPGClient.push_task(action="create")`
- **endpoint**: `POST /api/internal/tasks`
- **필수**: `assignerCharacterId`, `ownerUserId`

### 6.4 Task 진행 갱신 (task_update)

- **호출**: `AgentRunner` checkpoint callback, `iteration % 3 == 0`
- **endpoint**: `POST /api/internal/tasks` (action=update)
- **summary**: `"진행 중 (iteration {n})"`

### 6.5 Task 완료/취소 (task_complete / task_cancel)

- **호출**: `_announce_result()`에서 chat-push 직후, npc_delete 직전
- **endpoint**: `POST /api/internal/tasks` (action=complete / cancel)

### 6.6 채팅 push (chat_push)

- **호출**: `_announce_result()`에서 task action 직전
- **endpoint**: `POST /api/internal/chat-push`
- **npc_id**: `parent_npc_uuid` (deskrpg metadata의 `npc_id` → UUID)
- **parent_npc_uuid 없으면 skip**: agentId 문자열이 전달되어 UUID 파싱 에러 방지

---

## 7. 에러 처리

모든 DeskRPG HTTP 호출은 **best-effort**:

| 케이스 | 행동 |
|---|---|
| HTTP 4xx/5xx | `logger.warning` 출력, None 반환 |
| Network timeout (5s) | `logger.warning` 출력, None 반환 |
| JSON 파싱 실패 | `logger.warning` 출력, None 반환 |
| `parent_npc_uuid` 누락 | chat-push graceful skip (warning 로그) |

main agent loop의 메시지 처리 흐름은 DeskRPG sync 실패와 무관하게 정상 진행된다.

---

## 8. 디버깅 로그 체인

실제 운영 로그에서 deskrpg sync 확인:

```
[DeskRPG HTTP] POST /api/internal/npcs -> 201              ← NPC 생성 ✅
[DeskRPG Spawn] task_create: npc=... agent_id=...           ← task create 시작
[DeskRPG HTTP] POST /api/internal/tasks -> 201              ← task create 성공 ✅
[DeskRPG Subagent] task_update: ... iteration=3             ← 진행 갱신
[DeskRPG Subagent] Starting sync for task_id=...            ← 완료 sync 시작
[DeskRPG Subagent] chat_push: npc_id=cb315e86-...           ← chat-push (UUID)
[DeskRPG HTTP] POST /api/internal/chat-push -> 201          ← chat-push 성공 ✅
[DeskRPG Subagent] task task_complete: task_id=...          ← task 완료
[DeskRPG HTTP] POST /api/internal/tasks -> 200              ← task 완료 성공 ✅
[DeskRPG Subagent] npc_delete: npc_id=...                   ← NPC 삭제
[DeskRPG HTTP] DELETE /api/internal/npcs/... -> 200          ← NPC 삭제 성공 ✅
```

---

## 9. 변경 이력

| 날짜 | 변경 | 작성자 |
|---|---|---|
| 2026-05-30 | v2 — `DeskRPGClient` 직접 호출 방식으로 변경 (bus publish 제거). `parent_npc_uuid`/`npc_id` UUID 필드 정리. `assignerCharacterId`/`ownerUserId` 추가. chat-push graceful skip. | Sisyphus |
| 2026-05-30 | v1 — 최초 작성 (deskrpg channel + bus 기반 dispatch 설계) | Sisyphus |
