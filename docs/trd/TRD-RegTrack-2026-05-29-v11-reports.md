# Technical Requirements Document — v11 Reports

| 항목 | 값 |
|---|---|
| 작성일 | 2026-05-29 |
| Seed | `.harness/ouroboros/seeds/seed-v11.yaml` |
| Interview | `.harness/ouroboros/interviews/2026-05-29-v11-reports.yaml` |
| 진화 | v10-backlog-6 (nanobot → user 자율 보고 push) |
| 아키텍처 패턴 | 3-tier layered (Presentation / Logic / Data) |
| Migration phase | expand (parallel-change) — 기존 흐름 미변경, 신규 트랙 추가 |
| 작업 범위 | 본인 (deskrpg) — nanobot fork는 contract 참조 |

---

## 1. Overview

### 1.1 목표
사용자가 받은 분석 보고서를 채팅창 옆 패널(Claude Artifacts 스타일)에 항상 펼쳐놓고 일할 수 있게 한다. nanobot이 자유 마크다운으로 push → deskrpg가 sanitize 렌더 + 영속 + NPC 단위 자연 전환.

### 1.2 핵심 시나리오
1. 사용자가 Supervisor에게 "보고서 만들어줘"
2. nanobot이 sub-agent spawn (v10 인프라)
3. sub-agent 작업 완료 시 `POST /api/internal/reports`로 본문 push (v11 신규)
4. deskrpg 수신 → `agent_reports` 영속 + socket `npc:report-ready` broadcast
5. 클라이언트:
   - 현재 NPC === report.npcId → ReportPanel 슬라이드인
   - 다른 NPC → 채팅 영역 위 토스트 알림 (클릭 시 그 NPC로 전환)
6. main agent(Supervisor)가 사용자에게 "완료했습니다" 채팅 메시지 (기존 인프라)

### 1.3 v10 재사용 자산
- `INTERNAL_RPC_SECRET` 인증 헤더 패턴 (D-27)
- `parent_npc_id` chatSend metadata wiring (phase3, D-28)
- `internal-chat-push-handler.ts` 구조 (validate → idempotency → DB → emit) — 패턴 모방
- `forwardSocketEmit /_internal/emit` HTTP bridge
- snake_case wire ↔ camelCase 내부 변환 규약

---

## 2. Layer Design

### 2.1 Presentation Layer

#### 2.1.1 신규 HTTP 엔드포인트

##### `POST /api/internal/reports` (nanobot → deskrpg push)

| 항목 | 값 |
|---|---|
| 인증 | `x-deskrpg-internal-secret: ${INTERNAL_RPC_SECRET}` |
| Idempotency | `Idempotency-Key` 헤더 (선택, TTL 10분 in-memory) |
| Content-Type | `application/json` |

**Request DTO (wire = snake_case)**:
```json
{
  "channel_id": "uuid",
  "npc_id": "uuid (parent npc, sub-agent 아님 — D-33)",
  "character_id": "uuid (보고서 소유자)",
  "title": "string (optional, 미지정 시 NULL)",
  "body_markdown": "string (자유 마크다운)",
  "creator_sub_agent_label": "string (optional, 작성자 sub-agent 표시명)",
  "metadata": { "...": "free-form jsonb" }
}
```

**Response**:
- `201 Created` → `{ "persisted_report_id": "uuid" }`
- `400 missing_required_field` → `{ "error": "missing_required_field", "field": "..." }`
- `401 unauthorized` → secret 누락/불일치
- `404 channel_not_found` → channel.id 없음
- `404 npc_not_found` → npc.id 없거나 npc.channel_id 불일치
- `409 duplicate_message` → Idempotency-Key 중복
- `500 internal_error` → DB insert 실패

##### `GET /api/reports` (user → deskrpg fetch)

| 항목 | 값 |
|---|---|
| 인증 | 세션 쿠키 (NextAuth/iron-session — 기존 user-auth 패턴) |
| 사용처 | ReportPanel mount 시 + HistoryModal 열 때 |

