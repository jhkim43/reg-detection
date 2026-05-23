# Technical Requirements Document — seed-v10 (Task Push 모델 전환)

| 항목 | 값 |
|---|---|
| **Cycle** | seed-v10 |
| **Source Seed** | `.harness/ouroboros/seeds/seed-v10.yaml` |
| **Source Interview** | `.harness/ouroboros/interviews/2026-05-19-seed-v10-candidates.md` (ambiguity 0.145) |
| **Created** | 2026-05-23 |
| **Architecture Pattern** | 3-tier layered (Presentation / Logic / Data) + Cross-service contract (deskrpg ↔ nanobot) |
| **Parallel-change phase** | migrate (expand는 phase 4.5에서 완료) |

---

## 1. Overview

### Goal (seed-v10 인용)
자율형 agent(nanobot)가 무엇을 하는지 사용자가 deskrpg UI에서 본다 — task 생성/진행/완료, sub-agent spawn/종료를 nanobot이 원천(source of truth)으로 push하고 deskrpg가 UI 가시화 + lifecycle 관리.

### 핵심 변화 (Before / After)

| 측면 | Before (v9까지) | After (v10) |
|---|---|---|
| task 생성 trigger | LLM이 응답 본문에 ` ```json:task ` 블록 출력 → 정규식 parse | nanobot이 tool 실행 시점에 push API 호출 |
| task event source | deskrpg의 task-parser.js | nanobot agent loop emission hook |
| LLM system prompt | task protocol 본문 ~500 tokens prepend (`injectTaskPrompt`) + 매 메시지 reminder ~200 tokens (`withTaskReminder`) | 짧은 hint ~30-50 tokens (`buildTaskCorePrompt` 단순화) |
| 사용자 명시 승인 | "이 작업을 태스크로 등록할까요?" + "등록해" 자연어 답 (LLM-driven) | **자동 등록** (사용자 명시 승인 X, 결정 (가)) |
| sub-agent 흐름 | 부재 | nanobot이 child spawn 시 deskrpg `/api/internal/npcs` POST |
| chat history 원천 | dual write (PostgreSQL + nanobot jsonl) 평행 누적 | PostgreSQL canonical + nanobot jsonl ephemeral cache |
| NPC 삭제 cleanup | PostgreSQL cascade만, nanobot 측 파일 누수 | deskrpg가 nanobot `/v1/agents/{agentId}/cleanup` 명시 호출 |

---

## 2. Layer Design

### 2.1 Presentation Layer

#### 2.1.1 신설 API Endpoint

##### `POST /api/internal/tasks` (AC-001)

```
Headers:
  x-deskrpg-internal-secret: {INTERNAL_RPC_SECRET}
  Content-Type: application/json

Body:
{
  "channelId": "uuid",
  "npcId": "uuid",
  "npcTaskId": "string (nanobot 발급 idempotency key)",
  "title": "string (max 200)",
  "summary": "string?",
  "status": "backlog" | "in_progress" | "completed" | "cancelled",
  "action": "create" | "update" | "complete" | "cancel",
  "assignerCharacterId": "uuid",
  "ownerUserId": "uuid",
  "metadata": {
    "started_at": "ISO8601?",
    "completed_at": "ISO8601?",
    "error_message": "string?"
  }
}

Response 200/201:
{
  "id": "uuid",
  "status": "...",
  "createdAt": "ISO8601"
}

Errors:
  401 unauthorized (internal-secret 누락/불일치)
  400 missing_required_field
  404 channel_not_found / npc_not_found
  409 task_id_conflict (npcTaskId 중복 + action!=update)
```

**동작**:
- `action=create` → tasks insert (npcTaskId UNIQUE conflict 시 409 또는 update fallback)
- `action=update` → status 갱신 + metadata merge
- `action=complete|cancel` → status 전환 + completed_at/cancelled_at 기록
- 모든 경우 socket.io로 `task:event` broadcast (해당 channel 구독자에게)

##### `POST /api/internal/npcs` (AC-002 sub-agent create)

```
Body:
{
  "ownerUserId": "uuid",
  "channelId": "uuid",
  "name": "string",
  "agentId": "string (nanobot 발급)",
  "parentAgentId": "string (parent NPC의 agentId)",
  "identity": "string",
  "soul": "string",
  "appearance": { ... }?,
  "positionX": number?,
  "positionY": number?,
  "locale": "ko"|"en"|"ja"|"zh"?
}

