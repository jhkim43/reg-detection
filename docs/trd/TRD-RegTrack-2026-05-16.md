# TRD: RegTrack — Technical Reference Document

> **Technical Reference Document v2**
> 본 문서는 PRD-v4 + seed-v4의 결정을 **3-tier layered architecture**로 구현하기 위한 개발자용 기술 설계서입니다.
> ARCHITECTURE_INVARIANTS.md Part 1을 절대 우선 준수합니다.

> **Changelog v1 → v2 (2026-05-16)**:
> - **§2.1**: 모든 Scene 우측 상단에 `<LlmUsageWidget>` 항시 floating 컴포넌트 추가 (seed-v3)
> - **§2.2.x**: `services.llm.usage_tracker`가 WebSocket으로 위젯 데이터 실시간 push (seed-v3)
> - **§2.3.4 Vault sync 전면 재작성**: 백엔드 git subprocess 제거 → **Obsidian Git plugin + 수동 push** (seed-v4)
> - **§4 Directory**: `backend/data/vault/git_sync.py` 제거, `vault/.obsidian/community-plugins/obsidian-git/` 설정 가이드 추가
> - **§5.2 테스트 매트릭스**: AC-006 (low), AC-008 (high) 갱신
> - **§6 D-6**: vault private repo + Obsidian Git plugin
> - **§7.2 Implementation Order**: T-3 단순화, T-12 위젯 hook, T-21.5 LlmUsageWidget 신규
> - **§12 신규**: Scope Change Governance 기술적 지원

---

## 1. Overview

| 항목 | 내용 |
|------|------|
| **TRD 버전** | v2 (Draft) |
| **작성일** | 2026-05-16 |
| **출처(Source)** | `seed-v4.yaml`, `PRD-RegTrack-2026-05-16.md` (v4) |
| **아키텍처 패턴** | 3-tier-layered (Presentation / Logic / Data) |
| **금지 패턴** | Layer skipping (Presentation→Data 직접 접근 금지) |
| **Base repo** | `github.com/jhkim43/reg-detection @ dev/nanobot` |
| **Forks** | 백엔드: nanobot (Python) / 프론트: deskrpg (Next.js+TS) |

### 1.1 목표 요약 (seed-v2 goal.summary)

금융 규제 변동 자동 수집·분석 → deskrpg RPG 대시보드 NPC가 in-world 보고 + 주간 컴플 회의실 디지스트 자동 발표. **FSS 1개 소스 end-to-end MVP**.

### 1.2 핵심 결정 (논의점 결과)

| # | 결정 | 출처 |
|---|------|------|
| **D-1** | Frontend ↔ Backend 통신: **REST(FastAPI) + WebSocket** | 논의점 1 |
| **D-2** | Crawler ↔ Backend IPC: **공유 SQLite 작업 큐 테이블** | 논의점 2 |
| **D-3** | 한국어 BM25 형태소 분석기: **Kiwi (kiwipiepy)** | 논의점 3 |
| **D-4** | MeetingSession 진행: **백엔드 디지스트 1회 발행 + 클라이언트 자체 애니메이션** | 논의점 4 |
| **D-5** | 타입 동기화: **FastAPI OpenAPI → openapi-typescript 자동 생성** | 논의점 5 |

---

## 2. Layer Design

### 2.1 Presentation Layer

> **위치**: `frontend/`
> **런타임**: Next.js 15 (App Router) + TypeScript + React 19, deskrpg fork 베이스
> **상태 관리**: Zustand (또는 deskrpg 원본 store 재활용)
> **빌드**: Turbopack 또는 Next.js 기본
> **금지**: `database` 직접 import, LLM API 직접 호출, Obsidian vault 파일시스템 접근

#### 2.1.1 Scenes (3개) + Global Overlay (1개)

| Scene | 경로 | 책임 | 연결 AC |
|-------|------|------|---------|
| `dashboard` | `/dashboard` | 메인 사무실 RPG 맵, 캐릭터 이동, NPC 클릭/말풍선, 필터·타임라인·카드 | AC-002, AC-004, AC-005 |
| `meeting` | `/meeting/:sessionId` | 주간 컴플 회의실 씬, NPC 좌석 배치, 디지스트 낭독 자막 | AC-011 |
| `avatar` | 모달 (대시보드 내) | LPC 부품 선택·미리보기·저장 | AC-012 |
| **`<LlmUsageWidget>`** *(v2 신규)* | 모든 Scene 우측 상단 floating | 누적 비용 USD · 호출 횟수 · 캐시 적중률 · 직전 모델명 항시 표시 (WebSocket push 갱신) | **AC-008** |

#### 2.1.2 핵심 컴포넌트 트리

```
<AppLayout>
  <LlmUsageWidget />        # v2: 모든 Scene 공통 우측 상단 floating
                            #     props: cost_usd, call_count, cache_hit_rate, last_model
                            #     subscribe: ws://localhost:8000/ws/llm-usage

  <DashboardScene>
    <RpgMap sceneAssets={...} />            # deskrpg 픽셀 맵 렌더
    <PlayerCharacter sprite={lpc_parts} />  # 사용자 캐릭터 (LPC 합성)
    <NpcSprites agents={activeAgents} />    # CrawlerNPC, AnalyzerNPC
    <NpcReportToasts reports={pendingReports} />  # 시각·청각 효과
    <DashboardOverlay>
      <FilterPanel filter={dashboardFilter} />     # 4종 필터
      <RegulationCardList items={filtered} />
      <Timeline events={...} />
    </DashboardOverlay>
    <ChatBubble npc={focusedNpc} />          # askAnalystNPC 입력+응답
  </DashboardScene>

<MeetingScene>
  <MeetingRoom roomSceneId={...} />
  <SeatedAgents participants={...} animation="enter|speak|listen" />
  <DigestSubtitle text={meetingReport.digest_text} />
  <DigestCard
    new={meetingReport.new_regulation_count}
    high={meetingReport.high_severity_count}
    top={meetingReport.top_regulation_id}
    citation={meetingReport.top_citation_id}
    recommendation={meetingReport.next_week_recommendation}
  />
</MeetingScene>

<AvatarModal>
    <LpcPartSelector parts={categories} value={lpcParts} onChange={...} />
    <SpritePreview compose={lpcParts} />
    <SaveButton onClick={persistAvatar} />
  </AvatarModal>
</AppLayout>
```

#### LlmUsageWidget 컴포넌트 상세 (v2)