**Query params**:
- `npcId` (optional) — 지정 시 그 NPC 작성 보고서만 (패널용)
- `limit` (default 1, max 50) — 패널은 1, 모달은 50

**Response (camelCase, 내부 표준)**:
```json
{
  "reports": [{
    "id": "uuid",
    "characterId": "uuid",
    "npcId": "uuid | null",
    "title": "string | null",
    "bodyMarkdown": "string",
    "metadata": {"...": "..."},
    "createdAt": "ISO8601",
    "creatorNpcName": "string | null (npc 삭제 시 null)",
    "creatorSubAgentLabel": "string | null (metadata snapshot)"
  }]
}
```

**검증 규칙**:
- 세션 character.id로만 fetch (다른 사용자 보고서 접근 차단)
- npcId 지정 시 그 npc가 같은 channel에 속하는지 확인 (404 처리)

#### 2.1.2 신규 React 컴포넌트

##### `ReportPanel.tsx`

| 항목 | 값 |
|---|---|
| 위치 | `deskrpg/src/components/ReportPanel.tsx` |
| Mount 조건 | NpcDialog 열려있을 때 (D-2번 결정 = 옵션 a) |
| 위치 (UI) | NpcDialog 우측 고정 슬롯 (flex row) |
| 트리거 | currentNpcId 변경 + socket `npc:report-ready` (currentNpcId 일치) |

**Props**:
```ts
{
  currentNpcId: string;
  characterId: string;
  socket: Socket;
}
```

**State**:
- `report: Report | null` — 현재 표시 중인 보고서 (없으면 placeholder)
- `isLoading: boolean`
- `slideIn: boolean` — 슬라이드인 애니메이션 트리거

**Behavior**:
1. mount 시 `GET /api/reports?npcId={currentNpcId}&limit=1` → 최신 1건 fetch
2. socket `npc:report-ready` 수신, payload.npcId === currentNpcId 일 때 → refetch + slideIn 트리거
3. 헤더: title + 작성자 (creatorSubAgentLabel || creatorNpcName || "삭제된 NPC") + createdAt
4. 본문: `<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{report.bodyMarkdown}</ReactMarkdown>`
5. 헤더 우측 `📚` 버튼 → HistoryModal 열기 (D-3번 결정 = 옵션 a)
6. 보고서 없으면 placeholder ("아직 받은 보고서가 없습니다")

##### `ReportHistoryModal.tsx`

| 항목 | 값 |
|---|---|
| 위치 | `deskrpg/src/components/ReportHistoryModal.tsx` |
| Mount 조건 | ReportPanel 헤더 `📚` 클릭 시 |
| 데이터 | `GET /api/reports?limit=50` (npcId 미지정 = character 전체) |

**렌더**:
- 최신순 정렬 리스트, 각 row:
  - 작성자 라벨 (creatorSubAgentLabel || creatorNpcName || "삭제된 NPC")
  - createdAt (relative time, "3시간 전")
  - title || (bodyMarkdown 첫 줄 50자)
- row 클릭 → 패널에 그 보고서 로드 (props로 selectedReportId 전달)

#### 2.1.3 GamePageClient 추가 socket listener

기존 `npc:push-message` listener 옆에 추가:
```ts
socketInstance.on("npc:report-ready", (data: ReportReadyPayload) => {
  if (data.npcId === currentNpcId) {
    // 패널이 알아서 refetch + slide in (ReportPanel 자체 listener)
  } else {
    // 토스트 알림 — "{creatorSubAgentLabel || npcName}가 보고서를 올렸어요"
    // 클릭 시 setCurrentNpcId(data.npcId)
    showToast({...});
  }
});
```

#### 2.1.4 server.js / server-dev.js 추가 emit 경로

기존 `/_internal/emit` bridge가 channel-broadcast 패턴을 이미 처리. v11에선 신규 변경 없음 — handler가 emit 호출만 하면 됨.

---

### 2.2 Logic Layer

#### 2.2.1 `internal-report-handler.ts` (신규)

위치: `deskrpg/src/lib/internal-report-handler.ts`

**Pattern**: v10 phase5/6의 `internal-chat-push-handler.ts` 구조 그대로 모방.