Response 201:
{
  "npc": {
    "id": "uuid",
    "name": "...",
    "parentAgentId": "...",
    "openclawConfig": { "agentId": "...", "sessionKeyPrefix": "...", "personaConfig": {...} }
  }
}
```

**동작**:
- npcs row insert (parent_agent_id = body.parentAgentId)
- positionX/Y 미지정 시 parent NPC 근처 자동 배치 (디자인 미정 → Phase 6)
- appearance 미지정 시 default sub-agent sprite (디자인 미정 → Phase 6)
- writeNanobotAgentFiles 호출 — workspace-{agentId}/IDENTITY.md/SOUL.md mirror
- socket.io `npc:spawned` broadcast

##### `DELETE /api/internal/npcs/{id}` (AC-002 sub-agent delete)

```
Path: /api/internal/npcs/{npcId}

Response 200:
{ "success": true, "deleted_count": 1 }
```

**동작**:
- npcs row 삭제 → cascade (chat_messages, tasks, nanobot_agent_sessions, sub-agents via parent_agent_id)
- deleteNanobotAgentWorkspace 호출 — workspace-{agentId} mirror 정리
- postNanobotAgentCleanup 호출 — nanobot 측 sessions/api_*.jsonl 정리 (AC-007)
- socket.io `npc:deleted` broadcast

#### 2.1.2 Socket.io 이벤트 (신설/수정)

| Event | 방향 | Payload | 사용처 |
|---|---|---|---|
| `task:event` (신설) | server → client | `{ npcId, taskId, status, action }` | TaskBoard 자동 갱신 |
| `npc:spawned` (신설) | server → client | `{ npc: NpcDTO }` | 맵에 NPC 동적 등장 |
| `npc:deleted` (신설) | server → client | `{ npcId }` | 맵에서 NPC 동적 제거 |
| `npc:response-chunk` (기존) | server → client | chunk text | 변화 없음 |
| `npc:chat` (기존, 확장) | client → server | + `metadata` field | AC-006 (Logic layer에서 forward) |

#### 2.1.3 UI 컴포넌트 변경

| 컴포넌트 | 변경 |
|---|---|
| `ChatPanel.tsx` | `TaskConfirmButtons` 호출 제거 (v10-backlog-4 dead code) |
| `TaskBoard` | socket `task:event` listener 추가 — 자동 갱신 |
| `NpcSprite` 또는 NPC 렌더링 layer | sub-agent (parent_agent_id 있음) 시각 마크 (🤖 뱃지 또는 sprite tint) — Phase 6 |
| `NpcHireModal` | sub-agent type 옵션 노출 X (사용자가 직접 hire 못 함) |
| `GamePageClient.tsx` | socket `npc:spawned`/`npc:deleted` listener — 맵 동적 갱신 |

---

### 2.2 Logic Layer

#### 2.2.1 신설 모듈

##### `deskrpg/src/lib/internal-task-handler.ts`

```typescript
// Presentation(route.ts)가 호출하는 순수 Logic 함수
export async function handleTaskEvent(input: {
  channelId, npcId, npcTaskId, title, summary?, status, action,
  assignerCharacterId, ownerUserId, metadata?
}): Promise<{ id: string, status: string }> {
  // 1. 권한 검증 (channel.ownerId == ownerUserId 또는 channel 멤버)
  // 2. action별 DB op:
  //    - create: db.insert(tasks).onConflictDoUpdate (npcTaskId UNIQUE)
  //    - update: db.update(tasks).set(...).where(eq(npcTaskId, ...))
  //    - complete|cancel: status 전환 + timestamp
  // 3. socket.io io.to(channelId).emit("task:event", payload)
  // 4. return {id, status}
}
```

##### `deskrpg/src/lib/internal-npc-handler.ts`

```typescript
export async function spawnSubAgent(input: {
  ownerUserId, channelId, name, agentId, parentAgentId,
  identity, soul, appearance?, positionX?, positionY?, locale?
}): Promise<{ npc: NpcDTO }> {
  // 1. 권한 + channel 검증
  // 2. parent_agent_id로 parent NPC 존재 확인 (FK 무결성)
  // 3. position/appearance default 채우기 (Phase 6 디자인)
  // 4. npcs row insert (parent_agent_id 포함)
  // 5. writeNanobotAgentFiles(agentId, [IDENTITY.md, SOUL.md, AGENTS.md])
  // 6. socket.io io.to(channelId).emit("npc:spawned", { npc })
  // 7. return {npc}
}