```typescript
// frontend/components/LlmUsageWidget.tsx
type LlmUsageState = {
  cost_usd: number;          // 누적 비용 (예산 $100 대비 progress bar)
  call_count: number;
  cache_hit_rate: number;    // 0.0 ~ 1.0
  last_model: string;        // "gpt-4o-mini" 등
};

// WebSocket subscription
const ws = useWebSocket("/ws/llm-usage");
const usage = useLlmUsageStore();
ws.onmessage = (e) => usage.update(JSON.parse(e.data));

// 색상 임계
// cost_usd >= 40: 노란색, >= 80: 빨간색
// position: fixed, top: 16px, right: 16px, z-index: 9999 (모든 Scene 위에)
```

#### 2.1.3 API 클라이언트 (`frontend/lib/api/`)

```typescript
// 자동 생성된 타입 (openapi-typescript)
import type { paths } from "./generated/openapi.d.ts";

// HTTP 클라이언트
export const api = {
  regulations: {
    list: (filter: DashboardFilterDTO) => GET<RegulationDTO[]>("/api/regulations", filter),
    get: (id: string) => GET<RegulationDTO>(`/api/regulations/${id}`),
  },
  impact: {
    ask: (regulationId: string, dept: string) =>
      POST<ImpactAnalysisDTO>("/api/impact/ask", { regulationId, dept }),
  },
  meeting: {
    getCurrent: () => GET<MeetingSessionDTO>("/api/meeting/current"),
    conduct: (sessionId: string) => POST<MeetingReportDTO>(`/api/meeting/${sessionId}/conduct`),
  },
  avatar: {
    save: (parts: LpcPartsDTO) => PUT<UserCharacterDTO>("/api/avatar", parts),
  },
};

// WebSocket 클라이언트 (NPCReport push)
export const ws = new ReconnectingWebSocket("ws://localhost:8000/ws/npc-reports");
ws.onmessage = (event) => {
  const report: NpcReportEvent = JSON.parse(event.data);
  npcReportStore.push(report);  // Zustand 액션
};
```

#### 2.1.4 입력 검증 규칙

| 입력 | 검증 |
|------|------|
| `askAnalystNPC` 자연어 질문 | 1~500자, HTML 이스케이프 |
| `applyFilter` source_codes | enum(FSS, BOK, FSC, NA_GAZETTE, BCBS) 부분 집합 |
| `customizeAvatar` lpc_parts | LPC 카테고리당 1개 부품, 미존재 자산 거부 |

> 모든 입력 검증은 **백엔드에서 다시 한 번** 검증 (Pydantic). 프론트 검증은 UX 목적일 뿐.

---

### 2.2 Logic Layer

> **위치**: `backend/`
> **런타임**: Python 3.11+, nanobot fork
> **API 프레임워크**: FastAPI (REST + WebSocket)
> **태스크 큐**: 공유 SQLite + 폴링 (Crawler IPC) + APScheduler (회의실 시연 트리거)
> **금지**: Next.js 컴포넌트 import, `database` 직접 SQL (Repository만 경유)

#### 2.2.1 모듈 구조

```
backend/
├── nanobot/                # nanobot 본체 (fork — upstream freeze)
├── api/                    # FastAPI 진입점
│   ├── http/
│   │   ├── regulations.py
│   │   ├── impact.py
│   │   ├── meeting.py
│   │   ├── avatar.py
│   │   └── filter.py
│   ├── websocket/
│   │   └── npc_reports.py
│   └── deps.py             # DI: Repository·Service 주입
├── agents/                 # nanobot Agent 확장
│   ├── crawler_agent.py    # CrawlerAgent (Crawler 결과 받아 후처리)
│   └── impact_analyzer.py  # ImpactAnalyzerAgent
├── services/
│   ├── impact/             # analyzeImpact + Citation 추출
│   │   ├── analyzer.py
│   │   └── citation.py
│   ├── rag/                # BM25 + Kiwi
│   │   ├── tokenizer.py
│   │   ├── index.py
│   │   └── search.py
│   ├── llm/                # OpenAI/Claude wrapper + LLMUsageRecord hook
│   │   ├── client.py
│   │   ├── cache.py
│   │   └── usage_tracker.py
│   ├── classifier/         # classifyChangeType
│   ├── meeting/            # 주간 회의 (v2)
│   │   ├── scheduler.py
│   │   ├── orchestrator.py
│   │   └── digest_generator.py
│   └── notifier/           # NPCReport 생성 + WS push
└── domain/                 # DTO + Domain Model (Pydantic)
    ├── regulation.py
    ├── impact.py
    ├── meeting.py
    └── ...
```

#### 2.2.2 Service 책임 매트릭스

| Service | 책임 | 트랜잭션 경계 | 외부 호출 |
|---------|------|--------------|----------|
| `services.impact.analyzer.ImpactAnalyzer` | analyzeImpact 오케스트레이션, Citation 검증 | 1 ImpactAnalysis + N Citations atomic | LLM, RAG |
| `services.rag.search.BM25Search` | 한국어 토큰화→인덱스 검색→top-k 반환 | read-only | - |
| `services.llm.client.LLMClient` | OpenAI/Claude 통일 인터페이스, prompt cache, usage tracking | LLMUsageRecord insert | OpenAI/Claude API |
| `services.classifier.ChangeClassifier` | 신규 vs 개정 판정, RegulationVersion 생성 | 1 Regulation + 0~1 RegulationVersion atomic | LLM (diff_summary 1줄) |
| `services.meeting.orchestrator.MeetingOrchestrator` | conductMeeting 흐름 (디지스트 생성 → MeetingReport 발행 → NPCReport push) | 1 MeetingSession + 1 MeetingReport + N NPCReport atomic | LLM |
| `services.meeting.digest_generator.DigestGenerator` | digest_window 내 데이터 집계 + LLM 요약 | read-only | LLM |
| `services.notifier.NpcReportNotifier` | NPCReport 생성 + WebSocket push | 1 NPCReport insert | WebSocket clients |

#### 2.2.3 비즈니스 규칙 상세

**규칙 BR-1: Citation 강제 (AC-003 만족)**