**Input DTO** (camelCase, 내부):
```ts
type ReportPushInput = {
  channelId: string;
  npcId: string;
  characterId: string;
  title?: string;
  bodyMarkdown: string;
  creatorSubAgentLabel?: string;
  metadata?: Record<string, unknown>;
};
```

**Result DTO**:
```ts
type ReportPushOk  = { ok: true; statusCode: 201; persistedReportId: string };
type ReportPushErr = {
  ok: false;
  statusCode: 400 | 401 | 403 | 404 | 409 | 500;
  errorCode: "missing_required_field" | "channel_not_found" | "npc_not_found"
           | "character_not_found" | "duplicate_message" | "internal_error";
  field?: string;
};
type ReportPushResult = ReportPushOk | ReportPushErr;
```

**Deps (DI)**:
```ts
type ReportPushDeps = {
  emit: (channelId: string, payload: unknown) => Promise<void>;
  db?: typeof defaultDb;
  idempotencyKey?: string;
};
```

**Pipeline**:
1. `validate(input)` — 필수 필드 (channelId, npcId, characterId, bodyMarkdown) 비어있지 않음 + bodyMarkdown 길이 > 0
2. idempotency cache 검사 (Idempotency-Key 있을 때만, TTL 10분 in-memory)
3. channel 존재 확인 (SELECT id FROM channels WHERE id = ?)
4. npc 존재 확인 + npc.channel_id 일치 검사
5. character 존재 확인 (소유자 검증)
6. DB insert (Drizzle) → returning id
7. `metadata` 풀어서 `creatorSubAgentLabel`이 metadata 안에도 묻혀 들어가게 정규화
8. socket emit `npc:report-ready` (channelId broadcast) — best-effort, 실패해도 row는 보존
9. idempotency cache 채우기

**Side-effect 경계**:
- DB insert 실패 → `500 internal_error` 반환 + cache 미오염 (retry 가능)
- emit 실패 → row 영속 후 `500 internal_error` 반환 (idempotency 미캐싱) → nanobot retry 시 row 이미 있어서 unique 충돌 가능 → 보완: report.id가 nanobot 측 client-generated가 아니라 server-generated이므로 retry 시 새 row 생김 → emit만 다시 시도 안 됨 → 대안: idempotency cache는 cache miss 시 row 검색으로 보완 (현재 cycle scope 외, 단순 in-memory)

#### 2.2.2 `report-list-service.ts` (신규)

위치: `deskrpg/src/lib/report-list-service.ts`

`GET /api/reports` 용 query helper. presentation layer에서 직접 Drizzle 호출하지 않도록 분리.

```ts
async function listReportsByCharacter(characterId: string, opts: {
  npcId?: string;
  limit?: number;
}): Promise<ReportListItem[]>
```

내부에서 LEFT JOIN npcs → creatorNpcName resolve. npc 삭제된 row는 npcs.id NULL → creatorNpcName도 NULL. metadata.creator_sub_agent_label은 그대로 반환.

---

### 2.3 Data Layer

#### 2.3.1 `agent_reports` 테이블 (신규)

```sql
CREATE TABLE agent_reports (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id              UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  npc_id                    UUID            REFERENCES npcs(id)       ON DELETE SET NULL,
  title                     TEXT,
  body_markdown             TEXT NOT NULL,
  metadata                  JSONB,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_reports_character_created ON agent_reports (character_id, created_at DESC);
CREATE INDEX idx_agent_reports_npc_created       ON agent_reports (npc_id,       created_at DESC);
```

**Drizzle 정의** (`schema.ts`):
```ts
export const agentReports = pgTable("agent_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  characterId: uuid("character_id").notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  npcId: uuid("npc_id")
    .references(() => npcs.id, { onDelete: "set null" }),
  title: text("title"),
  bodyMarkdown: text("body_markdown").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("idx_agent_reports_character_created").on(table.characterId, table.createdAt),
  index("idx_agent_reports_npc_created").on(table.npcId, table.createdAt),
]);
```