export async function deleteNpcInternal(npcId: string): Promise<{ deletedCount: number }> {
  // 1. npcs row 조회 + agentId 추출
  // 2. db.delete(npcs).where(eq(id, npcId)) — cascade로 chat_messages/tasks/sessions/sub-agents
  // 3. deleteNanobotAgentWorkspace(agentId)
  // 4. postNanobotAgentCleanup(agentId) — best-effort
  // 5. socket.io io.to(channelId).emit("npc:deleted", { npcId })
}
```

##### `deskrpg/src/lib/nanobot-cleanup.ts` (AC-007)

```typescript
// nanobot 측 sessions/workspace 정리 trigger — best-effort
export async function postNanobotAgentCleanup(agentId: string): Promise<void> {
  try {
    const url = `${getApiUrl()}/agents/${encodeURIComponent(agentId)}/cleanup`;
    await fetch(url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-deskrpg-internal-secret": getInternalSecret(),
      },
    });
  } catch (_e) {
    // best-effort: NPC 삭제 흐름은 계속 (silent-fail)
  }
}
```

##### `deskrpg/src/lib/nanobot-client.js` 수정 (AC-006)

```javascript
// chatSend 시그니처에 metadata 추가
async chatSend(npcId, sessionKey, message, onDelta, metadata) {
  // ... 기존 흐름
  const opts = { sessionId: sessionKey, signal: ac.signal, metadata };
  // ↓ buildNanobotRequestBody에서 body.metadata 포함
}

// buildNanobotRequestBody 확장
function buildNanobotRequestBody(messages, opts) {
  const body = { model, messages: [...] };
  if (opts.sessionId) body.session_id = String(opts.sessionId);
  if (opts.metadata) body.metadata = opts.metadata;
  return body;
}
```

#### 2.2.2 제거 대상 모듈 (AC-003)

| 파일 | 처리 | 영향 |
|---|---|---|
| `deskrpg/src/lib/task-parser.js` | **완전 삭제** | server.js의 import 라인 + 호출처 5곳 정리 |
| `deskrpg/src/lib/task-prompt.js` | **부분 삭제** — `withTaskReminder`/`buildTaskReminder` 제거. `buildTaskCorePrompt` 짧은 hint로 교체 (AC-004 B). `injectTaskPrompt` + `buildTaskSessionPrompt`는 유지 (NPC persona Identity prepend 흐름) | server.js + npcs route.ts에서 import 라인 정리 |
| `deskrpg/src/lib/task-block-utils.js` | **단순화** — `sanitizeNpcResponseText`는 더 이상 task block 제거 안 함. NPC raw 응답 그대로 chat_messages에 적재. `extractTaskBlocks` 제거 | server.js의 호출처 단순화 |

#### 2.2.3 server.js 호출처 단순화

```javascript
// Before (legacy)
const sanitizedContent = sanitizeNpcResponseText(content);
const parsed = parseNpcResponse(response);
if (parsed.taskAction) {
  // ... task action 처리 (parser-driven)
}
const messageToSend = withTaskReminder(trimmed, locale);

// After (v10)
// sanitize/parser/reminder 모두 제거
// chat history append 시 content 그대로
await chatHistory.appendMessage(characterId, npcId, "npc", content);
// task action은 nanobot이 별 channel로 push (deskrpg는 수동 처리 X)
```

#### 2.2.4 AC-004 — `buildTaskCorePrompt` 신 hint (예시)

```typescript
// deskrpg/src/lib/task-prompt.ts 신 hint
const TASK_HINT = {
  ko: `[Task 관리] 사용자의 업무 지시 시 시스템이 자동으로 task를 등록한다. 너는 작업 진행 상황을 자연어로 사용자에게 안내한다.`,
  en: `[Task Management] When the user gives a work instruction, the system automatically registers a task. You guide the user on progress in natural language.`,
  ja: `[タスク管理] ユーザーが業務指示を出すと、システムが自動的にタスクを登録します。あなたは進行状況を自然言語で案内します。`,
  zh: `[任务管理] 用户给出工作指示时,系统自动登记任务。你用自然语言向用户说明进展。`,
};
// 약 30~50 tokens (legacy 500 tokens 대비 ~90% 감소)
```

**핵심**: 사용자 명시 confirm 흐름은 **제거** (결정 (가) push only). LLM이 자동으로 진행하고 사용자에게는 자연어로 결과 안내.

---

### 2.3 Data Layer

#### 2.3.1 Drizzle Migration `0005_v10_npcs_parent_agent.sql` (AC-005)

```sql
-- npcs 테이블에 parent_agent_id 컬럼 추가
ALTER TABLE npcs ADD COLUMN parent_agent_id TEXT;