```python
# services/impact/analyzer.py 의사코드
async def analyze_impact(reg_id: str, dept: str) -> ImpactAnalysis:
    regulation = repo.regulation.get(reg_id)
    rag_hits = bm25_search.search(query=dept, doc=regulation.raw_text, top_k=5)

    if not rag_hits:
        # ★ 규칙: Citation을 못 만들면 분석 자체를 거부
        raise InsufficientEvidenceError(reg_id, dept)

    llm_response = llm.complete(
        system=IMPACT_PROMPT,
        user=f"규제: {regulation.title}\n부서: {dept}\n근거 후보:\n{format_hits(rag_hits)}",
        require_citation=True,  # 응답 스키마에 citation 필수
    )

    citations = extract_citations(llm_response, regulation.raw_text)
    if len(citations) == 0:
        raise CitationMissingError(reg_id)  # ★ 강제

    return repo.impact.create(
        regulation_id=reg_id,
        target_department=dept,
        severity=llm_response.severity,
        summary=llm_response.summary,
        citations=citations,
        ...
    )
```

**규칙 BR-2: LLM 예산 가드 + 위젯 실시간 push (AC-008, v2 확장)**

```python
# services/llm/usage_tracker.py 의사코드
async def track_and_warn(record: LLMUsageRecord):
    repo.usage.insert(record)

    # 누적 통계 계산 (v2 신규)
    snapshot = LlmUsageSnapshot(
        cost_usd=repo.usage.cumulative_cost_usd(),
        call_count=repo.usage.total_calls(),
        cache_hit_rate=repo.usage.cache_hit_rate(window=100),
        last_model=record.model,
    )

    # ★ v2: 모든 위젯 클라이언트에 실시간 push
    await llm_usage_ws_broker.broadcast(snapshot.to_json())

    # 임계 경고
    if snapshot.cost_usd >= 40.0 and not _already_warned:
        await notifier.push_npc_report(
            agent_id=SYSTEM_AGENT_ID,
            report_type="ERROR",
            payload={"warning": f"LLM 누적 비용 ${snapshot.cost_usd:.2f} ≥ $40"},
        )
        sys.stderr.write(f"[BUDGET WARN] LLM cumulative ${snapshot.cost_usd:.2f}\n")
        _already_warned = True
```

**WebSocket 채널 (v2 신규)**: `/ws/llm-usage` — 모든 LLM 호출 직후 `LlmUsageSnapshot` 브로드캐스트. 클라이언트는 ReconnectingWebSocket으로 구독.

**규칙 BR-3: 회의 디지스트 4항목 모두 채워야 success (AC-011)**

```python
# services/meeting/digest_generator.py 의사코드
def generate_digest(session: MeetingSession) -> MeetingReport:
    window_regs = repo.regulation.find(
        detected_at__between=(session.digest_window_start, session.digest_window_end)
    )
    impacts = repo.impact.find(regulation_id__in=[r.id for r in window_regs])
    high_impacts = [i for i in impacts if i.severity == "HIGH"]

    if not window_regs:
        # 회의 cancel — 시연일 직전엔 mock 데이터로 보장
        raise EmptyWindowError(session.id)

    top = max(high_impacts or impacts, key=lambda i: severity_score(i))
    top_citation = top.citations[0]

    digest_text = llm.complete(
        system=DIGEST_PROMPT,
        user=f"신규 {len(window_regs)}건, HIGH {len(high_impacts)}건. 탑 1건: {top.summary}. 다음 주 권고는?",
    )

    return MeetingReport(
        new_regulation_count=len(window_regs),
        high_severity_count=len(high_impacts),
        top_regulation_id=top.regulation_id,
        top_citation_id=top_citation.id,
        next_week_recommendation=digest_text.recommendation,
        digest_text=digest_text.full,
        ...
    )
```

#### 2.2.4 Crawler 통합 (D-2: 공유 SQLite 작업 큐)

```
[Crawler Process]                          [Backend Process]
  scrapers.fss.run()                          api/main.py (FastAPI + APScheduler)
       ↓ insert                                ↓ APScheduler every 30s
  SQLite.crawl_jobs (status=COMPLETED)  ←── repo.crawl_job.find_unprocessed()
                                              ↓ for each new Regulation
                                            services.classifier.classify()
                                            services.notifier.push_npc_report(NEW_REGULATION)
```

→ Crawler는 단순히 결과를 SQLite에 insert. 백엔드가 30초마다 `WHERE status='COMPLETED' AND processed_at IS NULL` 폴링.
→ 추가 인프라(Redis 등) 0. nanobot 다운 시 데이터 유실 X (SQLite에 영속).

#### 2.2.5 nanobot fork 커스터마이징 범위

| 영역 | 변경 방식 |
|------|----------|
| LLM 호출 hook | nanobot의 LLM provider wrapper에 `track_and_warn()` decorator 추가 |
| Agent 추상 베이스 | nanobot Agent 클래스 **상속**으로 `CrawlerAgent`, `ImpactAnalyzerAgent` 정의 (직접 수정 X — upstream pull 가능성 보존) |
| Webui | nanobot 내장 webui는 **사용하지 않음** (deskrpg가 대체). nanobot.webui는 dead code로 두되 라우팅 X |
| Memory | nanobot 메모리 모듈은 ImpactAnalyzerAgent의 short-term context에 활용 (대화 유지) |
| MCP | MCP 도구는 stretch — MVP는 직접 service 호출 |

**Upstream 정책**: 12주 동안 nanobot upstream pull 동결. 시연 후 재평가.

---

### 2.3 Data Layer

> **위치**: `backend/data/`
> **저장소**: SQLite (단일 파일) + Obsidian markdown vault (별도 디렉토리)
> **Repository 패턴**: Python dataclass DTO ↔ SQLAlchemy 2.x ORM Entity 분리
> **금지**: Presentation 코드 import, 비즈니스 로직 포함 (Service에 위임)

#### 2.3.1 SQLite 스키마 (요약)

> **상세 ERD는 `docs/data-model/ERD-RegTrack.md`에서 별도 문서화.** 여기서는 핵심만.

```
regulation_sources       (5 rows seeded — FSS=FULL, 4=INTERFACE_ONLY)
crawl_jobs               (작업 큐 + 결과 — D-2)
regulations              (수집된 규제)
regulation_versions      (개정 이력)
impact_analyses          (LLM 분석 결과)
citations                (Citation, char_offset 포함)
agents                   (NPC 정의)
crawler_agents           (CrawlerAgent 1:1)
impact_analyzer_agents   (ImpactAnalyzerAgent 1:1)
user_characters          (사용자 + lpc_parts JSON)
npc_reports              (in-world 보고)
notifications            (앱 토스트 — stretch)
dashboard_filters        (필터 상태)
vault_documents          (markdown 메타)
llm_usage_records        (예산 추적)
meeting_sessions         (v2)
meeting_participants     (v2)
meeting_reports          (v2)
```