**SQLite parity** (`schema-sqlite.ts`):
- `uuid` → `text` (with default `random_uuid()` 또는 application-generated)
- `jsonb` → `text` (json.stringify로 직렬화, 읽을 때 parse)
- `timestamptz` → `text` (ISO8601)

**Migration**: `drizzle/0009_v11_agent_reports.sql` + `_journal.json` idx 9 entry.

#### 2.3.2 server-db.js inline schema (CJS parity)

기존 v10에서 phase 6에서 추가한 패턴 그대로 inline 정의 + `agentReports` export 추가.

#### 2.3.3 sqlite-base-schema.js CREATE TABLE

`CREATE TABLE IF NOT EXISTS agent_reports (...)` 추가 (개발 환경 SQLite).

---

## 3. Layer Communication

```
[Browser]
  │  세션 쿠키
  ↓
[Presentation] route.ts (POST /api/internal/reports, GET /api/reports)
  │  ↓ DTO (ReportPushInput camelCase 내부 형식)
[Logic]        internal-report-handler.ts, report-list-service.ts
  │  ↓ Drizzle Query Object
[Data]         schema.ts.agentReports
  │  ↓ SQL
[PostgreSQL/SQLite]
```

**규약**:
- Wire format (HTTP body): snake_case (nanobot 호환)
- 내부 (Logic↔Data): camelCase (Drizzle 표준)
- DTO 변환 위치: Presentation route.ts (request 파싱 + response 직렬화)
- Logic는 절대 HTTP 객체 (NextRequest/NextResponse) 만지지 않음
- Logic는 `ResultType` 반환, Presentation이 HTTP 상태 코드 매핑

**Layer 위반 금지** (ARCHITECTURE_INVARIANTS):
- Presentation 컴포넌트에서 Drizzle 직접 import 금지
- Logic에서 React/NextRequest import 금지
- Data에서 비즈니스 로직 (validate, channel/npc 일치성 검사) 금지

---

## 4. Directory Structure

```
deskrpg/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── internal/
│   │   │   │   └── reports/
│   │   │   │       └── route.ts                # POST 신규
│   │   │   └── reports/
│   │   │       └── route.ts                    # GET 신규
│   │   └── game/
│   │       └── GamePageClient.tsx              # socket listener 추가
│   ├── components/
│   │   ├── ReportPanel.tsx                     # 신규
│   │   ├── ReportHistoryModal.tsx              # 신규
│   │   └── NpcDialog.tsx                       # ReportPanel 슬롯 추가
│   ├── db/
│   │   ├── schema.ts                           # agentReports 추가
│   │   ├── schema-sqlite.ts                    # parity
│   │   ├── server-db.js                        # inline + export
│   │   └── sqlite-base-schema.js               # CREATE TABLE 추가
│   └── lib/
│       ├── internal-report-handler.ts          # 신규 (Logic)
│       └── report-list-service.ts              # 신규 (Logic)
└── drizzle/
    ├── 0009_v11_agent_reports.sql                # 신규
    └── meta/
        └── _journal.json                       # idx 9 entry
docs/
└── api/
    └── internal-events-contract.md              # Section 12 추가
```

---

## 5. Test Strategy

### 5.1 Logic Layer (unit tests, mock minimal)

**`internal-report-handler.test.ts`** — handler 순수 단위 테스트

- ✅ validate: 필수 필드 누락별 400 + field 매핑
- ✅ channel_not_found / npc_not_found / npc-channel 불일치
- ✅ Idempotency-Key 중복 → 409
- ✅ DB insert 성공 → 201 + persistedReportId
- ✅ emit 실패 → 500 internal_error (row는 영속 — 후속 검증)

**`report-list-service.test.ts`** — query helper 단위 테스트

- ✅ npcId 지정 시 LIMIT 1
- ✅ npcId 미지정 시 character 전체 max 50
- ✅ npc 삭제된 row (npc_id NULL) → creatorNpcName NULL + metadata fallback

mock 범위: `db` (Drizzle client) + `emit` (소켓). 다른 helper는 mock 안 함 (접착 코드 mock 금지).

### 5.2 Data Layer (integration tests)

