# DeskRPG Interface — Nanobot ↔ DeskRPG Sync Channel

> **목적**: nanobot subagent lifecycle 이벤트(생성, 진행, 완료, 삭제)를 DeskRPG frontend에 실시간 동기화하는 인터페이스 명세.
>
> **관련 파일**:
> - `nanobot/utils/deskrpg_client.py` — 순수 HTTP client (모든 DeskRPG API 호출 담당)
> - `nanobot/channels/deskrpg.py` — DeskRPG sync channel (gateway 프로세스용, 선택적)
> - `nanobot/agent/tools/spawn.py` — SpawnTool (NPC 생성 + task create)
> - `nanobot/agent/subagent.py` — SubagentManager (checkpoint/완료 sync;)
> - `nanobot/agent/loop.py` — AgentLoop (metadata → SpawnTool context 전달)
> - `nanobot/api/server.py` — API server (HTTP body metadata 파싱)
> - `nanobot/nanobot/skills/report-composer/SKILL.md` — **report-composer built-in skill** (리포트 포맷팅 + push 가이드)
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

> **참고**: `create_report()`는 _announce_result에서 자동 호출되지 않습니다.
> 리포트 생산이 필요한 경우, main agent loop가 결과를 받은 후 `report-composer` skill을 가진
> 전용 subagent를 spawn하여 포맷된 리포트를 push합니다. 자세한 내용은 §4.5 및
> `nanobot/nanobot/skills/report-composer/SKILL.md` 참조.

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

### 4.0 Wire Format Directive
**중요**: nanobot(Python)에서 DeskRPG로 보내는 모든 HTTP 요청 바디는 반드시 `snake_case`를 사용해야 합니다. DeskRPG 핸들러가 내부적으로 이를 `camelCase`로 변환하여 처리합니다.

### 4.1 `DeskRPGClient()` 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DESKRPG_INTERNAL_URL` | `http://deskrpg-app:3000` | DeskRPG API base URL (1순위) |
| `REGTRACK_INTERNAL_URL` | (fallback) | docker-compose 하위호환용 (2순위) |
| `INTERNAL_RPC_SECRET` | `test-secret` | `x-deskrpg-internal-secret` 헤더 값 |

### 4.2 Endpoint 상세 명세

#### 4.2.1 NPC Interface (`POST /api/internal/npcs`)
**Input (`SpawnSubAgentInput`)**
| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `owner_user_id` | string | ✅ | DeskRPG 유저 UUID |
| `channel_id` | string | ✅ | DeskRPG 채널 UUID |
| `name` | string | ✅ | NPC 표시 이름 |
| `agent_id` | string | ✅ | 에이전트 식별자 (예: `pm-a`) |
| `parent_agent_id` | string | ✅ | 상위 에이전트 식별자 |
| `identity` | string | ✅ | NPC 정체성/역할 정의 |
| `soul` | string | ✅ | NPC 성격/영혼 정의 |
| `appearance` | string | ❌ | 외형 묘사 |
| `position_x` | number | ❌ | 초기 X 좌표 |
| `position_y` | number | ❌ | 초기 Y 좌표 |
| `locale` | string | ❌ | 언어 설정 |

**Success Response (`SpawnSubAgentOk`)**
- `ok`: `true`
- `statusCode`: `201`
- `npc`:
  - `id`: string (UUID)
  - `name`: string
  - `parentAgentId`: string
  - `openclawConfig`: object
  - `positionX`: number
  - `positionY`: number
  - `direction`: number

**Error Response (`NpcHandlerErr`)**
| status | errorCode | 설명 |
|---|---|---|
| `400` | `missing_required_field` | 필수 필드 누락 |
| `403` | `forbidden_channel` | 접근 권한 없는 채널 |
| `404` | `channel_not_found` / `parent_npc_not_found` / `npc_not_found` | 대상 리소스 없음 |
| `409` | `position_conflict` | 좌표 충돌 |
| `500` | `internal_error` | 서버 내부 오류 |