#### 2.3.2 Repository 인터페이스 (예시)

```python
# backend/data/repositories/regulation_repo.py
class RegulationRepository(Protocol):
    def get(self, id: str) -> Regulation | None: ...
    def find(self, **filters) -> list[Regulation]: ...
    def create(self, data: RegulationCreateDTO) -> Regulation: ...
    def find_by_source_and_external_id(
        self, source_id: str, external_id: str
    ) -> Regulation | None: ...

class SqlAlchemyRegulationRepository(RegulationRepository):
    def __init__(self, session: Session): ...
    # 구현
```

> Service는 Protocol에만 의존. 테스트에서 in-memory 구현으로 swap.

#### 2.3.3 Obsidian Vault 영속화

```
vault/
├── .obsidian/             # Obsidian 설정 (커밋)
├── _templates/
│   └── regulation.md      # frontmatter + body 템플릿
├── FSS/
│   ├── 보도/
│   │   └── 2026/05/16-{external_id}.md
│   ├── 규정/
│   └── 해설/
├── BOK/  (mock 1건)
├── FSC/  (mock 1건)
├── NA_GAZETTE/  (mock 1건)
└── BCBS/  (mock 1건, 영문)
```

VaultDocument 파일 형식:

```markdown
---
regulation_id: 7c3a-...
external_id: FSS-2026-05-15-001
source: FSS
board_type: 보도
change_type: NEW
published_at: 2026-05-15T09:00
detected_at: 2026-05-15T09:32
severity: HIGH
target_departments: [리테일]
source_url: https://fss.or.kr/...
---

# 제목 (원문)

본문 markdown...

## 영향도 분석
- 리테일: HIGH
- 근거: "제5조 ②항에 따라 ..."
```

#### 2.3.4 Vault git sync 전략 (v2 단순화)

**v2 결정**: 백엔드의 git subprocess sync는 **제거**. Obsidian Git community plugin이 vault 디렉토리에서 sync를 담당하고, push는 **사용자가 수동 실행**.

##### 책임 분리

| 담당 | 동작 |
|------|------|
| **Backend (`backend/data/vault/writer.py`)** | VaultDocument markdown 파일을 `vault/` 디렉토리에 write only. git 호출 없음 |
| **Obsidian Git plugin** (vault 안에 설치) | 파일 변경 감지, git add/commit (auto-commit 옵션 활성 가능) |
| **사용자 (수동)** | Obsidian 단축키 `Ctrl+Shift+P` → "Obsidian Git: Commit and push" 실행 |

##### `backend/data/vault/writer.py` (단순화)

```python
# backend/data/vault/writer.py 의사코드
def write_regulation(regulation: Regulation, analysis: ImpactAnalysis | None = None):
    vault_path = build_path(regulation)  # vault/FSS/보도/2026/05/16-{id}.md
    frontmatter = build_frontmatter(regulation, analysis)
    body = build_markdown_body(regulation, analysis)

    Path(vault_path).parent.mkdir(parents=True, exist_ok=True)
    Path(vault_path).write_text(f"---\n{frontmatter}\n---\n\n{body}", encoding="utf-8")

    return VaultDocument(vault_path=vault_path, regulation_id=regulation.id, ...)
    # git 호출 없음 — Obsidian Git plugin이 처리
```

##### Obsidian Git plugin 설치 가이드 (`vault/.obsidian/community-plugins.json`)

```json
[
  "obsidian-git"
]
```

권장 설정 (`vault/.obsidian/plugins/obsidian-git/data.json`):
```json
{
  "commitMessage": "vault: auto-commit {{date}}",
  "autoSaveInterval": 0,          // 자동 commit 안 함 (수동 트리거)
  "autoPushInterval": 0,          // 자동 push 안 함
  "pullBeforePush": true,
  "disablePush": false
}
```

##### 보안 (D-6 유지)

- vault 자체는 별도 **GitHub private repo** 강제
- 메인 레포(`reg-detection`)의 `.gitignore`에 `vault/` 추가
- private repo 권한: 팀 4인만 (Collaborator)
- 시연 직전 vault 감사: `git log --oneline | head` + `grep -r "API_KEY\|SECRET" vault/` 수동 확인

##### 사용 사이클

```
[수집] crawler가 신규 Regulation insert
   ↓
[Backend] services.notifier가 NPCReport 생성 + writer.write_regulation()
   ↓
[Vault] vault/FSS/보도/2026/05/16-xxx.md 생성됨
   ↓
[Obsidian] plugin이 변경 감지 (file watcher)
   ↓
[사용자] (시연 데모 직전 또는 주 1회 retro 후)
        Ctrl+Shift+P → "Obsidian Git: Commit and push"
   ↓
[GitHub private repo] commit + push 완료, 팀원과 공유
```

#### 2.3.5 BM25 인덱스 영속화

```
backend/data/rag/bm25_index/
├── index.pkl              # rank_bm25 직렬화 또는
└── corpus.sqlite          # SQLite FTS5 사용 시 (대안)
```

권장: **rank_bm25 + Kiwi 토큰 → pickle 직렬화** (단순). 변경 시 rebuild. 시연용 데이터량(수십~수백 건)에선 충분.

---

## 3. Layer Communication

### 3.1 통신 계약

| From → To | 방식 | 데이터 형식 | 비고 |
|-----------|------|------------|------|
| Presentation → Logic | HTTP REST (FastAPI) | JSON DTO (Pydantic↔TypeScript) | OpenAPI auto-gen |
| Logic → Presentation | HTTP 응답 + WebSocket push | JSON DTO | NPCReport, MeetingDigest 등 |
| Logic Service → Repository | Python function call | dataclass / Pydantic DTO | 동기 또는 async |
| Logic Service → External | HTTP / SDK (OpenAI, Claude) | provider 고유 | usage tracker 통과 강제 |
| Crawler → Backend | 공유 SQLite insert | crawl_jobs 행 | D-2 |
| Backend → Vault | filesystem write + git subprocess | markdown 파일 | debounce 1s |

### 3.2 DTO vs Domain Model 분리