- ✅ Drizzle 0009 migration 자동 적용 (deskrpg-app 컨테이너 restart)
- ✅ `npc_id` ON DELETE SET NULL 동작 — NPC 삭제 후 agent_reports.npc_id가 NULL 됨
- ✅ `character_id` ON DELETE CASCADE — character 삭제 시 reports도 cascade
- ✅ 인덱스 둘 다 생성 확인

### 5.3 Presentation Layer

**API integration** (`route.test.ts`):
- ✅ `POST /api/internal/reports` 정상 201
- ✅ Secret 누락 → 401
- ✅ `GET /api/reports?npcId=` 정상 fetch
- ✅ 다른 character의 report 못 가져옴 (세션 character.id 기반 필터)

**UI manual**:
- 패널 슬라이드인 애니메이션 200~300ms
- 마크다운 표·코드·링크 렌더 (GFM)
- script/iframe 차단 검증 (`<script>alert(1)</script>` 박힌 보고서 push → DOM에 script 안 들어옴)
- NPC 전환 시 패널 자연 교체
- 다른 NPC 보고서 토스트 클릭 → NPC 전환 + 패널 갱신
- 새로고침 후 보고서 복원
- NPC 삭제 후 보고서 살아있음 + 라벨 fallback

### 5.4 테스트 작성 시점

- **각 구현 직후 즉시 해당 테스트**. 일괄 작성 금지 (CLAUDE.md "테스트 함께 작성").

---

## 6. Decisions & Trade-offs (TRD-D-38 ~ TRD-D-44, v10의 TRD-D-37까지 이어서)

### TRD-D-38: 새 패키지 — react-markdown + rehype-sanitize + remark-gfm (옵션 a)

**Reason**: Claude/Notion/Linear/GitHub 표준. self-implement는 비현실적. GFM 없으면 표 못 그림 — 보고서 필수 요소.

**Cost**: 번들 크기 +360KB minified (gzip ~100KB). 보고서 패널 열릴 때만 lazy load 가능 (Next.js dynamic import).

**Impact**: 한 번 추가하면 후속 마크다운 렌더 곳에서 재사용 가능 (chat-history 메시지 풍부화 등).

**Alternatives rejected**:
- (b) rehype-sanitize만 — 표 없음, 사용 불가
- (c) self-impl — 보안 위험 + 유지 부담

### TRD-D-39: ReportPanel mount = NpcDialog 옆 고정 슬롯 (옵션 a)

**Reason**: Claude Artifacts metaphor 그대로. 대화 컨텍스트 = 보고서 컨텍스트 묶임. NPC 닫으면 패널도 자연 정리.

**Impact**: 게임 메인 화면(맵)에선 패널 없음 → 몰입감 유지. NpcDialog 레이아웃 변경 필요 (flex row).

**Alternatives rejected**:
- (b) 항상 떠 있는 사이드바 — 게임 화면 폭 영구 잠식
- (c) 토글 버튼 — 보고서 도착 자동 펼침 처리 복잡 + 사용자 마찰

### TRD-D-40: HistoryModal 트리거 = 패널 헤더 `📚` 버튼 (옵션 a)

**Reason**: history는 보고서 컨텍스트 내부에 묶이는 게 자연. 패널 placeholder 상태에서도 헤더 버튼 살아있게 → 빈 상태에서도 접근 가능.

**Alternatives rejected**:
- (b) 채팅 헤더 별 버튼 — 보고서와 분리됨
- (c) 사이드바 메뉴 — 메뉴 깊이 마찰

### TRD-D-41: emit 실패 시 row 영속 + 500 반환 (v10 phase6 패턴 답습)

**Reason**: DB insert 성공 후 emit 실패는 client retry 시 새 row 만들면 중복. 단, idempotency cache 미캐싱이라 retry 가능. 다음 history fetch에서 자연 복원되므로 UX 손실 없음.

**Trade-off**: 같은 보고서가 가끔 두 번 들어올 가능성 (emit 실패 + retry). 발견 시 보완은 future (idempotency cache를 DB 기반으로 확장).