-- self-reference FK: parent NPC의 openclawConfig.agentId 와 매칭
-- 직접 npcs.id FK가 아닌 이유: nanobot이 agentId를 발급하고 그 ID로 sub-agent push.
-- npcs.openclawConfig.agentId가 그 값을 그대로 저장하므로 parent_agent_id도 string으로.
-- 단 cascade는 application layer에서 처리 (sub-agent 삭제 시 parent_agent_id로 lookup해서 함께 삭제)

CREATE INDEX IF NOT EXISTS idx_npcs_parent_agent_id ON npcs(parent_agent_id);
```

**중요 디자인 결정**: `parent_agent_id`는 `npcs.id` (UUID) FK가 아니라 **`agentId` (string)** 값. 이유:
- nanobot이 agent를 spawn할 때 deskrpg의 npc.id를 알 수 없음 (push body에 nanobot이 만든 agentId만 포함)
- npcs.openclawConfig.agentId 와 매칭이 자연스러움
- cascade는 application layer에서 처리 (npcs 삭제 시 같은 channel에서 parent_agent_id = 삭제된 NPC의 agentId 인 row들 함께 삭제)

#### 2.3.2 schema.ts 변경

```typescript
export const npcs = pgTable("npcs", {
  // ... 기존 컬럼
  parentAgentId: text("parent_agent_id"),  // NEW v10
}, (table) => [
  // ... 기존 인덱스
  index("idx_npcs_parent_agent_id").on(table.parentAgentId),  // NEW v10
]);
```

#### 2.3.3 server-db.js (CJS) parity

PostgreSQL + SQLite 양쪽 모두에 `parent_agent_id` 컬럼 추가. `ensureSqliteCompatibility`에 `ALTER TABLE npcs ADD COLUMN parent_agent_id TEXT` 추가 (멱등).

#### 2.3.4 tasks 테이블 활용 (변경 없음)

기존 tasks 테이블 그대로. `npcTaskId` 컬럼이 이미 nanobot 발급 idempotency key 역할. v10에서 row 생성/갱신 100% `/api/internal/tasks` 경유.

#### 2.3.5 chat_messages 테이블 활용 (변경 없음)

기존 그대로. content 컬럼에 LLM 자연어 raw 응답 적재 (task block sanitize 제거).

---

## 3. Layer Communication

### 3.1 deskrpg 내부 (Presentation ↔ Logic ↔ Data)

```
Next.js API route handler (route.ts)
  └─→ Logic 함수 직접 import (internal-task-handler.ts 등)
       └─→ Drizzle ORM (db + schema)
