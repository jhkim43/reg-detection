# ERD & Schema — RegTrack

> SQLite 스키마 + Obsidian frontmatter 스키마 + BM25 인덱스 영속화 + 마이그레이션 전략.
> seed-v5 + 팀원 obsidian skill(`nanobot/nanobot/skills/obsidian/SKILL.md`) 규칙 기반.
> 한국어 주 + 영어 기술 용어 병기.

| 항목 | 내용 |
|------|------|
| **버전** | v1 |
| **작성일** | 2026-05-16 |
| **출처** | seed-v5 · `nanobot/nanobot/skills/obsidian/SKILL.md` · `nanobot/docs/obsidian-interface.md` |
| **DB 엔진** | SQLite 3 (단일 파일, WAL 모드) |
| **ORM** | SQLAlchemy 2.x |
| **마이그레이션** | Alembic |
| **Vault 저장소** | Obsidian (외부, Local REST API로 접근) |

---

## 목차

- [1. ERD 다이어그램](#1-erd-다이어그램)
- [2. SQLite 테이블 스키마 (18개)](#2-sqlite-테이블-스키마-18개)
- [3. Obsidian Vault 스키마](#3-obsidian-vault-스키마)
- [4. BM25 인덱스 영속화](#4-bm25-인덱스-영속화)
- [5. 마이그레이션 전략 (Alembic)](#5-마이그레이션-전략-alembic)
- [6. 데이터 시드 (Seeds)](#6-데이터-시드-seeds)
- [7. 인덱스·성능 고려사항](#7-인덱스성능-고려사항)
- [8. 자주 쓰는 SQL 예시](#8-자주-쓰는-sql-예시)
- [9. Open Issues](#9-open-issues)

---

## 1. ERD 다이어그램

> Mermaid `erDiagram`. 18 entities + 관계.

```mermaid
erDiagram
    %% ─── Core Regulation 도메인 ───
    REGULATION_SOURCE ||--o{ REGULATION : "has_many"
    REGULATION_SOURCE ||--o{ CRAWL_JOB : "has_many"
    REGULATION ||--o{ REGULATION_VERSION : "has_many"
    REGULATION ||--o{ IMPACT_ANALYSIS : "has_many"
    REGULATION ||--o{ NOTIFICATION : "has_many"
    REGULATION ||--|| VAULT_DOCUMENT : "has_one"
    REGULATION ||--o{ CITATION : "has_many"

    IMPACT_ANALYSIS ||--o{ CITATION : "has_many"
    IMPACT_ANALYSIS }o--|| USER_CHARACTER : "requested_by"

    %% ─── Agent 도메인 ───
    AGENT ||--o{ NPC_REPORT : "has_many"
    AGENT ||--o{ LLM_USAGE_RECORD : "has_many"
    AGENT ||--o{ CRAWL_JOB : "has_many"
    AGENT ||--o{ IMPACT_ANALYSIS : "performs"
    AGENT ||--o| CRAWLER_AGENT : "specialization (is_a)"
    AGENT ||--o| IMPACT_ANALYZER_AGENT : "specialization (is_a)"
    CRAWLER_AGENT }o--|| REGULATION_SOURCE : "assigned_to"
    CRAWL_JOB }o--|| CRAWLER_AGENT : "executed_by"

    %% ─── User 도메인 ───
    USER_CHARACTER ||--o{ NPC_REPORT : "received_by"
    USER_CHARACTER ||--o{ DASHBOARD_FILTER : "owns"
    USER_CHARACTER ||--o{ MEETING_PARTICIPANT : "participates"

    %% ─── Meeting 도메인 (v2) ───
    MEETING_SESSION ||--o{ MEETING_PARTICIPANT : "has_many"
    MEETING_SESSION ||--|| MEETING_REPORT : "produces"
    MEETING_REPORT }o--|| REGULATION : "top_regulation"
    MEETING_REPORT }o--|| CITATION : "top_citation"
    MEETING_PARTICIPANT }o--|| AGENT : "if_agent"
    MEETING_PARTICIPANT }o--|| USER_CHARACTER : "if_user"

    %% ─── 엔티티 정의 ───
    REGULATION {
        uuid id PK
        uuid source_id FK
        string external_id
        string title
        enum board_type "보도|규정|해설"
        enum change_type "NEW|AMENDED"
        datetime published_at
        datetime detected_at
        text source_url
        text vault_path
        text raw_text
    }
    REGULATION_SOURCE {
        uuid id PK
        enum code "FSS|BOK|FSC|NA_GAZETTE|BCBS"
        string name_ko
        text base_url
        enum language "KO|EN"
        enum mvp_status "FULL|INTERFACE_ONLY"
        json parser_config
    }
    REGULATION_VERSION {
        uuid id PK
        uuid regulation_id FK
        int version_no
        text diff_summary "LLM 1줄"
        text snapshot_text
        datetime captured_at
    }
    IMPACT_ANALYSIS {
        uuid id PK
        uuid regulation_id FK
        uuid requested_by_user FK
        string target_department
        enum severity "LOW|MEDIUM|HIGH"
        text summary
        string llm_model
        int token_usage
        datetime created_at
    }
    CITATION {
        uuid id PK
        uuid impact_analysis_id FK
        uuid regulation_id FK
        text quoted_text
        int char_offset_start
        int char_offset_end
        float relevance_score "BM25 score"
    }
    AGENT {
        uuid id PK
        enum agent_type "CRAWLER|IMPACT_ANALYZER"
        string display_name
        string sprite_asset_id "deskrpg key"
        enum status "IDLE|WORKING|REPORTING|ERROR|IN_MEETING"
        uuid current_task_id
    }
    CRAWLER_AGENT {
        uuid id PK_FK_AGENT
        uuid assigned_source_id FK
        int poll_interval_minutes
    }
    IMPACT_ANALYZER_AGENT {
        uuid id PK_FK_AGENT
        enum rag_strategy "BM25|HYBRID"
        enum llm_provider "OPENAI|CLAUDE"
    }
    USER_CHARACTER {
        uuid id PK
        string display_name
        string department
        string sprite_asset_id
        json lpc_parts "head/body/hair/outfit/..."
    }
    CRAWL_JOB {
        uuid id PK
        uuid crawler_agent_id FK
        uuid source_id FK
        datetime started_at
        datetime finished_at
        enum status "RUNNING|SUCCESS|FAILED"
        int items_found
        text parser_error
        datetime processed_at "Backend가 처리 완료한 시각"
    }
    NPC_REPORT {
        uuid id PK
        uuid agent_id FK
        uuid user_character_id FK
        enum report_type "NEW_REGULATION|ANALYSIS_READY|ERROR|MEETING_DIGEST"
        string payload_ref "Regulation.id|ImpactAnalysis.id|MeetingReport.id"
        string visual_effect
        string audio_effect
        datetime created_at
        datetime acknowledged_at
    }
    NOTIFICATION {
        uuid id PK
        uuid regulation_id FK
        enum channel "IN_APP|TOAST|BADGE"
        datetime created_at
        datetime read_at
    }
    DASHBOARD_FILTER {
        uuid id PK
        uuid user_character_id FK
        json source_codes "array<string>"
        json change_types "array<enum>"
        json target_departments "array<string>"
        date date_from
        date date_to
    }
    VAULT_DOCUMENT {
        string vault_path PK "Obsidian 상대경로"
        uuid regulation_id FK
        text frontmatter "YAML 직렬화"
        text body_markdown
        string topic_tag "v5 — #regulation/FSS/보도 등"
        json connected_knowledge_links "v5 — [[wikilink]] 목록"
        datetime obsidian_synced_at "v5 — REST API write 시각"
    }
    LLM_USAGE_RECORD {
        uuid id PK
        uuid agent_id FK
        enum provider "OPENAI|CLAUDE"
        string model
        int input_tokens
        int output_tokens
        decimal cost_usd
        bool cached
        datetime created_at
    }
    MEETING_SESSION {
        uuid id PK
        datetime scheduled_for
        datetime started_at
        datetime ended_at
        enum status "SCHEDULED|IN_PROGRESS|COMPLETED|FAILED"
        string room_scene_id
        datetime digest_window_start
        datetime digest_window_end
    }
    MEETING_PARTICIPANT {
        uuid id PK
        uuid meeting_session_id FK
        enum participant_type "AGENT|USER"
        uuid agent_id FK_nullable
        uuid user_character_id FK_nullable
        string seat_position "(x,y) 직렬화"
        int speaking_order
    }
    MEETING_REPORT {
        uuid id PK
        uuid meeting_session_id FK
        int new_regulation_count "a"
        int high_severity_count "b"
        uuid top_regulation_id FK "c"
        uuid top_citation_id FK "c"
        text next_week_recommendation "d"
        text digest_text
        string llm_model
        int token_usage
        datetime created_at
    }
```

---

## 2. SQLite 테이블 스키마 (18개)

> 모든 PK는 `TEXT`로 저장된 UUID v4 (Python `uuid.uuid4().hex`).
> 모든 datetime은 ISO 8601 문자열로 저장 (SQLite 표준).
> 모든 enum은 CHECK 제약으로 강제 (SQLite는 native enum 없음).

### 2.1 `regulation_sources` (5건 시드)

```sql
CREATE TABLE regulation_sources (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE CHECK (code IN ('FSS','BOK','FSC','NA_GAZETTE','BCBS')),
    name_ko     TEXT NOT NULL,
    base_url    TEXT NOT NULL,
    language    TEXT NOT NULL CHECK (language IN ('KO','EN')),
    mvp_status  TEXT NOT NULL CHECK (mvp_status IN ('FULL','INTERFACE_ONLY')),
    parser_config  TEXT NOT NULL,  -- JSON
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.2 `regulations` (수집된 규제)

```sql
CREATE TABLE regulations (
    id            TEXT PRIMARY KEY,
    source_id     TEXT NOT NULL REFERENCES regulation_sources(id),
    external_id   TEXT NOT NULL,
    title         TEXT NOT NULL,
    board_type    TEXT NOT NULL CHECK (board_type IN ('보도','규정','해설')),
    change_type   TEXT NOT NULL CHECK (change_type IN ('NEW','AMENDED')),
    published_at  TEXT NOT NULL,
    detected_at   TEXT NOT NULL,
    source_url    TEXT NOT NULL,
    vault_path    TEXT NOT NULL,
    raw_text      TEXT NOT NULL,
    UNIQUE (source_id, external_id)
);
CREATE INDEX idx_regulations_detected_at ON regulations(detected_at);
CREATE INDEX idx_regulations_board_type ON regulations(board_type);
CREATE INDEX idx_regulations_change_type ON regulations(change_type);
```

### 2.3 `regulation_versions` (개정 이력)

```sql
CREATE TABLE regulation_versions (
    id              TEXT PRIMARY KEY,
    regulation_id   TEXT NOT NULL REFERENCES regulations(id) ON DELETE CASCADE,
    version_no      INTEGER NOT NULL,
    diff_summary    TEXT,            -- LLM 1줄 (nullable for v1)
    snapshot_text   TEXT NOT NULL,
    captured_at     TEXT NOT NULL,
    UNIQUE (regulation_id, version_no)
);
CREATE INDEX idx_versions_regulation ON regulation_versions(regulation_id);
```

### 2.4 `impact_analyses`

```sql
CREATE TABLE impact_analyses (
    id                  TEXT PRIMARY KEY,
    regulation_id       TEXT NOT NULL REFERENCES regulations(id),
    requested_by_user   TEXT REFERENCES user_characters(id),  -- nullable: 자동 생성도 있음
    target_department   TEXT NOT NULL,                         -- v5: 자유 텍스트
    severity            TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH')),
    summary             TEXT NOT NULL,
    llm_model           TEXT NOT NULL,
    token_usage         INTEGER NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_impact_regulation ON impact_analyses(regulation_id);
CREATE INDEX idx_impact_severity ON impact_analyses(severity);
```

### 2.5 `citations` (BR-1 Citation 강제)

```sql
CREATE TABLE citations (
    id                  TEXT PRIMARY KEY,
    impact_analysis_id  TEXT NOT NULL REFERENCES impact_analyses(id) ON DELETE CASCADE,
    regulation_id       TEXT NOT NULL REFERENCES regulations(id),
    quoted_text         TEXT NOT NULL,
    char_offset_start   INTEGER NOT NULL,
    char_offset_end     INTEGER NOT NULL,
    relevance_score     REAL,        -- BM25 score (nullable)
    CHECK (char_offset_end > char_offset_start)
);
CREATE INDEX idx_citations_impact ON citations(impact_analysis_id);
```

### 2.6 `agents` (추상 베이스)

```sql
CREATE TABLE agents (
    id              TEXT PRIMARY KEY,
    agent_type      TEXT NOT NULL CHECK (agent_type IN ('CRAWLER','IMPACT_ANALYZER')),
    display_name    TEXT NOT NULL,
    sprite_asset_id TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('IDLE','WORKING','REPORTING','ERROR','IN_MEETING'))
                    DEFAULT 'IDLE',
    current_task_id TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agents_type_status ON agents(agent_type, status);
```

### 2.7 `crawler_agents` (Agent 1:1 specialization)

```sql
CREATE TABLE crawler_agents (
    id                      TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    assigned_source_id      TEXT NOT NULL REFERENCES regulation_sources(id),
    poll_interval_minutes   INTEGER NOT NULL DEFAULT 60
);
```

### 2.8 `impact_analyzer_agents`

```sql
CREATE TABLE impact_analyzer_agents (
    id              TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    rag_strategy    TEXT NOT NULL CHECK (rag_strategy IN ('BM25','HYBRID')) DEFAULT 'BM25',
    llm_provider    TEXT NOT NULL CHECK (llm_provider IN ('OPENROUTER','OPENAI','CLAUDE'))
                    DEFAULT 'OPENROUTER'   -- v6: OPENROUTER 추가 + default
);
```

### 2.9 `user_characters`

```sql
CREATE TABLE user_characters (
    id              TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    department      TEXT,             -- v5: 자유 텍스트 (시연 '리테일')
    sprite_asset_id TEXT NOT NULL,
    lpc_parts       TEXT NOT NULL DEFAULT '{}',   -- JSON {head, body, hair, outfit, ...}
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.10 `crawl_jobs` (Crawler IPC 작업 큐 — D-2)

```sql
CREATE TABLE crawl_jobs (
    id                  TEXT PRIMARY KEY,
    crawler_agent_id    TEXT NOT NULL REFERENCES crawler_agents(id),
    source_id           TEXT NOT NULL REFERENCES regulation_sources(id),
    started_at          TEXT NOT NULL,
    finished_at         TEXT,
    status              TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCESS','FAILED','COMPLETED')),
    items_found         INTEGER,
    parser_error        TEXT,
    processed_at        TEXT,            -- Backend 후처리 완료 시각 (NULL = pending)
    payload             TEXT             -- JSON: scraped 후보 데이터
);
CREATE INDEX idx_crawl_jobs_unprocessed ON crawl_jobs(processed_at) WHERE processed_at IS NULL;
CREATE INDEX idx_crawl_jobs_status ON crawl_jobs(status);
```

> **D-2 (Crawler IPC)**: Backend가 30초 폴링으로 `WHERE status='COMPLETED' AND processed_at IS NULL` 조회.

### 2.11 `npc_reports`

```sql
CREATE TABLE npc_reports (
    id                  TEXT PRIMARY KEY,
    agent_id            TEXT NOT NULL REFERENCES agents(id),
    user_character_id   TEXT NOT NULL REFERENCES user_characters(id),
    report_type         TEXT NOT NULL CHECK (report_type IN
                            ('NEW_REGULATION','ANALYSIS_READY','ERROR','MEETING_DIGEST')),
    payload_ref         TEXT NOT NULL,
    visual_effect       TEXT NOT NULL,
    audio_effect        TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    acknowledged_at     TEXT
);
CREATE INDEX idx_reports_pending ON npc_reports(user_character_id, acknowledged_at)
    WHERE acknowledged_at IS NULL;
```

### 2.12 `notifications` (stretch — fallback)

```sql
CREATE TABLE notifications (
    id              TEXT PRIMARY KEY,
    regulation_id   TEXT NOT NULL REFERENCES regulations(id),
    channel         TEXT NOT NULL CHECK (channel IN ('IN_APP','TOAST','BADGE')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    read_at         TEXT
);
```

### 2.13 `dashboard_filters`

```sql
CREATE TABLE dashboard_filters (
    id                  TEXT PRIMARY KEY,
    user_character_id   TEXT NOT NULL REFERENCES user_characters(id) ON DELETE CASCADE,
    source_codes        TEXT,            -- JSON array<string>
    change_types        TEXT,            -- JSON array<enum>
    target_departments  TEXT,            -- JSON array<string>
    date_from           TEXT,
    date_to             TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.14 `vault_documents` (v5 — Obsidian 메타)

```sql
CREATE TABLE vault_documents (
    vault_path                  TEXT PRIMARY KEY,            -- Obsidian 상대경로
    regulation_id               TEXT NOT NULL REFERENCES regulations(id),
    frontmatter                 TEXT NOT NULL,                -- YAML 직렬화 (Obsidian이 인식)
    body_markdown               TEXT NOT NULL,
    topic_tag                   TEXT NOT NULL,                -- v5: '#regulation/FSS/보도' 등
    connected_knowledge_links   TEXT NOT NULL DEFAULT '[]',   -- v5: JSON array<string> [[wikilink]]
    obsidian_synced_at          TEXT NOT NULL,                -- v5: REST API write 완료 시각
    created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vault_regulation ON vault_documents(regulation_id);
CREATE INDEX idx_vault_topic ON vault_documents(topic_tag);
```

> **v5 변경**: 실제 markdown 파일은 Obsidian이 관리. 이 테이블은 **백엔드 측 메타 캐시** — REST API 호출 기록 + frontmatter snapshot.

### 2.15 `llm_usage_records` (AC-008 high)

```sql
CREATE TABLE llm_usage_records (
    id              TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL REFERENCES agents(id),
    provider        TEXT NOT NULL CHECK (provider IN ('OPENROUTER','OPENAI','CLAUDE')),  -- v6: OPENROUTER 추가
    model           TEXT NOT NULL,                                                       -- 예: "qwen/qwen-2.5-72b-instruct"
    input_tokens    INTEGER NOT NULL,
    output_tokens   INTEGER NOT NULL,
    cost_usd        REAL NOT NULL,         -- SQLite REAL = double precision
    cached          INTEGER NOT NULL DEFAULT 0 CHECK (cached IN (0,1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_usage_created ON llm_usage_records(created_at);
CREATE INDEX idx_usage_agent ON llm_usage_records(agent_id);
```

### 2.16 `meeting_sessions` (v2)

```sql
CREATE TABLE meeting_sessions (
    id                      TEXT PRIMARY KEY,
    scheduled_for           TEXT NOT NULL,
    started_at              TEXT,
    ended_at                TEXT,
    status                  TEXT NOT NULL CHECK (status IN
                                ('SCHEDULED','IN_PROGRESS','COMPLETED','FAILED'))
                            DEFAULT 'SCHEDULED',
    room_scene_id           TEXT NOT NULL,
    digest_window_start     TEXT NOT NULL,
    digest_window_end       TEXT NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meeting_status ON meeting_sessions(status, scheduled_for);
```

### 2.17 `meeting_participants` (v2)

```sql
CREATE TABLE meeting_participants (
    id                      TEXT PRIMARY KEY,
    meeting_session_id      TEXT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
    participant_type        TEXT NOT NULL CHECK (participant_type IN ('AGENT','USER')),
    agent_id                TEXT REFERENCES agents(id),
    user_character_id       TEXT REFERENCES user_characters(id),
    seat_position           TEXT NOT NULL,        -- "x,y" 직렬화
    speaking_order          INTEGER,
    CHECK ((participant_type='AGENT' AND agent_id IS NOT NULL AND user_character_id IS NULL)
        OR (participant_type='USER'  AND user_character_id IS NOT NULL AND agent_id IS NULL))
);
```

### 2.18 `meeting_reports` (v2 — BR-3 4항목 강제)

```sql
CREATE TABLE meeting_reports (
    id                          TEXT PRIMARY KEY,
    meeting_session_id          TEXT NOT NULL UNIQUE REFERENCES meeting_sessions(id),
    new_regulation_count        INTEGER NOT NULL,                    -- (a)
    high_severity_count         INTEGER NOT NULL,                    -- (b)
    top_regulation_id           TEXT NOT NULL REFERENCES regulations(id),    -- (c)
    top_citation_id             TEXT NOT NULL REFERENCES citations(id),      -- (c)
    next_week_recommendation    TEXT NOT NULL,                       -- (d)
    digest_text                 TEXT NOT NULL,
    llm_model                   TEXT NOT NULL,
    token_usage                 INTEGER NOT NULL,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

> BR-3 강제는 application 레벨 + 위 NOT NULL 컬럼 4개로 양면 검증.

---

## 3. Obsidian Vault 스키마

> 팀원의 `skills/obsidian/SKILL.md`의 "Captain's Special Instructions" 규칙 준수.
> seed-v5 D-9에서 강제.

### 3.1 디렉토리 구조 (Obsidian이 관리)

```
{ObsidianVaultRoot}/
├── .obsidian/                # Obsidian 자체 설정 (commit 대상)
│   ├── community-plugins.json
│   └── plugins/
│       ├── obsidian-local-rest-api/   # 팀원 통합 핵심
│       └── obsidian-git/              # v4 push 정책
│
├── FSS/                      # source_code 디렉토리
│   ├── 보도/                  # board_type
│   │   └── 2026/05/
│   │       └── 16-{external_id}.md
│   ├── 규정/
│   └── 해설/
│
├── BOK/  (mock 1건)
├── FSC/  (mock 1건)
├── NA_GAZETTE/  (mock 1건)
└── BCBS/  (mock 1건 영문)
```

### 3.2 Markdown 파일 형식 (v5 강제 규칙)

각 VaultDocument는 다음 4가지 영역 필수:

```markdown
---
# ── Frontmatter (YAML) ──
regulation_id: 7c3a-...
source: FSS
external_id: FSS-2026-05-15-001
board_type: 보도
change_type: NEW
published_at: 2026-05-15T09:00
detected_at: 2026-05-15T09:32
severity: HIGH                 # ImpactAnalysis가 있을 때만
target_departments:
  - 리테일
source_url: https://fss.or.kr/...

# ── 팀원 SKILL.md 규칙 ──
topic: regulation/FSS/보도     # #topic 태그 (frontmatter version)
tags:
  - regulation
  - FSS
  - 보도
  - 신규
---

# {규제 제목 원문}

본문 markdown — 원문 그대로 보존.

본문 중에 [[금융감독원]] 같은 핵심 키워드는 wikilink로 감싸서
graph view 노드 생성에 기여한다.

## 영향도 분석

- 부서: 리테일
- 심각도: HIGH
- 요약: ...

### 근거 (Citation)

> "제5조 ②항에 따라 ...라고 명시됨"
> (char_offset_start: 1234, char_offset_end: 1298)

## Connected Knowledge

- [[2026-05-10-FSS-보도-001]]   <!-- 유사 규제 -->
- [[리테일 부문 컴플라이언스 정책]]
- [[FSS 보도자료 인덱스]]

#topic
```

### 3.3 frontmatter 필수 키 (검증 기준)

| 키 | 타입 | 필수 | 설명 |
|----|------|------|------|
| `regulation_id` | UUID | ✅ | SQLite와 정합 키 |
| `source` | enum | ✅ | RegulationSource.code |
| `external_id` | string | ✅ | 소스 사이트 ID |
| `board_type` | enum | ✅ | 보도\|규정\|해설 |
| `change_type` | enum | ✅ | NEW\|AMENDED |
| `published_at` | ISO 8601 | ✅ | 원문 발표일 |
| `detected_at` | ISO 8601 | ✅ | 시스템 감지 시각 |
| `source_url` | URL | ✅ | 원문 링크 |
| `severity` | enum | ❌ | ImpactAnalysis 후만 |
| `target_departments` | list<string> | ❌ | ImpactAnalysis 후만 |
| `topic` | string | ✅ (v5) | `#topic` 태그 — graph view용 |
| `tags` | list<string> | ✅ (v5) | Obsidian 태그 시스템 |

### 3.4 본문 필수 섹션 (v5)

| 섹션 | 필수 | 검증 |
|------|------|------|
| `# {제목}` | ✅ | 첫 줄 |
| 본문 (원문) | ✅ | 비어있지 않음 |
| `## 영향도 분석` | ImpactAnalysis 있을 때만 | severity·summary 포함 |
| `### 근거 (Citation)` | 같음 | blockquote + char_offset |
| `## Connected Knowledge` | ✅ (v5) | 최소 1개 `[[wikilink]]` |
| `#topic` (마지막 줄) | ✅ (v5) | tag 시스템 redundancy |

---

## 4. BM25 인덱스 영속화

> Backend의 `services/rag/`에서 관리. Obsidian 검색과 별개의 자체 인덱스 (한국어 형태소 정확도 보장).

### 4.1 인덱스 파일

```
backend/data/rag/bm25_index/
├── corpus.pkl              # list[document_tokens] (Kiwi 토큰화 결과)
├── docids.pkl              # list[regulation_id]
├── bm25_model.pkl          # rank_bm25.BM25Okapi 인스턴스
└── meta.json               # {corpus_size, last_rebuild_at, stopwords_version}
```

### 4.2 토큰화 파이프라인

```python
# services/rag/tokenizer.py 의사코드
from kiwipiepy import Kiwi

kiwi = Kiwi()
STOPWORDS = {"의", "가", "을", "를", "이", "는", "도", "에", ...}

def tokenize(text: str) -> list[str]:
    return [
        token.form
        for token in kiwi.tokenize(text)
        if token.tag.startswith(("N", "V", "M"))    # 명사·동사·관형사
           and token.form not in STOPWORDS
           and len(token.form) > 1
    ]
```

### 4.3 인덱스 빌드/업데이트 전략

| 트리거 | 동작 |
|--------|------|
| 신규 Regulation insert | append → in-memory + 1시간 후 disk persist |
| 인덱스 부재 | 전체 SQLite scan → rebuild |
| stopwords 변경 | 전체 rebuild (meta.json version 증가) |
| 시연 직전 | 강제 rebuild (정확도 보장) |

---

## 5. 마이그레이션 전략 (Alembic)

### 5.1 디렉토리

```
backend/data/sqlite/alembic/
├── alembic.ini
├── env.py
├── script.py.mako
└── versions/
    ├── 0001_initial_schema.py        # 18 tables
    ├── 0002_seed_regulation_sources.py
    └── 0003_seed_default_agents.py
```

### 5.2 초기 마이그레이션 순서

```
M1 (W3):  0001_initial_schema (18 테이블 일괄 생성)
M2 (W3):  0002_seed_regulation_sources (5 sources 시드)
M3 (W3):  0003_seed_default_agents (CrawlerAgent×5 + ImpactAnalyzerAgent×1)
M4 (W3):  0004_seed_default_user (이지영 대리)
```

### 5.3 마이그레이션 명령 (개발자)

```bash
# 새 마이그레이션 생성 (autogen)
alembic revision --autogenerate -m "add: meeting tables"

# 최신 적용
alembic upgrade head

# 한 단계 롤백
alembic downgrade -1

# 현재 버전 확인
alembic current
```

### 5.4 scope governance §17 + 마이그레이션

| 변경 크기 | 마이그레이션 정책 |
|---------|------------------|
| 소형 (parser_config JSON 변경) | 마이그레이션 X (데이터만) |
| 중형 (컬럼 추가) | autogen → review → apply |
| 대형 (테이블 추가/스키마 재설계) | seed-vN 발급 + 마이그레이션 + 다운그레이드 경로 검증 |

---

## 6. 데이터 시드 (Seeds)

### 6.1 RegulationSource 5건 (Alembic 0002)

```python
sources = [
    {"code": "FSS", "name_ko": "금융감독원",
     "base_url": "https://www.fss.or.kr",
     "language": "KO", "mvp_status": "FULL",
     "parser_config": json.dumps({...})},

    {"code": "BOK", "name_ko": "한국은행",
     "base_url": "https://www.bok.or.kr",
     "language": "KO", "mvp_status": "INTERFACE_ONLY",
     "parser_config": "{}"},

    {"code": "FSC", "name_ko": "금융위원회",
     "base_url": "https://www.fsc.go.kr",
     "language": "KO", "mvp_status": "INTERFACE_ONLY",
     "parser_config": "{}"},

    {"code": "NA_GAZETTE", "name_ko": "국회·관보",
     "base_url": "https://likms.assembly.go.kr",
     "language": "KO", "mvp_status": "INTERFACE_ONLY",
     "parser_config": "{}"},

    {"code": "BCBS", "name_ko": "바젤은행감독위원회",
     "base_url": "https://www.bis.org/bcbs/",
     "language": "EN", "mvp_status": "INTERFACE_ONLY",
     "parser_config": "{}"},
]
```

### 6.2 Agent 시드 (Alembic 0003)

```python
# CrawlerAgent: 소스별 1개씩 (총 5)
for src in sources:
    insert(agents, {
        "agent_type": "CRAWLER",
        "display_name": f"{src.code} 수집 NPC",
        "sprite_asset_id": f"crawler-{src.code.lower()}",
        "status": "IDLE"
    })
    insert(crawler_agents, {
        "id": agent_id,
        "assigned_source_id": src.id,
        "poll_interval_minutes": 60 if src.mvp_status == "FULL" else 0,
    })

# ImpactAnalyzerAgent: 1개 (도서관에 거주)
insert(agents, {"agent_type": "IMPACT_ANALYZER", "display_name": "분석 NPC", ...})
insert(impact_analyzer_agents, {
    "rag_strategy": "BM25",
    "llm_provider": "OPENAI",
})
```

### 6.3 Mock 데이터 (AC-007 — 4 소스 stub)

각 INTERFACE_ONLY 소스마다 1건 mock Regulation + VaultDocument:

```python
mock_regulations = [
    {"source": "BOK", "title": "[mock] 지급결제 관련 한은 보도자료",
     "external_id": "BOK-MOCK-001", ...},
    {"source": "FSC", "title": "[mock] 디지털 자산 가이드라인 개정", ...},
    {"source": "NA_GAZETTE", "title": "[mock] 금융소비자보호법 시행령 일부개정", ...},
    {"source": "BCBS", "title": "[mock] BCBS 239 Principles Update (EN)", ...},
]
```

---

## 7. 인덱스·성능 고려사항

### 7.1 시연 데이터량 가정

| 테이블 | 예상 행 수 | 비고 |
|--------|----------|------|
| regulations | 수십 ~ 수백 | FSS 12주 폴링 결과 |
| regulation_versions | 동등 수준 | 개정 가정 1:1 |
| impact_analyses | regulations × 1~2 |  |
| citations | impact_analyses × 1~3 | 평균 1.5개 |
| crawl_jobs | 수천 | 60분 폴링 × 12주 |
| llm_usage_records | 수천 | 위젯 push마다 |
| npc_reports | regulations × 1.5 | NEW + ANALYSIS_READY |
| meeting_sessions | 12 | 주 1회 |
| meeting_reports | 12 |  |

→ 시연용 단순 양 — SQLite로 충분. PostgreSQL 마이그레이션은 future.

### 7.2 핵심 인덱스 정당화

| 인덱스 | 쿼리 시나리오 |
|--------|--------------|
| `idx_regulations_detected_at` | 대시보드 카드 timeline 정렬 |
| `idx_regulations_board_type` + `change_type` | 필터 4종 (AC-004) |
| `idx_crawl_jobs_unprocessed` (partial) | Backend 30초 폴링 (D-2) |
| `idx_reports_pending` (partial) | 사용자 입장 시 미확인 보고 fetch |
| `idx_impact_severity` | 회의 디지스트 HIGH 필터 (AC-011) |
| `idx_usage_created` | LlmUsageSnapshot aggregate |

---

## 8. 자주 쓰는 SQL 예시

### 8.1 대시보드 필터 (AC-004)

```sql
SELECT r.*, ia.severity, ia.target_department
FROM regulations r
LEFT JOIN impact_analyses ia ON r.id = ia.regulation_id
WHERE r.source_id IN (?, ?)                    -- source_codes 필터
  AND r.change_type IN (?, ?)                  -- change_types 필터
  AND (ia.target_department IS NULL OR ia.target_department IN (?))  -- 부서
  AND r.detected_at BETWEEN ? AND ?            -- 날짜 범위
ORDER BY r.detected_at DESC
LIMIT 50;
```

### 8.2 회의 디지스트 데이터 집계 (BR-3)

```sql
-- (a) 신규 건수
SELECT COUNT(*) FROM regulations
WHERE detected_at BETWEEN :window_start AND :window_end;

-- (b) HIGH 영향 건수
SELECT COUNT(*) FROM impact_analyses ia
JOIN regulations r ON ia.regulation_id = r.id
WHERE r.detected_at BETWEEN :start AND :end AND ia.severity = 'HIGH';

-- (c) Top 1건 + Citation
SELECT ia.id AS analysis_id, r.id AS regulation_id, c.id AS citation_id
FROM impact_analyses ia
JOIN regulations r ON ia.regulation_id = r.id
JOIN citations c ON c.impact_analysis_id = ia.id
WHERE r.detected_at BETWEEN :start AND :end
ORDER BY CASE ia.severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
         ia.created_at DESC
LIMIT 1;
```

### 8.3 LLM 사용량 위젯 snapshot (AC-008)

```sql
SELECT
    SUM(cost_usd) AS cumulative_cost_usd,
    COUNT(*) AS total_calls,
    AVG(cached) AS cache_hit_rate,
    (SELECT model FROM llm_usage_records ORDER BY created_at DESC LIMIT 1) AS last_model
FROM llm_usage_records
WHERE created_at >= datetime('now', '-100 calls');   -- 단순 예시
```

### 8.4 신규 vs 개정 분류 (classifyChangeType)

```sql
-- AMENDED 판단: 동일 (source_id, external_id) 존재?
SELECT id, version_no FROM regulation_versions
WHERE regulation_id IN (
    SELECT id FROM regulations WHERE source_id = ? AND external_id = ?
)
ORDER BY version_no DESC LIMIT 1;
```

---

## 9. Open Issues

> 본 ERD에서 결정 보류 항목. scope governance §17의 medium·large 변경으로 처리.

| ID | 항목 | 비고 |
|----|------|------|
| O-1 | `parser_config` JSON 스키마 표준화 | 소형 — FSS scraper 구현 시 결정 |
| O-2 | Obsidian frontmatter `tags` 분류 체계 | 소형 — 시연 데이터 쌓이면서 정착 |
| O-3 | `crawl_jobs.payload` JSON 구조 | 중형 — Crawler 인터페이스 통일 시 |
| O-4 | `lpc_parts` JSON 키 enum (LPC 표준) | 소형 — deskrpg 자산 점검 시 |
| O-5 | 회의 cron schedule 자동 실행 (현재 수동) | 중형 — stretch goal |
| O-6 | PostgreSQL 마이그레이션 (future scope) | 대형 — 12주 후 평가 |
| O-7 | 시연 환경 (Windows+VM vs Mac 단일) | 대형 — PM 회의 — seed-v6 발급 시 |

---

## 10. References

- **Seed**: `.harness/ouroboros/seeds/seed-v5.yaml`
- **PRD**: `docs/prd/PRD-RegTrack-2026-05-16.md` (v4 — v5 갱신 예정)
- **TRD**: `docs/trd/TRD-RegTrack-2026-05-16.md` (v2 — v3 갱신 예정)
- **Architecture**: `docs/architecture/ARCHITECTURE-RegTrack-2026-05-16.md`
- **팀원 obsidian skill**: `nanobot/nanobot/skills/obsidian/SKILL.md`
- **팀원 obsidian interface 가이드**: `nanobot/docs/obsidian-interface.md`
- **SQLite docs**: https://www.sqlite.org/datatype3.html
- **Alembic**: https://alembic.sqlalchemy.org/
- **rank_bm25**: https://github.com/dorianbrown/rank_bm25
- **Kiwi**: https://github.com/bab2min/Kiwi