### TRD-D-42: ReportPanel 슬라이드인 애니메이션 = framer-motion 미사용 (CSS only)

**Reason**: framer-motion은 큰 의존성. 슬라이드인은 단순 transform/opacity transition으로 충분. 새 의존성 추가 안 함.

**Implementation**: `transition: transform 250ms ease-out` + initial `translateX(100%)` → `translateX(0)`.

### TRD-D-43: GET /api/reports = 세션 쿠키 인증 (internal 아님)

**Reason**: GET은 사용자(브라우저)가 fetch. POST /api/internal/reports만 INTERNAL_RPC_SECRET. 두 인증 패턴이 같은 도메인에 공존 — 이미 v10에서 검증된 분리.

**Implementation**: 기존 `getServerSession` 헬퍼 또는 동등한 user-auth 패턴 (해당 패턴은 `/api/npcs/` 등 다른 user API와 일치).

### TRD-D-44: bodyMarkdown 본문 크기 제한 없음 (MVP)

**Reason**: YAGNI (seed-v11 must_not 제외). 운영에서 100KB+ 보고서 자주 들어오면 그 때 제한 + 첨부 분리.

**Risk**: 악성 sub-agent가 1MB+ body push → DB 비대 + 패널 렌더 지연. INTERNAL_RPC_SECRET이 server-to-server 차단이라 외부 공격면 없음. nanobot 측 LLM이 정상 동작하면 보고서 본문 자연 한계 ~수십 KB.

---

## 7. Implementation Order

### Phase 1: Data Layer 기반 (저장소 준비)
1. **AC-001** — `agent_reports` schema 정의 (schema.ts + schema-sqlite.ts + server-db.js inline + sqlite-base-schema.js) + Drizzle migration 0009 + `_journal.json` idx 9
   - 테스트: migration 자동 적용 + ON DELETE SET NULL 동작 확인 (manual SQL)

### Phase 2: Logic Layer (비즈니스)
2. **`internal-report-handler.ts`** + 단위 테스트
3. **`report-list-service.ts`** + 단위 테스트

### Phase 3: Presentation API
4. **AC-002 POST /api/internal/reports** route.ts + route.test.ts
5. **AC-008 GET /api/reports** route.ts + route.test.ts
6. **AC-007 docs** internal-events-contract.md Section 12 추가

### Phase 4: Presentation UI
7. **AC-003 ReportPanel** + markdown 의존성 추가 (TRD-D-38) + NpcDialog 슬롯 변경
8. **AC-004 socket listener** GamePageClient `npc:report-ready` handler + 토스트 분기
9. **AC-005 ReportHistoryModal** + 패널 헤더 버튼

### Phase 5: 검증
10. **AC-006 NPC 삭제 보존 검증** (수동 + integration)
11. 통합 시나리오 manual test (curl push → UI 패널 갱신 → 새로고침 → 복원)

### Phase 6: PR 분할
PR 1: Phase 1+2 (Data + Logic)
PR 2: Phase 3 (Presentation API + docs)
PR 3: Phase 4 (UI 컴포넌트)
PR 4: Phase 5 (검증 + 토스트 시나리오 + 잡일)

→ 각 PR이 독립적으로 평가/리뷰 가능. PR 2까지 머지되면 nanobot 팀원이 push 호출자 PR 작업 시작 가능.

---

## 8. References

- Seed: `.harness/ouroboros/seeds/seed-v11.yaml`
- Interview: `.harness/ouroboros/interviews/2026-05-29-v11-reports.yaml`
- v10 Reuse:
  - `deskrpg/src/lib/internal-chat-push-handler.ts` (handler 패턴)
  - `deskrpg/src/app/api/internal/chat-push/route.ts` (route 패턴)
  - `deskrpg/src/lib/nanobot-client.cjs:215` (chatSend metadata 사용처)
  - `deskrpg/drizzle/0008_v10_chat_messages_push.sql` (migration 형식)
- Architecture: `ARCHITECTURE_INVARIANTS.md` Part 1 (3-tier + DTO 통신)
- Contract: `docs/api/internal-events-contract.md` (Section 12 신설 예정)