```

- **Presentation → Logic**: TypeScript function call (same process, type-safe).
- **Logic → Data**: Drizzle ORM (`@/db`에서 `db` + `schema` import).
- **데이터 전달**: TypeScript interface (named types) — DTO 별 따로 만들지 않고 schema에서 추론. Internal endpoint body schema는 inline type 또는 별 type 파일.

### 3.2 deskrpg ↔ nanobot (Cross-service)

| 방향 | 채널 | Payload schema | 인증 |
|---|---|---|---|
| deskrpg → nanobot (chat 요청) | HTTP POST `/v1/chat/completions` | body: model + messages + session_id + **metadata** | (internal network) |
| deskrpg → nanobot (cancel) | HTTP POST `/v1/chat/abort/{session_id}` | path param | (internal network) |
| deskrpg → nanobot (cleanup, NEW) | HTTP POST `/v1/agents/{agentId}/cleanup` | path param | x-deskrpg-internal-secret |
| nanobot → deskrpg (task event, NEW) | HTTP POST `/api/internal/tasks` | ToolExecutionEvent shape | x-deskrpg-internal-secret |
| nanobot → deskrpg (sub-agent spawn, NEW) | HTTP POST `/api/internal/npcs` | sub-agent spec | x-deskrpg-internal-secret |
| nanobot → deskrpg (sub-agent delete, NEW) | HTTP DELETE `/api/internal/npcs/{id}` | path param | x-deskrpg-internal-secret |

→ **단일 secret** (`INTERNAL_RPC_SECRET`) 으로 양방향 모두 인증. 기존 `LLMUsageRecordHook → /api/internal/llm-usage` 패턴과 동일.

### 3.3 ToolExecutionEvent stable shape (AC-010)

별 문서로 분리: `docs/api/internal-events-contract.md` (Phase 1에서 작성). 다른 팀원과의 spec 동기화 단일 진실 원천.

---

## 4. Directory Structure

```
deskrpg/
├── src/
│   ├── app/api/
│   │   ├── internal/
│   │   │   ├── llm-usage/route.ts          # 기존 (참고용)
│   │   │   ├── tasks/route.ts              # 신설 AC-001
│   │   │   └── npcs/
│   │   │       ├── route.ts                # 신설 AC-002 POST
│   │   │       └── [id]/route.ts           # 신설 AC-002 DELETE
│   │   ├── tasks/route.ts                  # 기존 user-auth (변경 없음 — UI 직접 등록은 유지)
│   │   └── npcs/...                        # 기존 user-auth (변경 없음)
│   ├── lib/
│   │   ├── internal-task-handler.ts        # 신설 Logic
│   │   ├── internal-npc-handler.ts         # 신설 Logic
│   │   ├── nanobot-cleanup.ts              # 신설 Logic (AC-007)
│   │   ├── nanobot-client.js               # 수정 (chatSend body.metadata)
│   │   ├── nanobot-session-recorder.js     # 기존 (phase 4 T-F03)
│   │   ├── nanobot-remote-abort.js         # 기존 (phase 4.5 T-F07)
│   │   ├── nanobot-agent-lifecycle.ts      # 기존 (writeNanobotAgentFiles 재사용)
│   │   ├── task-parser.js                  # ✘ 삭제 AC-003
│   │   ├── task-prompt.ts                  # 수정 (withTaskReminder 제거, hint 단순화)
│   │   └── task-block-utils.js             # 단순화 (sanitize 없애기)
│   ├── db/
│   │   ├── schema.ts                       # 수정 (parent_agent_id)
│   │   └── server-db.js                    # 수정 (CJS parity)
│   ├── app/game/
│   │   └── GamePageClient.tsx              # 수정 (socket task:event/npc:spawned listener)
│   └── components/
│       ├── ChatPanel.tsx                   # 수정 (TaskConfirmButtons 호출 제거)
│       └── NpcHireModal.tsx                # 수정 (sub-agent type 옵션 노출 X)
├── drizzle/
│   └── 0005_v10_npcs_parent_agent.sql      # 신설 AC-005
├── server.js                               # 수정 (parseNpcResponse/withTaskReminder 호출 제거, chatSend metadata 전달)
└── tests/                                  # 새 모듈 단위 테스트

docs/
├── trd/
│   └── TRD-RegTrack-2026-05-23-v10-task-push.md   # 본 문서
└── api/
    └── internal-events-contract.md          # 신설 AC-010 (ToolExecutionEvent + sub-agent event shape)

nanobot/  (다른 팀원 영역, 본 TRD scope 외)
└── (nanobot fork에 emission hook + cleanup endpoint 추가 — 별 PR)
```

---

## 5. Test Strategy

### Logic Layer (가장 중점 — 단위 테스트)

| 모듈 | 테스트 항목 |
|---|---|
| `internal-task-handler.ts` | action별 분기 (create/update/complete/cancel) · npcTaskId UNIQUE conflict 처리 · 권한 검증 · socket emit 호출 검증 (mock io) |
| `internal-npc-handler.ts` | sub-agent spawn DB row 정확성 (parent_agent_id 포함) · cascade delete (sub-agent 자식까지) · writeNanobotAgentFiles mock 호출 · socket emit |
| `nanobot-cleanup.ts` | URL encoding · network error silent · header 포함 (internal-secret) · nanobot 응답 무시 (best-effort) |
| `nanobot-client.js` (수정) | chatSend metadata가 body에 포함됨 (mock fetch로 검증) · buildNanobotRequestBody가 metadata field 정확히 추가 |
| `task-prompt.ts` (단순화) | 새 hint가 locale별 정확히 반환 · withTaskReminder는 export 안 됨 (제거 확인) |

### Data Layer (통합 테스트)

| 항목 | 테스트 |
|---|---|
| `parent_agent_id` migration | SQLite in-memory에서 ensureSqliteCompatibility 실행 후 컬럼 + index 생성 확인 |
| schema.ts ↔ server-db.js parity | 두 schema의 컬럼명/타입/제약 동일 |
| cascade 동작 | parent NPC 삭제 시 같은 channel 안 parent_agent_id 매칭 row 함께 삭제 (application layer) |

### Presentation Layer (API 테스트 + E2E)

| 항목 | 테스트 |
|---|---|
| `/api/internal/tasks` POST | 401 (no secret) · 400 (missing field) · 201 (create 성공 + socket emit) · 409 (npcTaskId 중복) |
| `/api/internal/npcs` POST | 401 · 201 (sub-agent insert + mirror file write + socket emit) |
| `/api/internal/npcs/{id}` DELETE | 401 · 200 (cascade + cleanup endpoint 호출) |
| 통합 smoke test (docker compose) | nanobot이 가짜 push 호출 → deskrpg가 정상 적재 + UI 즉시 반영 |

### **테스트 작성 원칙 (CLAUDE.md 반영)**
- 구현과 테스트 함께 작성 (일괄 작성 금지)
- mock은 레이어 경계에서만 (Logic 테스트는 db/io mock, Data 테스트는 실 DB)
- 순수 로직 집중 (동작 검증)

---

## 6. Decisions & Trade-offs

### 6.1 seed-v10에서 결정된 사항 (인용)

D-23 ~ D-30 (seed-v10.yaml `tech_decisions` 섹션 참조). 본 TRD에서 그대로 채택.

### 6.2 TRD 단계 추가 결정

#### TRD-D-31 — AC-004 `injectTaskPrompt` 처리 = (B) 짧은 hint

```
Before: buildTaskCorePrompt → injectTaskPrompt가 NPC Identity에 ~500 tokens prepend
After:  TASK_HINT (locale별 30~50 tokens) 짧은 hint로 교체