---

#### 4.2.2 Task Interface (`POST /api/internal/tasks`)
**Input (`TaskEventInput`)**
| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `channel_id` | string | ✅ | DeskRPG 채널 UUID |
| `npc_id` | string | ✅ | DeskRPG NPC UUID |
| `npc_task_id` | string | ✅ | subagent_id (예: `sub_aba21459`) |
| `title` | string | ✅ | 태스크 제목 |
| `summary` | string | ❌ | 태스크 요약 내용 |
| `status` | string | ✅ | `in_progress` / `complete` / `cancelled` |
| `action` | string | ✅ | `create` / `update` / `complete` / `cancel` |
| `assigner_character_id` | string | ✅ | 할당자 캐릭터 UUID |
| `owner_user_id` | string | ✅ | 소유 유저 UUID |
| `metadata` | object | ❌ | 추가 메타데이터 |

**Success Response (`TaskEventOk`)**
- `ok`: `true`
- `statusCode`: `200` \| `201`
- `task`:
  - `id`: string
  - `status`: string
  - `createdAt`: string (optional)
  - `updatedAt`: string (optional)

**Error Response (`TaskEventErr`)**
| status | errorCode | 설명 |
|---|---|---|
| `400` | `missing_required_field` | 필수 필드 누락 |
| `403` | `forbidden_channel` | 접근 권한 없는 채널 |
| `404` | `channel_not_found` / `npc_not_found` / `task_not_found` | 대상 리소스 없음 |
| `409` | `task_id_conflict` | 태스크 ID 충돌 |
| `500` | `internal_error` | 서버 내부 오류 |

---

#### 4.2.3 Chat-Push Interface (`POST /api/internal/chat-push`)
**Input (`ChatPushInput`)**
| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `session_key` | string | ✅ | 세션 식별 키 |
| `channel_id` | string | ✅ | DeskRPG 채널 UUID |
| `npc_id` | string | ✅ | DeskRPG NPC UUID |
| `message` | string | ✅ | 전송 메시지 내용 |
| `kind` | string | ❌ | 메시지 종류 (예: `subagent_push`) |
| `subagent_id` | string | ❌ | subagent 식별자 |
| `subagent_label` | string | ❌ | subagent 표시 레이블 |
| `task_npc_task_id` | string | ❌ | 관련 태스크 ID |
| `metadata` | object | ❌ | 추가 메타데이터 |

**Success Response (`ChatPushOk`)**
- `ok`: `true`
- `statusCode`: `201`
- `persistedMessageId`: string

**Error Response (`ChatPushErr`)**
| status | errorCode | 설명 |
|---|---|---|
| `400` | `missing_required_field` | 필수 필드 누락 |
| `401` | `unauthorized` | 인증 실패 |
| `403` | `forbidden_channel` | 접근 권한 없는 채널 |
| `404` | `channel_not_found` / `npc_not_found` | 대상 리소스 없음 |
| `409` | `duplicate_message` | 중복 메시지 |
| `500` | `internal_error` | 서버 내부 오류 |

---

#### 4.2.4 Report Interface (`POST /api/internal/reports`)
**Input (`ReportPushInput`)**
| 필드 | 타입 | 필수 여부 | 설명 |
|---|---|---|---|
| `channel_id` | string | ✅ | DeskRPG 채널 UUID |
| `npc_id` | string | ✅ | DeskRPG NPC UUID |
| `character_id` | string | ✅ | 캐릭터 UUID |
| `body_markdown` | string | ✅ | 리포트 마크다운 본문 |
| `title` | string | ❌ | 리포트 제목 |
| `creator_sub_agent_label` | string | ❌ | 작성 subagent 레이블 |
| `metadata` | object | ❌ | 추가 메타데이터 |

**Success Response (`ReportPushOk`)**
- `ok`: `true`
- `statusCode`: `201`
- `persistedReportId`: string

