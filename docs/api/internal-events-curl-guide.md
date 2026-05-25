# Internal Events Endpoint — curl 테스트 가이드

> 본 PR(`feat/v10-phase1-2-internal-endpoints`)에서 신설한 internal endpoint를 nanobot 통합 전에 직접 curl로 검증하기 위한 가이드.
>
> 정식 spec은 `docs/api/internal-events-contract.md` 참고.

---

## 0. 사전 준비 — 본인 환경의 ID 5개 조회

deskrpg DB에서 본인 채널의 supervisor NPC + character 정보를 SQL로 뽑는다.

```bash
# PostgreSQL 컨테이너 이름이 reg-detection-db라고 가정
docker exec reg-detection-db psql -U deskrpg -d deskrpg -c "
  SELECT
    c.user_id   AS owner_user_id,
    c.id        AS character_id,
    ch.id       AS channel_id,
    n.id        AS parent_npc_id,
    n.openclaw_config->>'agentId' AS parent_agent_id,
    n.name      AS parent_npc_name
  FROM npcs n
  JOIN channels ch ON ch.id = n.channel_id
  JOIN characters c ON c.user_id = ch.owner_id
  WHERE n.name = '감독관'   -- ← 본인이 hire한 supervisor NPC 이름으로 변경
  ORDER BY n.created_at DESC
  LIMIT 1;
"
```

다음 5개 값을 환경변수로 export:

```bash
export OWNER_USER_ID="6060c836-...-43f799064b"
export CHARACTER_ID="ee3ed177-...-eeefa68c6790"
export CHANNEL_ID="247148b5-...-aaa921397da1"
export PARENT_NPC_ID="978ced1c-...-9bbd700015ce"
export PARENT_AGENT_ID="Supervisor"          # 또는 사용자가 만든 NPC의 agentId
export DESKRPG_URL="http://localhost:3102"    # 또는 docker host IP
export SECRET="$JWT_SECRET"                   # .env.integration의 JWT_SECRET 값
```

> ⚠️ `parent_agent_id`는 nanobot이 spawn 시 받을 metadata.parent_npc_id의 **agentId**, deskrpg npcs.id가 아님. spawn 시 deskrpg 측이 `openclawConfig.agentId == parentAgentId`인 NPC를 lookup.

---

## 1. NPC sub-agent spawn — `POST /api/internal/npcs`

### 정상 요청

```bash
curl -sS -X POST "$DESKRPG_URL/api/internal/npcs" \
  -H "x-deskrpg-internal-secret: $SECRET" \
  -H "content-type: application/json" \
  -d '{
    "ownerUserId": "'"$OWNER_USER_ID"'",
    "channelId": "'"$CHANNEL_ID"'",
    "name": "리서치담당",
    "agentId": "agent-research-001",
    "parentAgentId": "'"$PARENT_AGENT_ID"'",
    "identity": "국제 정세 리서치 전문가.",
    "soul": "정확하고 중립적인 사실 기반 리포트.",
    "locale": "ko",
    "appearance": {
      "bodyType": "male",
      "layers": {
        "body":      { "itemKey": "body",      "variant": "light" },
        "eye_color": { "itemKey": "eye_color", "variant": "blue" }
      }
    }
  }' | jq
```

**기대 응답** (`201`):
```json
{
  "npc": {
    "id": "<newly-generated-uuid>",
    "name": "리서치담당",
    "parentAgentId": "Supervisor",
    "openclawConfig": {
      "agentId": "agent-research-001",
      "sessionKeyPrefix": "sub-agent-research-001",
      "personaConfig": { "identity": "...", "soul": "..." },
      "locale": "ko"
    },
    "appearance": { ... },
    "positionX": 9, "positionY": 8, "direction": "down"
  }
}
```

### 흔한 에러 케이스