이유:
  - push 모델에서 task 등록은 nanobot이 자동 처리 → LLM은 protocol 본문 불필요
  - 그러나 NPC가 "작업 진행 중" 등 흐름을 자연어로 안내하려면 최소 hint 필요
  - 토큰 절감: ~470 tokens × 1회 (페르소나 생성 시) — 14턴 누적엔 영향 작지만 첫 인사이트 명확
```

#### TRD-D-32 — UI confirm 흐름 = (가) push only (사용자 명시 승인 없음)

```
이유:
  - nanobot 자체에 명시 confirm 메커니즘 없음 (LLM-driven만 가능)
  - LLM-driven confirm은 일관성 보장 어려움 (qwen reasoning 모델 특성)
  - UI level pending → approve 흐름은 deskrpg 측 추가 작업 + push 즉시성 손해

Trade-off accepted:
  - LLM이 의도 오해 시 false-positive task 등록 위험 — 사용자가 board에서 cancel하면 됨
  - 자연스러움 + push 모델의 즉시성 우선
```

#### TRD-D-33 — `parent_agent_id` = string (npcs.id FK 아님)

```
이유:
  - nanobot이 sub-agent spawn 시 deskrpg npc.id를 알 수 없음 (자기 agentId만 알음)
  - npcs.openclawConfig.agentId가 nanobot agentId 그대로 저장하므로 일관성 유지
  - cascade는 application layer (internal-npc-handler.ts의 deleteNpcInternal)에서 처리

Trade-off:
  - DB FK 무결성 보장 X (orphan parent_agent_id 가능)
  - 그러나 cascade application 처리로 정합성 유지 + scope 작음
```

#### TRD-D-34 — Socket broadcast 시점 = 동기 (DB op 직후)

```
이유:
  - 즉시성 우선. UI 즉각 반영
  - DB write 성공 후 socket emit이라 정합성 보장
  - 비동기 worker는 복잡도 ↑, 본 cycle scope 외
```

#### TRD-D-35 — TaskConfirmButtons UI 컴포넌트 = 호출 제거 + 컴포넌트 자체는 v10-backlog-4로 트래킹

```
이유:
  - 결정 (가) push only로 명시 confirm 흐름 부재 → TaskConfirmButtons 의미 잃음
  - 컴포넌트 파일 자체 삭제는 다른 호출처(없을 가능성 높음) 확인 후 별 PR
  - 본 cycle에서는 ChatPanel.tsx에서 호출만 제거
```

#### TRD-D-37 — Task board "취소" 클릭의 cancel granularity = session 단위 (MVP)

```
배경 (2026-05-23 사용자 질문):
  사용자가 chat이 아닌 task board에서 task 한 건만 "취소"를 누르면 어떻게 동작?
  - 특정 tool만 cancel?
  - 해당 agent의 모든 in-flight 작업 cancel?

코드 확인 결과 (nanobot/agent/loop.py:527):
  nanobot의 cancel granularity는 session_key 단위만 (개별 tool/task X).
  task-level cancel은 코드에 없음.