**Error Response (`ReportPushErr`)**
| status | errorCode | 설명 |
|---|---|---|
| `400` | `missing_required_field` | 필수 필드 누락 |
| `401` | `unauthorized` | 인증 실패 |
| `403` | `forbidden_channel` | 접근 권한 없는 채널 |
| `404` | `channel_not_found` / `npc_not_found` / `character_not_found` | 대상 리소스 없음 |
| `409` | `duplicate_message` | 중복 메시지 |
| `500` | `internal_error` | 서버 내부 오류 |


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

### 4.5 create_report 규격 — Skill-based (report-composer)

Subagent의 markdown 결과물을 ReportPanel에 push. chat-push와는 별 트랙.

**중요한 아키텍처 결정**: `create_report()`는 `_announce_result()`에서 자동 호출되지 않습니다.
대신, **report-composer built-in skill** (`nanobot/nanobot/skills/report-composer/SKILL.md`)을
통해 전용 subagent를 spawn하여 리포트를 포맷팅하고 push합니다.

이 방식의 장점:
- 리포트 포맷팅을 subagent의 LLM이 SKILL 템플릿에 따라 유연하게 수행
- 상황(식단 리포트, 운동 리포트, 통합 리포트)에 따라 템플릿 선택 가능
- rigid `is_ok && len > 100` 조건 대신 의도적인 spawn 결정
- `channel_id`, `npc_id`, `character_id` 등 context를 task prompt에 포함하여 전달

| | chat-push (§4.4) | create_report (§4.5) |
|---|---|---|
| 본문 크기 | 한 줄 (~수십 자) | 마크다운 (~수 KB) |
| 저장 위치 | `chat_messages` | `agent_reports` (별 테이블) + `chat_messages` kind="report_card" |
| UI | 채팅 메시지 prefix | 채팅 카드(클릭) / ReportPanel 슬라이드인 |
| socket event | `npc:push-message` | `agent-report:ready` |
| 용도 | 진행 알림 | 완성된 결과물 |
| 트리거 | `_announce_result()` 자동 | **main agent loop가 skill subagent를 spawn하여 수동 push** |

**호출 규격**:

```json
{
  "channel_id": "953e8584-...",
  "npc_id": "cb315e86-...",           // parent_npc_uuid (UUID)
  "character_id": "1b2affc7-...",
  "title": "📋 일상관리 통합 리포트",
  "body_markdown": "# 📋 일상관리 통합 리포트\n\n## 1️⃣ 오늘의 식단...",
  "creator_sub_agent_label": "리포트작성",
  "metadata": {"source": "subagent", "skill": "report-composer"}
}
```

**필수 필드**: `channel_id`, `npc_id`, `character_id`, `body_markdown`

**Skill 사용 흐름**:

```
main agent ──(daily-manager 결과 수신)──→ task context 구성
    │                                           │
    │   channel_id, npc_id, character_id,       │
    │   daily-manager raw 결과를 prompt에 포함     │
    ▼                                           ▼
SpawnTool.execute(task="...daily result 포함...",
                  skills=["report-composer"])
    │
    ▼
report-composer subagent 실행
    1. SKILL.md 템플릿(§2.4)으로 리포트 포맷팅
    2. curl로 POST /api/internal/reports
    3. DeskRPG ReportPanel에 영속
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

### 6.7 Report push (create_report) — Skill-based

- **호출**: `_announce_result()`에서 **자동 호출되지 않음**
- **대신**: main agent loop가 daily-manager subagent의 결과를 수신한 후, **report-composer skill**을 가진 subagent를 spawn하여 push
- **endpoint**: `POST /api/internal/reports`
- **skill 파일**: `nanobot/nanobot/skills/report-composer/SKILL.md`
- **역할**: chat-push(짧은 알림)와 달리, subagent의 **전체 markdown 결과물**(KB 단위)을 ReportPanel에 push
- **npc_id**: chat-push와 동일한 `parent_npc_uuid` (parent NPC UUID)
- **character_id**: metadata에서 받은 `character_id` (assignerCharacterId와 동일값)
- **실패 시**: 생성 실패는 warning 로깅만, main flow는 계속 진행

#### 호출 규격

```json
{
  "channel_id": "953e8584-...",
  "npc_id": "cb315e86-...",           // parent_npc_uuid (UUID)
  "character_id": "1b2affc7-...",
  "title": "📋 일상관리-리서치 결과 보고서",
  "body_markdown": "## 핵심 요약\n\n...전체 마크다운 결과물...",
  "creator_sub_agent_label": "리서치담당",
  "metadata": {"source": "subagent"}
}
```

#### chat-push vs reports 비교

| | chat-push (§6.6) | reports (§6.7) |
|---|---|---|
| 본문 크기 | 한 줄 (~수십 자) | 마크다운 (~수 KB) |
| 저장 위치 | `chat_messages` | `agent_reports` (별 테이블) + `chat_messages` kind="report_card" |
| UI | 채팅 메시지 prefix | 채팅 카드(클릭) / ReportPanel 슬라이드인 |
| socket event | `npc:push-message` | `agent-report:ready` |
| 용도 | 진행 알림 | 완성된 결과물 |

---

### 6.8 Daily Management Workflow (report-composer skill 사용 예시)

일상관리 에이전트 → 리포트 에이전트로 이어지는 전형적인 2단계 spawn workflow:

```
사용자: "일상관리 에이전트에게 식단 추천 + 운동 알려달라고 해줘"
    │
    ▼
main agent: SpawnTool.execute(task="일상관리")
    │
    ├─ DeskRPGClient.create_npc()          → "일상관리담당" NPC 생성
    ├─ DeskRPGClient.push_task(create)     → task 등록
    └─ SubagentManager.spawn(deskrpg_meta) → subagent 실행
    │
    ▼
[일상관리담당 subagent] — 아침/점심/저녁 식단 + 유산소운동 조사
    │
    ▼
_announce_result()
    ├─ bus.publish_inbound (→ main agent loop)
    ├─ DeskRPGClient.chat_push()           → "일상관리담당 태스크 완료"
    ├─ DeskRPGClient.push_task(complete)   → task 완료 처리
    └─ DeskRPGClient.delete_npc()          → NPC 정리
    │
    ▼
main agent loop: daily-manager 결과 수신
    │
    ├─ 결과에서 channel_id, npc_id, character_id 추출
    └─ SpawnTool.execute(
         task="일상관리 결과를 바탕으로 리포트 작성:
               channel_id={...}, npc_id={...}, character_id={...},
               [daily-manager raw 결과 전문]",
         load_skills=["report-composer"],
       )
    │
    ▼
[리포트작성 subagent] — report-composer SKILL.md 읽음
    ├─ SKILL §2.4 템플릿으로 통합 리포트 포맷팅
    ├─ SKILL §3.4 curl 명령어로 create_report() 호출
    │  → POST /api/internal/reports
    │  → DeskRPG ReportPanel에 영속 + chat_card 표시
    ├─ DeskRPGClient.chat_push()           → "리포트 작성 완료"
    ├─ DeskRPGClient.push_task(complete)
    └─ DeskRPGClient.delete_npc()
    │
    ▼
main agent loop: "일상관리 리포트가 DeskRPG에 게시되었습니다" 응답
```

---

## 7. 에러 처리

모든 DeskRPG HTTP 호출은 **best-effort**:

| 케이스 | 행동 |
|---|---|
| HTTP 4xx/5xx | `logger.warning` 출력, None 반환 |
| Network timeout (5s) | `logger.warning` 출력, None 반환 |
| JSON 파싱 실패 | `logger.warning` 출력, None 반환 |
| `parent_npc_uuid` 누락 | chat-push graceful skip (warning 로그) |
| report 생성 실패 | warning 로깅만, main flow 계속 진행 |

main agent loop의 메시지 처리 흐름은 DeskRPG sync 실패와 무관하게 정상 진행된다.

---

## 8. 디버깅 로그 체인

### 8.1 단일 subagent 완료 로그 (기본 sync)

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

> 참고: `create_report` 로그는 위에 없음 — auto push가 제거되었기 때문.
> 리포트 push가 필요한 경우 report-composer skill subagent의 로그를 별도로 확인.

### 8.2 Daily Management + Report Workflow 로그 (2단계 spawn)

```
[Phase 1 — 일상관리담당 subagent]

