# Architecture Diagrams — RegTrack

> 본 문서는 seed-v4 + PRD v4 + TRD v2의 아키텍처 결정을 **시각화**한 다이어그램 모음입니다.
> Mermaid 문법으로 작성되어 GitHub·Obsidian·VSCode에서 자동 렌더링됩니다.
> 한국어 주 + 영어 기술 용어 병기.

| 항목 | 내용 |
|------|------|
| **버전** | v1 |
| **작성일** | 2026-05-16 |
| **출처** | seed-v4 · PRD v4 · TRD v2 |
| **포맷** | Mermaid (C4 + sequenceDiagram + flowchart) |

---

## 목차

- [1. C4 모델](#1-c4-모델)
  - [1.1 System Context (Level 1)](#11-system-context-level-1)
  - [1.2 Container (Level 2)](#12-container-level-2)
  - [1.3 Component — Backend (Level 3)](#13-component--backend-level-3)
  - [1.4 Component — Frontend (Level 3)](#14-component--frontend-level-3)
- [2. 시퀀스 다이어그램](#2-시퀀스-다이어그램)
  - [SEQ-1 사용자 캐릭터 입장](#seq-1-사용자-캐릭터-입장)
  - [SEQ-2 크롤링 → 신규 발견 → NPC Report](#seq-2-크롤링--신규-발견--npc-report)
  - [SEQ-3 askAnalystNPC → RAG → Citation](#seq-3-askanalystnpc--rag--citation)
  - [SEQ-4 LLM 사용량 위젯 실시간 push](#seq-4-llm-사용량-위젯-실시간-push)
  - [SEQ-5 주간 회의 conduct → 디지스트 → 낭독](#seq-5-주간-회의-conduct--디지스트--낭독)
  - [SEQ-6 LPC 아바타 커스터마이징](#seq-6-lpc-아바타-커스터마이징)
  - [SEQ-7 Vault 작성 + Obsidian Git plugin push](#seq-7-vault-작성--obsidian-git-plugin-push)
- [3. Deployment](#3-deployment)
- [4. Layer Dependency 검증 (게이트)](#4-layer-dependency-검증-게이트)

---

## 1. C4 모델

### 1.1 System Context (Level 1)

> RegTrack 시스템과 외부 actor·external system의 관계.

```mermaid
C4Context
    title System Context — RegTrack (시연용)

    Person(user, "이지영 대리 (가상)", "리테일 컴플라이언스<br/>사용자 캐릭터로 입장")
    Person(team, "팀원 (4인)", "PM/QA/개발<br/>vault 공유")
    Person(advisor, "어드바이저", "주간 retro·대형 변경 결정")

    System(regtrack, "RegTrack", "규제 자동 모니터링 + RPG 대시보드<br/>+ 주간 컴플 회의실")

    System_Ext(fss, "FSS 웹사이트", "금감원 보도·규정·해설 게시판")
    System_Ext(others, "BOK·FSC·NA·BCBS 웹", "INTERFACE_ONLY mock (4개)")
    System_Ext(openai, "OpenAI / Claude API", "LLM 영향도 분석·디지스트")
    System_Ext(github, "GitHub", "코드 repo + Vault private repo")

    Rel(user, regtrack, "RPG 대시보드 입장·필터·NPC 질문", "Browser HTTPS")
    Rel(team, regtrack, "코드 push·PR 리뷰", "git")
    Rel(team, github, "Vault private repo pull/push", "Obsidian Git plugin")
    Rel(advisor, team, "주간 retro 대형 변경 승인")

    Rel(regtrack, fss, "scrape (보도·규정·해설)", "HTTPS")
    Rel(regtrack, others, "scrape (mock 1건씩)", "HTTPS")
    Rel(regtrack, openai, "LLM API 호출", "HTTPS")
    Rel(regtrack, github, "code push", "git")

    UpdateRelStyle(user, regtrack, $offsetY="-30", $offsetX="-30")
    UpdateRelStyle(regtrack, openai, $offsetY="-20")
```

**핵심 관계**:
- 사용자는 브라우저로만 RegTrack에 접근 (시연용, 1인 모드)
- Vault는 RegTrack에서 markdown만 작성 → Obsidian Git plugin을 통해 사용자가 수동 push (D-6 v2)
- 외부 시스템: 5개 규제 사이트 + LLM API + GitHub

---

### 1.2 Container (Level 2)

> RegTrack 내부의 배포 단위(container). docker compose 4개 서비스 + Vault 디렉토리.

```mermaid
C4Container
    title Container — RegTrack (단일 노트북, docker compose)

    Person(user, "사용자", "브라우저")

    Container_Boundary(regtrack, "RegTrack") {
      Container(fe, "Frontend", "Next.js + TypeScript<br/>(deskrpg fork)", "RPG 대시보드·회의실·아바타·LLM 위젯")
      Container(be, "Backend", "Python + FastAPI<br/>(nanobot fork)", "API·WebSocket·Agent·Service·Scheduler")
      Container(crawler, "Crawler", "Python<br/>(scrapy/playwright)", "5개 소스 polling·Flexible Parser")
      ContainerDb(sqlite, "SQLite", "단일 파일 DB", "18 entities + crawl_jobs 작업 큐")
      Container(vault, "Vault 디렉토리", "Markdown + Obsidian Git plugin", "규제 원문 + frontmatter<br/>사용자 수동 push")
      Container(bm25, "BM25 인덱스", "rank_bm25 + Kiwi 토큰 (pickle)", "한국어 형태소 RAG")
    }

    System_Ext(sites, "5개 규제 사이트", "FSS·BOK·FSC·NA·BCBS")
    System_Ext(llm, "OpenAI/Claude API")
    System_Ext(repo, "GitHub Vault Private")

    Rel(user, fe, "Browser HTTPS", "http://localhost:3000")
    Rel(fe, be, "REST + WebSocket", "http://localhost:8000")

    Rel(be, sqlite, "Repository pattern", "SQLAlchemy")
    Rel(be, vault, "markdown write", "filesystem")
    Rel(be, bm25, "tokenize + search", "in-process")
    Rel(be, llm, "LLM API", "HTTPS")

    Rel(crawler, sites, "scrape", "HTTPS")
    Rel(crawler, sqlite, "crawl_jobs insert", "SQLAlchemy")

    Rel_Back(user, vault, "Ctrl+Shift+P → Commit & Push", "Obsidian Git plugin")
    Rel(vault, repo, "git push (수동)", "git+ssh")

    UpdateRelStyle(fe, be, $offsetY="-20")
```

**왜 이 분리인가**:
- **Frontend ↔ Backend**: REST + WebSocket (D-1)
- **Crawler ↔ Backend**: 공유 SQLite 작업 큐 (D-2) — 다른 인프라 0
- **Vault sync**: Obsidian Git plugin (D-6 v2) — 백엔드 git subprocess 제거

---

### 1.3 Component — Backend (Level 3)

> Backend 컨테이너 내부의 모듈 구조 (TRD §2.2 매핑).

```mermaid
C4Component
    title Component — Backend (nanobot fork + FastAPI)

    Container(fe, "Frontend", "Next.js")
    ContainerDb(sqlite, "SQLite")
    System_Ext(llm, "LLM API")

    Container_Boundary(be, "Backend") {
      Component(api_http, "API/http", "FastAPI Routers", "regulations·impact·meeting·avatar·filter·llm_usage")
      Component(api_ws, "API/websocket", "FastAPI WS", "npc-reports·llm-usage")

      Component(svc_impact, "services.impact", "Python", "analyzeImpact + Citation 강제 (BR-1)")
      Component(svc_rag, "services.rag", "Kiwi + rank_bm25", "한국어 BM25 검색")
      Component(svc_llm, "services.llm", "LLMClient + cache", "OpenAI/Claude wrapper + usage tracker (BR-2 + WS push)")
      Component(svc_cls, "services.classifier", "Python", "신규/개정 + diff_summary")
      Component(svc_meet, "services.meeting", "Python", "scheduleWeeklyMeeting + conductMeeting + DigestGenerator (BR-3)")
      Component(svc_notif, "services.notifier", "Python", "NPCReport 생성 + WS push")

      Component(agent_crawl, "agents.CrawlerAgent", "nanobot Agent", "crawl_jobs 후처리·VaultDocument write")
      Component(agent_analyzer, "agents.ImpactAnalyzerAgent", "nanobot Agent", "ImpactAnalysis 오케스트레이션")

      ComponentDb(repo, "data.repositories", "SQLAlchemy 2.x", "RegulationRepo·ImpactRepo·MeetingRepo·UsageRepo·...")
      Component(writer, "data.vault.writer", "Python", "markdown 파일 작성 (git 호출 X)")
      Component(domain, "domain", "Pydantic", "DTO + Domain Model")
    }

    Rel(fe, api_http, "REST", "HTTP")
    Rel(fe, api_ws, "WebSocket", "WS")

    Rel(api_http, svc_impact, "ask impact")
    Rel(api_http, svc_meet, "conduct meeting")
    Rel(api_http, repo, "list·get (via DI)")

    Rel(svc_impact, svc_rag, "search top-k")
    Rel(svc_impact, svc_llm, "complete")
    Rel(svc_impact, repo, "persist")

    Rel(svc_meet, svc_llm, "digest")
    Rel(svc_meet, svc_notif, "push MEETING_DIGEST")

    Rel(agent_crawl, repo, "find_unprocessed crawl_jobs")
    Rel(agent_crawl, svc_cls, "classify")
    Rel(agent_crawl, writer, "write markdown")
    Rel(agent_crawl, svc_notif, "push NEW_REGULATION")

    Rel(svc_llm, llm, "API call")
    Rel(svc_llm, api_ws, "broadcast LlmUsageSnapshot", "WS")
    Rel(svc_notif, api_ws, "broadcast NPCReport", "WS")

    Rel(repo, sqlite, "SQL")
    Rel(svc_rag, repo, "fetch raw_text")
```

**비즈니스 규칙 위치**:
- BR-1 (Citation 강제): `services.impact`
- BR-2 (LLM 예산 가드 + 위젯 push): `services.llm`
- BR-3 (회의 디지스트 4항목): `services.meeting`

---

### 1.4 Component — Frontend (Level 3)

> Frontend 컨테이너 내부의 컴포넌트 트리 + 상태 관리.

```mermaid
flowchart TB
    subgraph fe["Frontend (Next.js + TypeScript)"]
        direction TB
        subgraph applayout["AppLayout (모든 Scene 공통)"]
            widget["&lt;LlmUsageWidget /&gt;<br/>(v2 — 우측 상단 floating)<br/>WS: /ws/llm-usage"]
        end

        subgraph scenes["Scenes"]
            direction LR

            subgraph dash["DashboardScene"]
                rpgmap["&lt;RpgMap /&gt;"]
                player["&lt;PlayerCharacter /&gt;<br/>(LPC 합성)"]
                npcs["&lt;NpcSprites /&gt;"]
                toasts["&lt;NpcReportToasts /&gt;<br/>WS: /ws/npc-reports"]
                filter["&lt;FilterPanel /&gt;"]
                cards["&lt;RegulationCardList /&gt;"]
                timeline["&lt;Timeline /&gt;"]
                chat["&lt;ChatBubble /&gt;<br/>(askAnalystNPC)"]
            end

            subgraph meet["MeetingScene (v2)"]
                room["&lt;MeetingRoom /&gt;"]
                seated["&lt;SeatedAgents /&gt;<br/>(안무 시퀀스)"]
                sub["&lt;DigestSubtitle /&gt;"]
                card["&lt;DigestCard /&gt;<br/>(a/b/c/d 4항목)"]
            end

            subgraph avatar["AvatarModal (v2)"]
                lpc["&lt;LpcPartSelector /&gt;"]
                preview["&lt;SpritePreview /&gt;"]
                save["&lt;SaveButton /&gt;"]
            end
        end

        subgraph state["State (Zustand)"]
            llmstore["llmUsageStore"]
            reportstore["npcReportStore"]
            filterstore["dashboardFilterStore"]
        end

        subgraph apiclient["lib/api (자동 생성 타입)"]
            http["HTTP client"]
            ws["WebSocket client"]
        end
    end

    be["Backend FastAPI"]

    widget --> llmstore
    toasts --> reportstore
    filter --> filterstore
    chat --> http
    save --> http
    cards --> http

    http -.REST.-> be
    ws -.WS.-> be

    llmstore -.subscribe.-> ws
    reportstore -.subscribe.-> ws

    classDef v2 fill:#fff4cc,stroke:#d4a017
    class widget,meet,avatar,room,seated,sub,card,lpc,preview,save v2
```

> 노랑 박스는 v2 신규 (LLM 위젯 + 회의실 + 아바타 모달).

---

## 2. 시퀀스 다이어그램

### SEQ-1 사용자 캐릭터 입장

> AC-005 Frame 1. `enterDashboard` 액션.

```mermaid
sequenceDiagram
    autonumber
    actor U as 사용자 캐릭터
    participant FE as Frontend (DashboardScene)
    participant API as Backend api/http
    participant Repo as data.repositories
    participant WS as Backend api/websocket
    participant LU as services.llm.usage_tracker

    U->>FE: /dashboard 진입
    FE->>API: GET /api/user-characters/me
    API->>Repo: get UserCharacter (with lpc_parts)
    Repo-->>API: UserCharacter
    API-->>FE: UserCharacterDTO

    FE->>API: GET /api/agents/active
    API->>Repo: find agents WHERE status IN (IDLE, WORKING)
    Repo-->>API: list[Agent]
    API-->>FE: AgentDTO[]

    FE->>API: GET /api/npc-reports/pending
    API->>Repo: find NPCReport WHERE acknowledged_at IS NULL
    Repo-->>API: list[NPCReport]
    API-->>FE: NpcReportDTO[]

    par WebSocket 구독
        FE->>WS: WS /ws/npc-reports
        WS-->>FE: connection established
    and
        FE->>WS: WS /ws/llm-usage
        WS-->>FE: connection established
        LU-->>WS: 최초 LlmUsageSnapshot (latest)
        WS-->>FE: LlmUsageSnapshot
    end

    Note over FE,U: RPG 맵 렌더 (PlayerCharacter LPC 합성)<br/>NPC sprite 배치 + Pending 보고 표시<br/>LlmUsageWidget 우측 상단 표시
```

---

### SEQ-2 크롤링 → 신규 발견 → NPC Report

> AC-001, AC-002. `crawlRegulationSource` + `classifyChangeType` + NPCReport push.

```mermaid
sequenceDiagram
    autonumber
    participant CR as Crawler 서비스
    participant FSS as FSS 웹사이트
    participant SQ as SQLite (crawl_jobs)
    participant Sched as Backend APScheduler (30s 폴링)
    participant CA as agents.CrawlerAgent
    participant CLS as services.classifier
    participant WR as data.vault.writer
    participant Vault as vault/ 디렉토리
    participant N as services.notifier
    participant WS as /ws/npc-reports
    participant FE as Frontend (DashboardScene)
    participant U as 사용자

    rect rgb(240,250,240)
    Note over CR,SQ: Crawler 프로세스 (별도 컨테이너)
    CR->>FSS: GET 보도자료 게시판
    FSS-->>CR: HTML
    CR->>CR: Flexible Parser → Regulation 후보
    CR->>SQ: INSERT crawl_jobs (status=COMPLETED, payload=raw)
    end

    rect rgb(240,240,255)
    Note over Sched,N: Backend 프로세스
    Sched->>SQ: SELECT * FROM crawl_jobs WHERE processed_at IS NULL
    SQ-->>Sched: list[CrawlJob]
    loop for each job
        Sched->>CA: handle(job)
        CA->>CLS: classify(candidate)
        CLS-->>CA: change_type=NEW (또는 AMENDED)
        CA->>SQ: INSERT Regulation
        CA->>WR: write_regulation(reg)
        WR->>Vault: vault/FSS/보도/2026/05/16-xxx.md 작성
        WR-->>CA: VaultDocument
        CA->>N: push_npc_report(agent_id, NEW_REGULATION, payload)
        N->>SQ: INSERT npc_reports
        N->>WS: broadcast NpcReportEvent
        Sched->>SQ: UPDATE crawl_jobs SET processed_at=NOW()
    end
    end

    rect rgb(250,240,240)
    Note over WS,U: 실시간 push
    WS-->>FE: NpcReportEvent {type: NEW_REGULATION, payload: ...}
    FE->>FE: NPC 머리 위 ❗ 글로우 + 알림음
    U->>FE: NPC 클릭
    FE-->>U: 규제 카드 (제목·시각·요약)
    end
```

> AC-002 latency 측정: `CrawlJob.finished_at` → `NPCReport.created_at` 차이가 ≤ 1h.

---

### SEQ-3 askAnalystNPC → RAG → Citation

> AC-003, AC-005 Frame 3-4. **BR-1 Citation 강제** 규칙 적용.

```mermaid
sequenceDiagram
    autonumber
    actor U as 사용자
    participant FE as Frontend (ChatBubble)
    participant API as api/http/impact.py
    participant IA as services.impact.ImpactAnalyzer
    participant RAG as services.rag.BM25Search
    participant Repo as data.repositories
    participant LLM as services.llm.LLMClient
    participant LU as services.llm.usage_tracker
    participant WS as /ws/llm-usage
    participant N as services.notifier

    U->>FE: 분석 NPC 클릭 → "리테일 영향" 입력
    FE->>API: POST /api/impact/ask {regulationId, dept: "리테일"}

    API->>IA: analyze_impact(reg_id, dept)
    IA->>Repo: get Regulation (raw_text 포함)
    Repo-->>IA: Regulation
    IA->>RAG: search(query="리테일", doc=raw_text, top_k=5)
    RAG->>RAG: Kiwi 토큰화 + BM25 점수
    RAG-->>IA: top_k hits (char_offset 포함)

    alt hits 없음
        IA-->>API: InsufficientEvidenceError
        API-->>FE: 400 {error: "근거 없음"}
        FE-->>U: NPC 슬픈 말풍선
    else hits 있음
        IA->>LLM: complete(IMPACT_PROMPT, hits, require_citation=true)
        LLM->>LLM: prompt cache 확인
        LLM->>LU: track_and_warn(record)
        LU->>Repo: INSERT LLMUsageRecord
        LU->>WS: broadcast LlmUsageSnapshot
        LLM-->>IA: LlmResponse {severity, summary, citations}

        IA->>IA: Citation extract + char_offset 검증
        alt Citation 0개
            IA-->>API: CitationMissingError (BR-1 위반)
            API-->>FE: 422
        else Citation ≥ 1
            IA->>Repo: INSERT ImpactAnalysis + Citation[]
            IA->>N: push_npc_report(ANALYSIS_READY)
            IA-->>API: ImpactAnalysis
            API-->>FE: ImpactAnalysisDTO
            FE-->>U: 말풍선 "리테일 영향: HIGH ⚠️<br/>근거: '제5조 ②항...'"
            U->>FE: 인용 클릭
            FE-->>U: Obsidian vault 원문 뷰어 (우측 패널)
        end
    end
```

> **핵심**: Citation 0개면 분석 자체를 reject (BR-1). hallucination 방어 강제.

---

### SEQ-4 LLM 사용량 위젯 실시간 push

> AC-008 (v3·v4 high). 모든 Scene 공통 floating 위젯이 매 LLM 호출 직후 갱신.

```mermaid
sequenceDiagram
    autonumber
    participant Anyone as Anyone calling LLM<br/>(impact·meeting·classifier·digest)
    participant LLM as services.llm.LLMClient
    participant Cache as prompt cache
    participant API as OpenAI/Claude API
    participant LU as services.llm.usage_tracker
    participant Repo as data.repositories
    participant WSB as /ws/llm-usage broker
    participant FE as Frontend (LlmUsageWidget)
    participant U as 사용자

    Anyone->>LLM: complete(prompt)
    LLM->>Cache: lookup(prompt_hash)

    alt cache hit
        Cache-->>LLM: cached response
        LLM->>LU: track_and_warn(record{cached: true, cost: 0.0})
    else cache miss
        LLM->>API: chat.completions.create(...)
        API-->>LLM: response (input/output tokens)
        LLM->>Cache: store
        LLM->>LU: track_and_warn(record{cached: false, cost: $X})
    end

    LU->>Repo: INSERT LLMUsageRecord
    LU->>Repo: aggregate snapshot {cost_usd, call_count, cache_hit_rate, last_model}
    LU->>WSB: broadcast LlmUsageSnapshot

    par 모든 연결된 클라이언트
        WSB-->>FE: LlmUsageSnapshot
        FE->>FE: useLlmUsageStore.update(snapshot)
        FE->>U: 위젯 갱신<br/>💰 $X / 📞 N / ⚡ M% / 🤖 model
    end

    alt cumulative cost ≥ $40 AND !already_warned
        LU->>LU: push NPCReport(ERROR, "budget warn")
        Note over U: 위젯 노랑 색상 + NPC ERROR 보고
    end
```

---

### SEQ-5 주간 회의 conduct → 디지스트 → 낭독

> AC-011. **BR-3 디지스트 4항목 강제** + D-4 클라이언트 자체 애니메이션.

```mermaid
sequenceDiagram
    autonumber
    actor U as 사용자
    participant FE as Frontend (MeetingScene)
    participant API as api/http/meeting.py
    participant MO as services.meeting.MeetingOrchestrator
    participant DG as services.meeting.DigestGenerator
    participant Repo as data.repositories
    participant LLM as services.llm.LLMClient
    participant N as services.notifier
    participant WS as /ws/npc-reports

    U->>FE: 사무실 옆 회의실 문 클릭
    FE->>API: GET /api/meeting/current
    API->>Repo: find MeetingSession (status=SCHEDULED, scheduled_for ≤ now)
    Repo-->>API: MeetingSession
    API-->>FE: MeetingSessionDTO

    FE->>API: POST /api/meeting/:id/conduct
    API->>MO: conduct(session_id)

    MO->>DG: generate_digest(session)
    DG->>Repo: find Regulation WHERE detected_at BETWEEN window
    DG->>Repo: find ImpactAnalysis WHERE regulation_id IN (...)
    DG->>DG: high_impacts filter + top 선정

    alt window 비어있음
        DG-->>MO: EmptyWindowError
        MO-->>API: 422 (시연 직전 mock 데이터로 방지)
    else 데이터 있음
        DG->>LLM: complete(DIGEST_PROMPT, top.summary, ...)
        LLM-->>DG: digest_text + recommendation
        DG->>Repo: INSERT MeetingReport (a,b,c,d 4항목)
        DG-->>MO: MeetingReport

        Note over MO: BR-3 검증: a/b/c/d 모두 채워졌는지

        MO->>Repo: UPDATE MeetingSession (status=COMPLETED)
        MO->>N: push_npc_report(MEETING_DIGEST, report_id)
        N->>WS: broadcast NpcReportEvent
        MO-->>API: MeetingReportDTO
        API-->>FE: MeetingReportDTO
    end

    rect rgb(255,250,230)
    Note over FE,U: 클라이언트 자체 애니메이션 (D-4)
    FE->>FE: 회의실 씬 렌더 (deskrpg 미팅룸 자산)
    FE->>FE: NPC 좌석 이동 안무 (사전 정의)
    FE->>U: 분석 NPC 일어서서 디지스트 자막 낭독
    FE->>U: 우측에 DigestCard (4항목 a/b/c/d)
    end
```

---

### SEQ-6 LPC 아바타 커스터마이징

> AC-012. `customizeAvatar` 액션 + 영속화 + 재로드.

```mermaid
sequenceDiagram
    autonumber
    actor U as 사용자
    participant FE as Frontend (AvatarModal)
    participant API as api/http/avatar.py
    participant Repo as data.repositories
    participant SQ as SQLite

    U->>FE: 캐릭터 클릭 → 아바타 모달 오픈
    FE->>API: GET /api/avatar
    API->>Repo: get UserCharacter
    Repo-->>API: UserCharacter (lpc_parts JSON)
    API-->>FE: {head, body, hair, outfit, ...}

    FE-->>U: LpcPartSelector 렌더<br/>SpritePreview 합성 표시

    loop 부품 변경
        U->>FE: 부품 선택 (예: hair → blue_long)
        FE->>FE: SpritePreview 즉시 재합성
    end

    U->>FE: SaveButton 클릭
    FE->>API: PUT /api/avatar {lpc_parts}
    API->>API: 유효성 검증 (LPC 카테고리당 1개, 미존재 자산 거부)
    API->>Repo: update UserCharacter.lpc_parts
    Repo->>SQ: UPDATE user_characters SET lpc_parts = ?
    Repo-->>API: UserCharacter
    API-->>FE: 200

    FE->>FE: 모달 close
    FE->>FE: PlayerCharacter sprite 재합성 (즉시 반영)

    Note over U,SQ: 영속화 검증<br/>(다음 로그인 시 동일 sprite 유지 — AC-012)
```

---

### SEQ-7 Vault 작성 + Obsidian Git plugin push

> AC-006 (v4 단순화). 백엔드는 markdown만 작성, push는 사용자가 Obsidian에서 수동.

```mermaid
sequenceDiagram
    autonumber
    participant CA as agents.CrawlerAgent
    participant WR as data.vault.writer
    participant FS as vault/ 디렉토리 (filesystem)
    participant Plugin as Obsidian Git plugin
    actor U as 사용자
    participant GH as GitHub<br/>(Private Vault Repo)
    actor TM as 팀원 3인

    rect rgb(240,250,240)
    Note over CA,FS: Backend (자동)
    CA->>WR: write_regulation(reg, analysis)
    WR->>WR: build_frontmatter + build_markdown_body
    WR->>FS: write vault/FSS/보도/2026/05/16-xxx.md
    Note over WR: ★ git 호출 없음 (v4 단순화)
    WR-->>CA: VaultDocument
    end

    rect rgb(255,250,240)
    Note over Plugin: Obsidian Git plugin (vault 안)
    Plugin->>FS: file watcher 감지
    Plugin->>Plugin: 변경 파일 git add (자동)
    Note over Plugin: autoSaveInterval=0<br/>autoPushInterval=0<br/>(설정상 자동 push X)
    end

    rect rgb(250,240,240)
    Note over U,GH: 사용자 수동 트리거
    U->>Plugin: Ctrl+Shift+P → "Obsidian Git: Commit and push"
    Plugin->>Plugin: pullBeforePush=true → fetch + rebase
    Plugin->>GH: git push origin main (SSH)
    GH-->>Plugin: success
    Plugin-->>U: 상태바 ✓
    end

    rect rgb(240,240,250)
    Note over TM,GH: 팀원 공유
    TM->>GH: git pull (Obsidian Git plugin 또는 CLI)
    GH-->>TM: 최신 vault
    end

    Note over U,GH: 권장 시점:<br/>① 시연 데모 직전<br/>② 주간 retro 후
```

---

## 3. Deployment

> 단일 노트북 + docker compose 구성. TRD §8 참조.

```mermaid
flowchart LR
    subgraph Host["사용자 노트북 (시연용)"]
        direction TB

        subgraph Browser["Browser"]
            chrome["Chrome / Safari<br/>http://localhost:3000"]
        end

        subgraph Obsidian["Obsidian.app"]
            obs["Obsidian Editor<br/>+ Git plugin"]
        end

        subgraph Docker["docker compose"]
            direction TB

            subgraph Fe["frontend container"]
                next["Next.js dev server<br/>:3000"]
            end

            subgraph Be["backend container"]
                fastapi["FastAPI + APScheduler<br/>:8000"]
                bm25idx["BM25 index (in-process)"]
            end

            subgraph Cr["crawler container"]
                scrapy["scrapy/playwright<br/>polling worker"]
            end
        end

        subgraph Volumes["Docker Volumes (호스트 마운트)"]
            sqlite_vol[("./data/sqlite.db")]
            vault_vol[("./vault/")]
        end
    end

    subgraph Cloud["External"]
        openai_cloud["OpenAI / Claude<br/>API endpoint"]
        sites["FSS·BOK·FSC·NA·BCBS<br/>웹사이트"]
        gh["GitHub<br/>Private Vault Repo"]
    end

    chrome -- HTTP/WS --> next
    next -- proxy/API --> fastapi
    fastapi --- bm25idx

    fastapi -.read/write.- sqlite_vol
    scrapy -.read/write.- sqlite_vol

    fastapi -.markdown write.- vault_vol
    obs -.read/edit.- vault_vol

    fastapi -- HTTPS --> openai_cloud
    scrapy -- HTTPS --> sites
    obs -- "git push (수동)" --> gh
```

**환경 변수** (`.env.local`, 호스트):
```
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
VAULT_GIT_REMOTE=git@github.com:org/regtrack-vault-private.git
LLM_BUDGET_WARN_USD=40.0
DEFAULT_LLM_MODEL=gpt-4o-mini
```

---

## 4. Layer Dependency 검증 (게이트)

> ARCHITECTURE_INVARIANTS Part 1의 절대 규칙을 시각화. `.harness/gates/check-layers.sh`로 자동 검증.

```mermaid
flowchart TD
    P["Presentation<br/>frontend/"]
    L["Logic<br/>backend/api·agents·services"]
    D["Data<br/>backend/data + vault/"]

    P -->|"✅ REST + WebSocket (DTO)"| L
    L -->|"✅ Repository pattern (DTO)"| D

    P -.->|"❌ 직접 import 금지<br/>(layer skip)"| D
    D -.->|"❌ 역방향 금지"| L
    L -.->|"❌ 역방향 금지"| P

    classDef ok fill:#d4edda,stroke:#155724
    classDef bad fill:#f8d7da,stroke:#721c24
    class P,L,D ok
```

### 위반 예시 (게이트가 차단)
```
❌ frontend/components/RegulationCard.tsx
     import { PrismaClient } from "../../backend/data/..."  // layer skip
❌ backend/data/repositories/regulation_repo.py
     from backend.services.impact import analyzer   // 역방향
❌ backend/services/impact/analyzer.py
     from frontend.components import Modal          // 역방향
```

### 게이트 명령
```bash
.harness/gates/check-layers.sh        # 레이어 분리
.harness/gates/check-boundaries.sh    # 의존성 경계 (boundaries.yaml)
.harness/gates/check-structure.sh     # 디렉토리 구조
```

---

## 5. References

- **Seed**: `.harness/ouroboros/seeds/seed-v4.yaml`
- **PRD**: `docs/prd/PRD-RegTrack-2026-05-16.md` (v4)
- **TRD**: `docs/trd/TRD-RegTrack-2026-05-16.md` (v2)
- **Architecture Invariants**: `ARCHITECTURE_INVARIANTS.md`
- **Boundaries Rules**: `.harness/gates/rules/boundaries.yaml`
- **Mermaid C4 spec**: https://mermaid.js.org/syntax/c4.html
- **Mermaid sequenceDiagram**: https://mermaid.js.org/syntax/sequenceDiagram.html
- **C4 Model**: https://c4model.com/