결정 — 옵션 1 (session 단위 cancel) MVP:
  - task board의 "취소" 버튼 클릭 시 deskrpg가 두 가지 수행:
    1. DB: tasks.status="cancelled" + cancelledAt 기록 (즉시)
    2. nanobot: POST /v1/chat/abort/{session_id} (phase 4.5 endpoint 재사용)
       → in-flight task + sub-agents cascade cancel + nanobot측 cancel hook이
         status="cancelled" event push (TRD-D-36) — UI 자동 정합

  - 같은 session의 다른 in-flight 작업도 함께 멈출 위험 수용:
    · 실제로 한 NPC 대화 = 한 session = 한 시점에 한 task만 진행 가능성 높음
    · multi-tool chain 동시 진행은 sub-agent로 분리되어야 정상 설계
    · 사용자 의도가 "이 작업 그만"이라면 같은 NPC의 다른 in-flight도 같이
      멈추는 게 자연스러움

옵션 2 (task-level granular cancel) = backlog:
  - nanobot fork에 큰 변경 (tool execution을 별 asyncio.Task로 wrap +
    task_id ↔ Task mapping + POST /v1/tools/{task_id}/cancel endpoint)
  - 다른 팀원의 work 부담 + 본 cycle scope 외
  - v10-backlog-5로 신설 (별 cycle)

옵션 3 (DB만 cancelled) = 거절:
  - nanobot이 계속 진행 → 토큰 비용 0 절감
  - 사용자 의도("진짜 중단") 미충족
```

#### TRD-D-36 — Cancel propagation: nanobot side cancel hook이 task status="cancelled" push (다른 팀원 작업)

```
배경 (2026-05-23 사용자 질문):
  사용자가 UI에서 task 실행 중 "중단" 누르면 nanobot 측 tool calling도 진짜
  중단되어야 함 + deskrpg task board에도 즉시 "cancelled" 반영되어야 함.

코드 확인 결과 (nanobot/agent/loop.py:527):
  - _cancel_active_tasks(session_key)는 이미 session 단위로 모든 in-flight task
    cancel (chat completion task + sub-agents.cancel_by_session)
  - asyncio CancelledError가 chain으로 전파 → tool execution의 await 지점도 cancel
  - 즉 phase 4.5의 cancel endpoint가 이미 "tool 실행 중단" 자체는 달성

누락 부분:
  - nanobot이 task를 cancel한 후 deskrpg에 "task event status=cancelled" event를
    push하는 흐름 부재
  - 즉 사용자 중단 → tool은 멈추지만 deskrpg task board는 in_progress 그대로
    → UI 정합성 결여

결정:
  - nanobot 측 cancel hook 신설 (다른 팀원 작업):
    asyncio CancelledError catch → 해당 task_id로 ToolExecutionEvent
    (action="cancel", status="cancelled", error_message="user_aborted") push
  - deskrpg /api/internal/tasks의 action="cancel" 흐름에서 status 전환 + socket
    broadcast (이미 AC-001에 포함됨)

cancel granularity 한계 (수용):
  - 개별 tool만 골라 cancel하는 메커니즘은 nanobot 코드에 없음
  - session 단위 cancel만 가능 (한 chat completion 안의 모든 tool calls = 한 chain)
  - 사용자 의도가 "전체 작업 중단"이라 session 단위로 충분
  - 부분 cancel(예: 5개 tool 중 1개만) 필요 시 future cycle