```
Presentation        Logic                Data
   ↓                   ↓                   ↓
RegulationDTO  ←→  Regulation(domain)  ←→  RegulationEntity(SQLAlchemy)
(JSON)             (Pydantic)              (ORM)

변환 책임:
  HTTP 응답 직전: domain → DTO (api 레이어 mapper)
  Repository 반환: ORM → domain
  Repository 입력: domain → ORM
```

→ **Presentation은 절대 ORM Entity를 받지 않음**. ARCHITECTURE_INVARIANTS Part 1 #3 위반 방지.

### 3.3 WebSocket 채널

| 경로 | 용도 | 메시지 타입 |
|------|------|------------|
| `/ws/npc-reports` | NPCReport push (NEW_REGULATION, ANALYSIS_READY, ERROR, MEETING_DIGEST) | `NpcReportEvent` |
| **`/ws/llm-usage`** *(v2 신규)* | LlmUsageWidget 실시간 push (매 LLM 호출 직후 broadcast) | `LlmUsageSnapshot` |
| `/ws/meeting/:sessionId` | (stretch) 회의 진행 실시간 동기화 — **MVP에선 사용 안 함** (D-4 결정에 따라 클라이언트 자체 애니) | - |

---

## 4. Directory Structure

```
reg-detection/
├── frontend/                          # ── Presentation ──
│   ├── app/                           # Next.js App Router
│   │   ├── dashboard/page.tsx
│   │   ├── meeting/[sessionId]/page.tsx
│   │   └── api/                       # Next.js API routes (필요 시 BFF)
│   ├── components/                    # 공통 React 컴포넌트
│   ├── scenes/
│   │   ├── dashboard/
│   │   ├── meeting/
│   │   └── avatar/
│   ├── components/
│   │   ├── LlmUsageWidget.tsx         # v2 신규 — 모든 Scene 공통 floating
│   │   └── ...
│   ├── lib/
│   │   ├── api/                       # 백엔드 호출 (자동 생성 타입)
│   │   └── ws/                        # WebSocket 클라이언트 (npc-reports, llm-usage)
│   ├── stores/                        # Zustand (llmUsageStore 포함)
│   ├── public/                        # deskrpg 픽셀 자산
│   └── package.json
│
├── backend/                           # ── Logic ──
│   ├── nanobot/                       # nanobot fork (upstream freeze)
│   ├── api/
│   │   ├── http/
│   │   │   ├── regulations.py
│   │   │   ├── impact.py
│   │   │   ├── meeting.py
│   │   │   ├── avatar.py
│   │   │   ├── filter.py
│   │   │   └── llm_usage.py
│   │   ├── websocket/
│   │   │   └── npc_reports.py
│   │   ├── deps.py
│   │   └── main.py                    # FastAPI app + APScheduler
│   ├── agents/
│   ├── services/
│   │   ├── impact/
│   │   ├── rag/
│   │   ├── llm/
│   │   ├── classifier/
│   │   ├── meeting/
│   │   └── notifier/
│   ├── data/                          # ── Data (Logic 안에 위치하지만 격리) ──
│   │   ├── sqlite/
│   │   │   ├── alembic/               # 마이그레이션
│   │   │   └── session.py
│   │   ├── repositories/
│   │   ├── vault/
│   │   │   └── writer.py              # v2: markdown 작성만 (git_sync.py 제거)
│   │   └── rag/                       # BM25 인덱스 영속화
│   └── domain/                        # DTO + Domain Model
│
├── crawler/                           # ── 별도 Logic-aux 서비스 ──
│   ├── scrapers/
│   │   ├── fss.py                     # FULL
│   │   ├── bok.py                     # INTERFACE_ONLY mock
│   │   ├── fsc.py                     # mock
│   │   ├── na_gazette.py              # mock
│   │   └── bcbs.py                    # mock (영문)
│   ├── parser/                        # Flexible Parser
│   ├── scheduler/
│   └── main.py
│
├── vault/                             # gitignore (메인 레포) — 별도 private repo로 sync (Obsidian Git plugin, v2)
│   └── .obsidian/
│       ├── community-plugins.json    # ["obsidian-git"]
│       └── plugins/obsidian-git/data.json
│
├── tests/
│   ├── unit/                          # Logic 단위
│   ├── integration/                   # Data 통합
│   └── e2e/                           # Presentation E2E (Playwright)
│
├── docker-compose.yml
├── .harness/
└── docs/
```

---

## 5. Test Strategy

### 5.1 레이어별 테스트 정책

| 레이어 | 도구 | 정책 | 커버리지 목표 |
|--------|------|------|--------------|
| **Logic (services/)** | pytest + pytest-asyncio | **mock은 Repository 경계와 LLM API에서만**. 비즈니스 규칙은 순수 로직 단위 테스트 | 80%+ (비즈니스 규칙 100%) |
| **Data (repositories/)** | pytest + SQLAlchemy in-memory SQLite | 실제 SQLite 사용. Repository 인터페이스 vs 구현 일치 검증 | 70%+ |
| **Presentation (frontend/)** | Vitest (단위) + Playwright (E2E) | E2E는 AC 시연 시나리오 위주 | E2E: AC-005, AC-011 통과 |
| **Crawler** | pytest + responses (HTTP mock) | FSS HTML 샘플 fixture로 파싱 정확도 검증 | 파싱 케이스 100% |

### 5.2 AC별 테스트 매트릭스