| 응답 | errorCode | 원인 |
|---|---|---|
| 201 | — | 정상 |
| 400 | `missing_required_field` | body의 필수 필드 누락 |
| 401 | `unauthorized` | `x-deskrpg-internal-secret` 헤더 누락 또는 불일치 |
| 403 | `forbidden_channel` | `ownerUserId`가 채널 소유자가 아님 |
| 404 | `channel_not_found` | `channelId`가 DB에 없음 |
| **404** | **`parent_npc_not_found`** | **`parentAgentId`로 매칭되는 부모 NPC 없음 (위 이슈의 원인)** |
| 409 | `position_conflict` | 같은 (channelId, x, y) UNIQUE constraint 충돌 |

### **이번 이슈의 정확한 재현**:

```bash
# dummy parent_agent_id로 호출 — nanobot의 dummy metadata와 동일
curl -sS -X POST "$DESKRPG_URL/api/internal/npcs" \
  -H "x-deskrpg-internal-secret: $SECRET" \
  -H "content-type: application/json" \
  -d '{
    "ownerUserId":"'"$OWNER_USER_ID"'","channelId":"'"$CHANNEL_ID"'",
    "name":"reproduce","agentId":"agent-x","parentAgentId":"dummy-parent-id",
    "identity":"x","soul":"x"
  }' -i | head -5
# → HTTP/1.1 404 Not Found
# → {"errorCode":"parent_npc_not_found"}
```

→ Phase 3 완료 시 nanobot이 진짜 `parent_npc_id` 전달 → `parentAgentId`가 supervisor agentId로 매칭 → `201`.

---

## 2. NPC DELETE — `DELETE /api/internal/npcs/:id`

```bash
NPC_ID="<spawn 응답의 npc.id>"

curl -sS -X DELETE "$DESKRPG_URL/api/internal/npcs/$NPC_ID" \
  -H "x-deskrpg-internal-secret: $SECRET"
```

**기대 응답** (`200`):
```json
{ "success": true, "deletedCount": 1 }
```

`deletedCount`는 application-layer cascade 결과 — 본 NPC + parent_agent_id 트리의 자식 sub-agent 모두 포함.

---

## 3. Task lifecycle — `POST /api/internal/tasks`

### action별 동일 endpoint, body의 `action` field로 분기

#### create

```bash
curl -sS -X POST "$DESKRPG_URL/api/internal/tasks" \
  -H "x-deskrpg-internal-secret: $SECRET" \
  -H "content-type: application/json" \
  -d '{
    "channelId":"'"$CHANNEL_ID"'",
    "npcId":"'"$NPC_ID"'",
    "npcTaskId":"task-research-001",
    "title":"이란-미국 전쟁 리서치",
    "summary":"최근 몇달 군사 긴장 정리",
    "status":"in_progress",
    "action":"create",
    "assignerCharacterId":"'"$CHARACTER_ID"'",
    "ownerUserId":"'"$OWNER_USER_ID"'",
    "metadata":{"started_at":"2026-05-25T12:00:00Z"}
  }' | jq
```

기대: `201` + `{ "id": "<task-uuid>", "status": "in_progress" }`

#### update (진행 갱신)

```bash
curl -sS -X POST "$DESKRPG_URL/api/internal/tasks" \
  -H "x-deskrpg-internal-secret: $SECRET" \
  -H "content-type: application/json" \
  -d '{
    "channelId":"'"$CHANNEL_ID"'","npcId":"'"$NPC_ID"'",
    "npcTaskId":"task-research-001",
    "title":"이란-미국 전쟁 리서치",
    "summary":"50% 진행 — 주요 사건 정리 완료",
    "status":"in_progress","action":"update",
    "assignerCharacterId":"'"$CHARACTER_ID"'","ownerUserId":"'"$OWNER_USER_ID"'"
  }' | jq
```

기대: `200` + 같은 task id, summary 갱신

#### complete

```bash
curl -sS -X POST "$DESKRPG_URL/api/internal/tasks" \
  -H "x-deskrpg-internal-secret: $SECRET" \
  -H "content-type: application/json" \
  -d '{
    "channelId":"'"$CHANNEL_ID"'","npcId":"'"$NPC_ID"'",
    "npcTaskId":"task-research-001",
    "title":"이란-미국 전쟁 리서치",
    "summary":"완료 — 보고서 첨부",
    "status":"complete","action":"complete",
    "assignerCharacterId":"'"$CHARACTER_ID"'","ownerUserId":"'"$OWNER_USER_ID"'",
    "metadata":{"completed_at":"2026-05-25T12:30:00Z"}
  }' | jq
```