```

---

## 7. Implementation Order

### Phase 1 — Data + Contract (먼저)

| 순서 | AC | 작업 | 시간 |
|---|---|---|---|
| 1 | AC-005 | Drizzle migration 0005 + schema.ts + server-db.js | 25분 |
| 2 | AC-010 | ToolExecutionEvent contract 문서 (`docs/api/internal-events-contract.md`) | 30분 |

### Phase 2 — Presentation (internal endpoints)

| 순서 | AC | 작업 | 시간 |
|---|---|---|---|
| 3 | AC-001 | `/api/internal/tasks` route.ts + internal-task-handler.ts + unit test 5건 | 60분 |
| 4 | AC-002 | `/api/internal/npcs` route.ts + DELETE + internal-npc-handler.ts + unit test 6건 | 80분 |

### Phase 3 — Logic (cleanup + metadata)

| 순서 | AC | 작업 | 시간 |
|---|---|---|---|
| 5 | AC-006 | nanobot-client.js chatSend body.metadata 확장 + buildNanobotRequestBody + server.js 호출처 metadata 인자 추가 + unit test 3건 | 40분 |
| 6 | AC-007 | nanobot-cleanup.ts (postNanobotAgentCleanup) + DELETE /api/npcs/[id] 호출 추가 + unit test 4건 | 30분 |

### Phase 4 — Legacy 제거

| 순서 | AC | 작업 | 시간 |
|---|---|---|---|
| 7 | AC-003 | task-parser.js 삭제 + task-prompt.ts withTaskReminder/buildTaskReminder 제거 + server.js 호출처 5곳 정리 + sanitizeNpcResponseText 단순화 | 50분 |
| 8 | AC-004 | buildTaskCorePrompt → TASK_HINT (locale별 짧은 hint) | 20분 |
| 9 | UI | ChatPanel.tsx의 TaskConfirmButtons 호출 제거 | 10분 |

### Phase 5 — UI (sub-agent visual)

| 순서 | AC | 작업 | 시간 |
|---|---|---|---|
| 10 | AC-008 | sub-agent 시각 마크 (디자인 협의 필요) — GamePageClient.tsx에서 socket npc:spawned/deleted listener | Phase 6 또는 별 PR |
| 11 | UI | TaskBoard socket task:event listener | 30분 |

### Phase 6 — 검증

| 순서 | AC | 작업 | 시간 |
|---|---|---|---|
| 12 | AC-009 | 토큰 절감 smoke test (PM-B 또는 임의 NPC 14턴) — baseline vs after 비교 | 측정만 |

**다른 팀원과의 의존성**: AC-007 (cleanup endpoint 호출)은 nanobot 측 endpoint 신설을 전제. 다른 팀원의 작업 완료 전까지 deskrpg는 호출 시 404 받음 (silent-fail 보호됨). 동시 작업 가능.

**누적 추정**: ~5~6시간 (테스트 작성 포함). 본 TRD scope 외 작업(nanobot fork)은 별 PR.

---

## 8. 다른 팀원 작업 분담 (참조)

### 본인 (deskrpg owner) — 본 TRD scope

- AC-001 ~ AC-007, AC-009 모두

### 다른 팀원 (nanobot fork)

| 작업 | 위치 | 의존성 |
|---|---|---|
| 1. nanobot agent loop emission hook | `nanobot/nanobot/agent/hook.py` 또는 신설 (`TaskEventHook`) | LLMUsageRecordHook 패턴 모사 |
| 2. tool execution event push | nanobot이 deskrpg `/api/internal/tasks` POST | AC-010 contract 참조 |
| 3. sub-agent spawn → push | nanobot이 deskrpg `/api/internal/npcs` POST | AC-002, AC-010 |
| 4. `/v1/agents/{agentId}/cleanup` endpoint | `nanobot/nanobot/api/server.py` 신설 | AC-007 |
| 5. body.metadata 수신 + session 저장 + push 시 forward | nanobot session 메모리 확장 | AC-006 |
| 6. Candidate 4 (qwen reasoning_content) — backlog | nanobot LLM provider parser | future, v10-backlog-1 |

→ **API contract** (AC-010 문서)가 미리 안착되면 다른 팀원이 그것 보고 parallel 작업 가능.

---

## 9. 한계 & 미해결 (post-merge tracking)

seed-v10 `non_blocking_backlog` 참조:
- v10-backlog-1: qwen `delta.reasoning` forward (Candidate 4) — 본인 owner, seed-v10 cycle 후 자연 해소 검증
- v10-backlog-2: multimodal chat input (Candidate 2)
- v10-backlog-3: stale session cron sweep
- v10-backlog-4: TaskConfirmButtons UI 컴포넌트 자체 삭제 (다른 호출처 확인 후)

---

## 10. Discussion Points (구현 전 마지막 검토)

본 TRD를 `/decompose` 이전에 사용자가 검토해야 할 사항:

1. **socket 이벤트 이름** — `task:event`/`npc:spawned`/`npc:deleted`로 통일 OK?
2. **NPC sprite 디자인** — sub-agent 시각 마크 (🤖 뱃지 vs sprite tint)는 Phase 6로 미루어도 OK?
3. **default position** — sub-agent spawn 시 position 미지정 → parent 근처 자동 vs 맵 중앙? Phase 6
4. **nanobot 측 cleanup endpoint 미구현 상태에서의 deskrpg 동작** — `postNanobotAgentCleanup`이 404를 silent-fail로 처리하므로 chat 흐름엔 영향 0. nanobot 팀 완료 전이라도 deskrpg side 머지 가능.

위 4건 모두 본 cycle scope 내 작은 결정. `/decompose`에서 task 분해 시 명시.

---

**이 TRD를 기반으로 `/decompose` 진행 — atomic 단위 task로 분해.**