| AC | 테스트 종류 | 위치 | 핵심 검증 |
|----|-----------|------|----------|
| AC-001 (FSS 크롤러) | Crawler unit + Integration | `tests/integration/test_fss_crawler.py` | 3개 게시판에서 1건 이상 Regulation 생성 + VaultDocument 작성 |
| AC-002 (1h 보고) | Logic unit + E2E | `tests/unit/test_npc_report_latency.py`, `tests/e2e/test_dashboard_alert.spec.ts` | crawl_job 완료 → NPCReport 생성 시간 측정 |
| AC-003 (Citation) | Logic unit (Pair Mode + Test Designer) | `tests/unit/test_impact_analyzer.py` | LLM mock + RAG hits → ImpactAnalysis에 Citation ≥ 1, char_offset 유효성 |
| AC-004 (필터 4종) | Logic unit + E2E | `tests/unit/test_filter_query.py`, `tests/e2e/test_filters.spec.ts` | 4종 조합 쿼리 결과 검증 |
| AC-005 (시연 4단계) | E2E Playwright | `tests/e2e/test_demo_scenario.spec.ts` | 캐릭터 입장 → NPC 보고 → askAnalystNPC → Citation 응답 (스크린샷) |
| AC-006 (vault writer + plugin, v2) | Logic unit + 수동 체크 | `tests/unit/test_vault_writer.py` + 시연 직전 manual check | (1) `writer.write_regulation()` 호출 시 vault/ 경로에 markdown 파일 생성 + frontmatter YAML 유효성. (2) `vault/.obsidian/community-plugins.json`에 "obsidian-git" 존재. (3) git remote 설정이 private repo URL인지 manual 확인 |
| AC-007 (4소스 stub) | Data seed test | `tests/integration/test_source_seed.py` | 5개 RegulationSource + 4개 mock Regulation 존재 |
| AC-008 (LLM 위젯 + 예산, v2 high) | Logic unit (Pair Mode + Test Designer) + E2E | `tests/unit/test_usage_tracker.py`, `tests/e2e/test_llm_widget.spec.ts` | (1) 매 LLM 호출 후 `/ws/llm-usage`에 `LlmUsageSnapshot` broadcast. (2) 누적 $40 도달 시 NPCReport(ERROR). (3) E2E: 시연 시작→4단계 진행 동안 위젯이 누적 비용·횟수·캐시 적중률·모델명 실시간 갱신 (Playwright 스크린샷 N장) |
| AC-009 (개정 이력) | Logic unit | `tests/unit/test_change_classifier.py` | 동일 external_id 재발견 시 RegulationVersion 추가 + diff_summary |
| AC-010 (게이트) | CI | `.harness/detect-violations.sh` | GitHub Actions에서 default 게이트 모두 PASS |
| AC-011 (회의 디지스트) | Logic unit (Pair Mode + Test Designer) + E2E | `tests/unit/test_digest_generator.py`, `tests/e2e/test_meeting.spec.ts` | 4항목(a,b,c,d) 모두 채워짐 + Citation 참조 |
| AC-012 (LPC) | Logic unit + E2E | `tests/unit/test_avatar_persist.py`, `tests/e2e/test_avatar.spec.ts` | 부품 변경 → DB 영속 → 재로드 시 유지 |

### 5.3 Pair Mode + Test Designer 강제 활성화

complexity = `high` 인 **5개 AC**는 다음 절차 (v2: AC-008 추가):
- AC-001 (FSS 크롤러), AC-003 (Citation RAG), AC-005 (시연 4단계), **AC-008 (LLM 위젯)**, AC-011 (회의 디지스트)
- **Test Designer subagent**가 별도 worktree에서 구현 코드를 보지 않고 테스트 먼저 설계 (AgentCoder 2024 방법론)
- Navigator-Driver 페어 구조로 구현

### 5.4 구현·테스트 동시 작성 원칙 (CLAUDE.md)

```
[단계] services.impact.analyzer.ImpactAnalyzer.analyze_impact() 구현
   ↓
verify: tests/unit/test_impact_analyzer.py 즉시 작성 + pytest 통과
   ↓
[다음 단계] api/http/impact.py 엔드포인트
   ↓
verify: tests/integration/test_impact_endpoint.py + curl 실행 확인
```

→ **일괄 테스트 작성 금지**. 모듈 1개 완성 시 해당 테스트도 1개 완성.

---

## 6. Decisions & Trade-offs

### D-1: REST(FastAPI) + WebSocket

| 항목 | 내용 |
|------|------|
| **결정** | FastAPI HTTP REST + WebSocket |
| **이유** | seed 명시 + Python 표준 + 학습 비용 최소 + OpenAPI 자동 생성으로 D-5와 시너지 |
| **대안** | GraphQL (유연성 ↑, 세팅 +1주) / tRPC (Python 부적합) / MCP (Agent-first지만 일반 UI에 어색) |
| **Trade-off** | REST는 over/under-fetching 발생 가능 — 시연용 단순 모델에선 무시 가능 |

### D-2: 공유 SQLite 작업 큐

| 항목 | 내용 |
|------|------|
| **결정** | Crawler가 SQLite의 `crawl_jobs` 테이블에 결과 insert, Backend가 30초 폴링 |
| **이유** | 추가 인프라 0, 데이터 영속성 보장, 시연용 충분 |
| **대안** | HTTP webhook (유실 위험), Redis pub/sub (인프라 +1), RabbitMQ (12주에 과도) |
| **Trade-off** | 실시간성 ↓ (최대 30초 지연). AC-002의 1h 목표엔 여유 충분 |

### D-3: Kiwi 한국어 형태소 분석기

| 항목 | 내용 |
|------|------|
| **결정** | kiwipiepy + rank_bm25 |
| **이유** | 순수 Python, MIT, Docker 빌드 시간 최소, 정확도 우수 |
| **대안** | MeCab (정확도 최고지만 빌드 +5분), Okt (JVM 의존) |
| **Trade-off** | MeCab보다 5~10% 정확도 ↓ — RegTrack 시연용엔 충분 |
| **재평가 트리거** | AC-003 RAG hit rate가 70% 이하면 MeCab으로 전환 검토 |

### D-4: 백엔드 디지스트 1회 + 클라이언트 자체 애니메이션

| 항목 | 내용 |
|------|------|
| **결정** | `POST /api/meeting/:id/conduct` → MeetingReport 한 번 응답. 클라이언트는 응답 받아 NPC 좌석 이동·말풍선 시퀀스를 사전 정의 안무로 재생 |
| **이유** | 시연 결정성 ↑, 백엔드 단순, 회의 시간 측정 용이 |
| **대안** | WebSocket 턴 단위 push (즉흥성 ↑, 복잡도 ↑) / 안무 스크립트 JSON (중간) |
| **Trade-off** | 디지스트 LLM 응답 전엔 회의 시작 X (latency ~3초). 클라이언트는 로딩 인디케이터 |

### D-5: FastAPI OpenAPI → openapi-typescript

| 항목 | 내용 |
|------|------|
| **결정** | FastAPI가 자동 생성하는 `/openapi.json`을 빌드 시 fetch → `openapi-typescript` CLI로 .ts 타입 생성 |
| **이유** | 4명 협업에서 타입 drift 방지, 한 번 세팅 후 영구 자동 |
| **대안** | 수기 (drift 위험), Protobuf (세팅 +1주), JSON Schema (중간) |
| **Trade-off** | 초기 +0.5일 세팅 비용. 이후 무료 |