기대: `200` + `{ "status": "complete" }`. UI 태스크보드 "진행중" → "완료" 자동 이동.

#### cancel

`status: "cancelled"`, `action: "cancel"` + `metadata.error_message`에 사유.

### status enum 주의

| 값 | 사용 |
|---|---|
| `backlog` | 미할당 task |
| `in_progress` | 진행 중 |
| `complete` | **단수형** — 완료 (✱ `completed` 아님) |
| `cancelled` | 취소 |

---

## 4. 동작 확인 — DB + 화면

### 4.1 DB 확인

```bash
docker exec reg-detection-db psql -U deskrpg -d deskrpg -c "
  SELECT id, name, parent_agent_id, openclaw_config->>'agentId' AS agent_id
  FROM npcs WHERE channel_id = '$CHANNEL_ID' ORDER BY created_at;
"

docker exec reg-detection-db psql -U deskrpg -d deskrpg -c "
  SELECT npc_task_id, status, summary, npc_name_snapshot
  FROM tasks WHERE channel_id = '$CHANNEL_ID' ORDER BY created_at;
"
```

### 4.2 실시간 화면 (T-V28 client wiring)

`docker compose -f docker-compose-integration.yml up -d deskrpg-app`로 deskrpg 띄운 후 브라우저에서 채널 페이지 열어두면 — curl 호출이 socket.io broadcast → **새로고침 없이** 화면에 sub-agent sprite + 태스크보드 카드 실시간 등장/소멸.

### 4.3 backlog-A snapshot 검증

NPC DELETE 후에도 tasks row는 살아남고 (FK `ON DELETE SET NULL`), 카드의 작업자 라벨은 `npc_name_snapshot`으로 보존됨. dummy NPC + task lifecycle 한 사이클 돌려보면 확인 가능.

---

## 5. 자주 발생하는 함정

1. **`x-deskrpg-internal-secret` 헤더 누락** → 401. `$JWT_SECRET` 환경변수가 deskrpg와 nanobot 컨테이너 양쪽에 같은 값이어야.
2. **`parentAgentId`는 agentId 문자열** (UUID 아님). nanobot의 spawn metadata의 `parent_npc_id`도 agentId.
3. **`ownerUserId == channels.owner_id`** 일치 필수. 사용자 user.id이지 character.id 아님.
4. **status는 단수형 `complete`** (UI 기존 enum과 매칭).
5. **`npcTaskId` UNIQUE** in `(npcId, npcTaskId)` — nanobot 측에서 idempotency key로 생성. create 두 번 호출 시 onConflictDoUpdate로 status reset됨.

---

## 6. nanobot 측 → 우리 endpoint 호출 디버깅 가이드

nanobot에서 `[DeskRPG Sync Error]` 발생 시 로그에 추가 출력:
```python
log.error(f"[DeskRPG Sync Error] {method} {url} body={json.dumps(body)} status={resp.status} response={resp.text}")
```

특히 우리 endpoint는 모든 에러에 `errorCode` JSON body를 반환하므로 `resp.text`에서 정확한 원인 식별 가능:
- `parent_npc_not_found` → metadata.parent_npc_id가 deskrpg에 없는 NPC
- `unauthorized` → INTERNAL_RPC_SECRET 불일치
- `forbidden_channel` → ownerUserId가 채널 소유자가 아님
- `missing_required_field` + `field: "X"` → 필드 누락

---

## 7. 참고

- contract spec: `docs/api/internal-events-contract.md`
- handler 구현: `deskrpg/src/lib/internal-{task,npc}-handler.ts`
- route: `deskrpg/src/app/api/internal/{tasks,npcs}/route.ts`
- 통합 시나리오 검증 결과: `feat/v10-phase1-2-internal-endpoints` PR description