[DeskRPG HTTP] POST /api/internal/npcs -> 201              ← "일상관리담당" NPC ✅
[DeskRPG Spawn] task_create: npc=... agent_id=daily-mgr
[DeskRPG HTTP] POST /api/internal/tasks -> 201
[DeskRPG Subagent] task_update: iteration=3                 ← 식단 조사 중
[DeskRPG Subagent] task_update: iteration=6                 ← 운동 조사 중
[DeskRPG Subagent] Starting sync for task_id=...
[DeskRPG Subagent] chat_push: npc_id=cb315e86-...           ← 완료 알림
[DeskRPG HTTP] POST /api/internal/chat-push -> 201          ✅
[DeskRPG Subagent] task task_complete: task_id=...
[DeskRPG HTTP] POST /api/internal/tasks -> 200              ✅
[DeskRPG Subagent] npc_delete: npc_id=...                   ← "일상관리담당" NPC 삭제
[DeskRPG HTTP] DELETE /api/internal/npcs/... -> 200          ✅

[Phase 2 — 리포트작성 subagent (report-composer skill)]

[DeskRPG HTTP] POST /api/internal/npcs -> 201              ← "리포트작성" NPC ✅
[DeskRPG Spawn] task_create: npc=... agent_id=report-writer
[DeskRPG HTTP] POST /api/internal/tasks -> 201
[DeskRPG Subagent] Starting sync for task_id=...
[DeskRPG Subagent] chat_push: npc_id=cb315e86-...           ← 리포트 작성 완료 알림
[DeskRPG HTTP] POST /api/internal/chat-push -> 201          ✅
[DeskRPG Subagent] create_report via curl: body_len=3200    ← report-composer skill push
[DeskRPG HTTP] POST /api/internal/reports -> 201            ← 리포트 영속 ✅
[DeskRPG Subagent] task task_complete: task_id=...
[DeskRPG HTTP] POST /api/internal/tasks -> 200              ✅
[DeskRPG Subagent] npc_delete: npc_id=...                   ← "리포트작성" NPC 삭제
[DeskRPG HTTP] DELETE /api/internal/npcs/... -> 200          ✅
```

---

## 10. 변경 이력

| 날짜 | 변경 | 작성자 |
|---|---|---|
| 2026-05-30 | **v5 — 기술 명세 정렬**: TS 타입 기반 Input/Ok/Err 정의 및 Error Code 전수 반영. | Sisyphus |
| 2026-05-30 | **v4 — Skill-based report-composer 도입**. auto `create_report()`를 `subagent._announce_result()`에서 제거. 대신 `report-composer` built-in skill (`nanobot/nanobot/skills/report-composer/SKILL.md`)을 통해 전용 subagent가 리포트를 포맷팅하고 push. SKILL은 템플릿(식단/운동/통합) + curl push 명령어 제공. deskrpg-interface.md에 §6.8 Daily Management Workflow 추가. | Sisyphus |
| 2026-05-30 | v3 — Report push 추가 (`create_report()`). subagent 결과물을 ReportPanel에 push. docs/api/internal-events-curl-guide.md §5 반영. | Sisyphus |
| 2026-05-30 | v2 — `DeskRPGClient` 직접 호출 방식으로 변경 (bus publish 제거). `parent_npc_uuid`/`npc_id` UUID 필드 정리. `assignerCharacterId`/`ownerUserId` 추가. chat-push graceful skip. | Sisyphus |
| 2026-05-30 | v1 — 최초 작성 (deskrpg channel + bus 기반 dispatch 설계) | Sisyphus |