### D-6 (v2 단순화): Vault sync 정책

| 항목 | 내용 |
|------|------|
| **결정** | **Obsidian Git community plugin + 수동 push** (백엔드 자동 sync 제거). Vault는 별도 GitHub **private** 저장소. main 레포에서 `vault/`는 .gitignore |
| **이유** | seed-v4 결정. 시연용 데이터량 적음 + 1인 push 가정 + Obsidian 표준 패턴 + 백엔드 공수 −2~3일 절감 + git subprocess 충돌 처리 코드/테스트 제거 |
| **대안** | v1 원안 (백엔드 자동 git subprocess, 공수 +2~3일) / 백엔드 commit-only + 수동 push (균형) / git sync 빼고 클라우드 폴더 (충돌 잦음) |
| **Trade-off** | (1) push 누락 위험 — 시연 데모 직전 1회 + 주간 retro 후 1회 사람이 책임짐 (2) secret grep 자동화 빠짐 — 시연 직전 manual 감사로 대체 |

### D-7 (추가): SQLite vs PostgreSQL

| 항목 | 내용 |
|------|------|
| **결정** | SQLite (단일 파일) — seed-v2 명시 |
| **이유** | 시연용 데이터량 적음 (수십~수백 Regulation), 단일 노트북 docker compose 운영, vault는 별도 git sync로 팀 공유 |
| **재평가 트리거** | future scope (BOK/FSC/NA 본격 크롤러 진입) 시 PostgreSQL 마이그레이션 검토 |

---

## 7. Implementation Order

### 7.1 D → L → P 원칙 (CLAUDE.md)

1. **Data 먼저** — 스키마·Repository 가 안정되어야 Service가 동작
2. **Logic 다음** — Service가 안정되어야 API 엔드포인트가 안정
3. **Presentation 마지막** — UI는 마지막에 본격 작업

### 7.2 12주 구현 순서

#### Week 1-2 (W1-W2): 분석/설계
- ✅ TRD·PRD·아키텍처 다이어그램·ERD·API 스펙·시연 스토리보드·Risk Register·LLM 비용 모델
- 본 문서에서 결정된 5개 D-* 채택 검증

#### Week 3-5 (W3-W5): Data + Crawler 본체
**Data**:
- T-1: SQLite 스키마 + Alembic 마이그레이션 (18 entities)
- T-2: Repository 인터페이스 + SQLAlchemy 구현 (13개 repo)
- T-3: VaultDocument writer (markdown 작성 only) + `vault/.obsidian/community-plugins.json`에 `obsidian-git` 시드 (v2 단순화 — git_sync.py 제거)
- T-4: BM25 인덱스 (Kiwi 토크나이저 + rank_bm25)

**Crawler (별도 서비스)**:
- T-5: Flexible Parser 추상 인터페이스
- T-6: FSS scraper (보도/규정/해설 3개 게시판) — **AC-001 first**
- T-7: 4개 mock scraper (interface_only, mock 1건씩) — **AC-007**
- T-8: SQLite 작업 큐 insert + status 관리 (D-2)

**Backend bootstrap**:
- T-9: FastAPI 초기 setup + OpenAPI auto-export (D-5)
- T-10: APScheduler 30초 폴링 (Crawler→처리)

**M2 게이트**: AC-001, AC-006, AC-007 통과

#### Week 6-8 (W6-W8): Logic
- T-11: `services.classifier.ChangeClassifier` (신규/개정 + LLM 1줄 diff) — **AC-009**
- T-12: `services.llm.LLMClient` + LLMUsageRecord hook + $40 임계 + **`/ws/llm-usage` broadcast** (v2 위젯 push 백엔드) — **AC-008** (Pair Mode + Test Designer)
- T-13: `services.rag.BM25Search` + Kiwi 통합 (D-3)
- T-14: `services.impact.ImpactAnalyzer` (Citation 강제 BR-1) — **AC-003** (Pair Mode + Test Designer)
- T-15: `services.notifier.NpcReportNotifier` + WebSocket
- T-16: `services.meeting.MeetingOrchestrator` + DigestGenerator (BR-3) — **AC-011** (Pair Mode + Test Designer)
- T-17: REST 엔드포인트 (regulations, impact, meeting, avatar, filter)

**M3 게이트**: AC-003, AC-008, AC-009 통과

#### Week 9-10 (W9-W10): Presentation
- T-18: deskrpg fork 정리 (맵 에디터·멀티플레이어 제거 — 코드 grep + dead-code 청소)
- T-19: API 클라이언트 자동 생성 setup (`openapi-typescript`)
- T-20: `<DashboardScene>` — RPG 맵 + PlayerCharacter + NpcSprites + 필터 패널 — **AC-004**
- T-21: NpcReportToasts + WebSocket 클라이언트 (`/ws/npc-reports`) — **AC-002**
- **T-21.5** *(v2 신규)*: `<LlmUsageWidget>` 컴포넌트 + `/ws/llm-usage` 구독 + Zustand `llmUsageStore` + 모든 Scene 공통 floating 배치 — **AC-008 프론트**
- T-22: ChatBubble + askAnalystNPC 흐름
- T-23: `<MeetingScene>` + 안무 시퀀스 (D-4) — **AC-011**
- T-24: `<AvatarModal>` + LPC 부품 selector — **AC-012**
- T-25: 메인 시연 4단계 통합 e2e (Playwright) — **AC-005** (Pair Mode + Test Designer)

**M4 게이트**: AC-002, AC-004, AC-005, AC-008(프론트), AC-011, AC-012 통과

#### Week 11-12 (W11-W12): UAT & 시연
- T-26: GitHub Actions CI 셋업 + .harness/gates 자동 실행 — **AC-010**
- T-27: 시연 리허설 3회 + 영상 녹화
- T-28: 백업 시나리오 준비 (네트워크 끊김 등)
- T-29: 최종 발표

**M5 게이트**: AC-010 + 발표

### 7.3 Test 작성 시점

각 T-XX 완료 직후 해당 테스트 작성. 5.2의 매트릭스 참조.

### 7.4 게이트 통과 트리거

```bash
# 매 커밋 전 자동
.harness/detect-violations.sh

# 마일스톤마다
.harness/gates/check-secrets.sh
.harness/gates/check-boundaries.sh
.harness/gates/check-structure.sh
.harness/gates/check-spec.sh
.harness/gates/check-layers.sh
.harness/gates/check-security.sh
.harness/gates/check-deps.sh
```

---

## 8. Deployment

### 8.1 docker-compose.yml 구조

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"     # FastAPI HTTP + WS
    volumes:
      - ./data/sqlite.db:/app/data/sqlite.db
      - ./vault:/app/vault
    environment:
      - OPENAI_API_KEY
      - ANTHROPIC_API_KEY
    depends_on:
      - crawler

  crawler:
    build: ./crawler
    volumes:
      - ./data/sqlite.db:/app/data/sqlite.db
    environment:
      - POLL_INTERVAL_MINUTES=15

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_BASE=http://localhost:8000
```

### 8.2 환경 변수 (.env.local)

```
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
VAULT_GIT_REMOTE=git@github.com:org/regtrack-vault-private.git
LLM_BUDGET_WARN_USD=40.0
DEFAULT_LLM_MODEL=gpt-4o-mini   # 저렴 모델 우선
```

> `.env.local`은 .gitignore. 키 노출 시 즉시 회전.

---

## 9. Open Issues / Future TRD Topics

다음은 본 TRD에선 결정 보류, 후속 문서로 분리:

| 항목 | 위임 문서 |
|------|----------|
| 상세 ERD (필드 타입·인덱스·외래키 옵션·성능 인덱스) | `docs/data-model/ERD-RegTrack.md` |
| 시퀀스 다이어그램 (시나리오별 흐름) | `docs/architecture/sequences/` |
| API/MCP 인터페이스 상세 (모든 엔드포인트 OpenAPI YAML, 에러 코드, 페이지네이션) | `docs/api/` |
| 시연 스토리보드 (NPC 대사 풀 스크립트) | `docs/demo-scenario/` |
| Risk Register 상세 (트리거·오너·타임라인) | `docs/risk/` |
| LLM 비용 모델 (호출별 토큰 추정·캐싱 시나리오) | `docs/llm-cost/` |

---

## 10. Glossary (개발자용)

| 약어 | 의미 |
|------|------|
| BFF | Backend For Frontend — Presentation 인접 백엔드 어댑터 |
| DTO | Data Transfer Object — 레이어 간 운반용 |
| ORM | Object-Relational Mapping (SQLAlchemy) |
| FTS5 | SQLite Full-Text Search v5 (BM25 대안 후보) |
| LPC | Liberated Pixel Cup — 오픈소스 픽셀 캐릭터 자산 표준 (deskrpg 사용) |
| SAST | Static Application Security Testing |
| WS | WebSocket |
| BM25 | Best Matching 25 — 키워드 검색 랭킹 알고리즘 |
| RAG | Retrieval-Augmented Generation |

---

## 12. Scope Change Governance — 기술적 지원 (v2 신규)

> seed-v4 + PRD §17의 Scope Change Governance 정책을 코드/도구로 어떻게 지원하는가.
> 거버넌스 자체는 PRD §17의 triage matrix를 참조.

### 12.1 변경 분류별 코드 영향

| 크기 | 코드 영향 | 자동 강제 방법 |
|------|----------|--------------|
| 소형 | 단일 파일 또는 데이터값 (예: `parser_config` JSON, `poll_interval_minutes`) | 영향 없음. PR 라벨링만 (예: `scope:small`) |
| 중형 | 여러 모듈 (예: 새 Scraper 추가, 필터 컬럼 추가) | `.harness/gates/check-spec.sh`로 seed 영향 자동 검사 |
| 대형 | seed 변경 + 마이그레이션 | seed-vN 발행 강제, Alembic 마이그레이션 생성 강제 |

### 12.2 자동화 가능 항목

#### A. PR 템플릿 (`.github/pull_request_template.md`)
```markdown
## Scope Change Classification (v4 governance)
- [ ] small  — 단일 모듈·데이터, 작업자 1인 결정
- [ ] medium — 여러 모듈, 주간 retro 결정
- [ ] large  — MVP·아키텍처, seed-vN 발행

### 변경 사유 (small/medium은 1줄, large는 retro 노트 링크)
```

#### B. CI 게이트 추가 (선택)
```bash
# .harness/gates/check-scope-classification.sh (제안)
# PR 본문에서 [x] small|medium|large 중 하나가 체크됐는지 검사
# large일 경우 seed-v* 파일 변경이 함께 있는지 검사
```

#### C. Retrospective 노트 디렉토리
```
docs/retro/
├── 2026-05-22.md     # 매주 금요일 retro 결정 노트
├── 2026-05-29.md
└── ...
```

권장 템플릿:
```markdown
# Retro YYYY-MM-DD (W{n})

## 이번 주 진척
- [완료] T-XX
- [지연] T-YY (사유)

## Scope 변경 안건
- [small] FSS 보도 폴링 30분 → 60분 (팀원1, commit abc1234)
- [medium] 분석 NPC에 '비교 규제 1건' 추가 — 다음 주 T-23.5로
- [large] (없음)

## 다음 주 우선순위
- T-23, T-24
```

### 12.3 seed-vN 발행 시 자동 체크

대형 변경으로 seed-v5 발행 시 다음 자동 (또는 수동):
1. `seed-v4.yaml` → `seed-v5.yaml` (immutable, supersedes 체인 유지)
2. PRD에 `Changelog v4 → v5` 추가 + 본문 갱신
3. TRD에 pending updates 박스 (검토 후 v3로) — 본 v2의 패턴 재활용
4. Alembic 마이그레이션 (데이터 모델 변경 시)
5. .harness/ouroboros 시드 검증 게이트 통과

---

## 11. References

- **Seed**: `.harness/ouroboros/seeds/seed-v2.yaml`
- **PRD**: `docs/prd/PRD-RegTrack-2026-05-16.md`
- **Architecture Invariants**: `ARCHITECTURE_INVARIANTS.md`
- **Project Guide**: `CLAUDE.md`
- **Boundaries Rules**: `.harness/gates/rules/boundaries.yaml`
- **Structure Rules**: `.harness/gates/rules/structure.yaml`
- **nanobot upstream**: https://github.com/nanobot-ai/nanobot
- **deskrpg upstream**: https://github.com/dandacompany/deskrpg
- **Kiwi**: https://github.com/bab2min/Kiwi
- **rank_bm25**: https://github.com/dorianbrown/rank_bm25
- **FastAPI**: https://fastapi.tiangolo.com/
- **openapi-typescript**: https://github.com/drwpow/openapi-typescript
