# PRD: RegTrack — 지능형 규제 변화 모니터링 시스템

> **Product Requirements Document v4**
> 본 문서는 팀 내부·어드바이저·심사 위원에게 RegTrack의 무엇(What)과 왜(Why)를 전달하기 위한 stakeholder-facing 명세입니다. 기술적 디테일은 별도의 TRD(Technical Reference Document)를 참고하세요.

> **Changelog v3 → v4 (2026-05-16)**: (1) Vault git sync를 **Obsidian Git plugin + 수동 push**로 단순화 — 백엔드 자동 sync 코드 제거, AC-006 complexity medium → low. (2) **Scope Change Governance 신규 섹션** 추가 — 주 1회 retro + 소/중/대형 triage matrix. complexity 분포: low **5** / medium **2** / high **5**. seed는 `seed-v4.yaml`로 발행.
>
> **Changelog v2 → v3**: LLM 호출량 위젯을 핵심 시연 시나리오에 포함, AC-008 complexity medium → high.
>
> **Changelog v1 → v2**: deskrpg AI 미팅룸을 RegTrack '주간 컴플라이언스 회의실'로 repurpose하여 P0 포함. LPC 커스터마이징 KEEP. 맵 에디터·멀티플레이어 CUT.

---

## 1. Overview

| 항목 | 내용 |
|------|------|
| **프로젝트명** | RegTrack — 지능형 규제 변화 모니터링 시스템 (Intelligent Regulation Change Monitoring) |
| **버전** | PRD v4 (Draft) |
| **작성일** | 2026-05-16 |
| **작성자** | 팀원1 (with 팀 4인: 팀장(PM)·팀원1·팀원2·팀원3) |
| **출처(Source)** | `.harness/ouroboros/seeds/seed-v4.yaml` (immutable spec, supersedes v3) · `Project Charter_4팀_0514.docx` |
| **상태** | Draft |
| **기간** | 12주 (W1~W12) |
| **소속** | AIMBA ABP 4팀 |

---

## 2. Problem Statement (해결 과제)

### 2.1 현행 페인 포인트(Current Pain Points)

금융권 컴플라이언스 담당자는 디지털 전환 가속화에 따라 점점 복잡해지는 규제 환경에서 다음 4가지 문제를 안고 있습니다:

1. **수동 모니터링의 한계** — 5개 주요 규제 소스(FSS·BOK·FSC·국회·관보·바젤위)를 매일 사람이 직접 웹 서핑으로 확인. 인당 1~2시간/일 소요, 누락 위험.
2. **부서 간 공유·협업 부재** — 한 사람이 발견해도 관련 부서로 전달되는 경로가 임의적.
3. **영향도 판단의 시간 소요** — 규제 본문이 길고 전문적이라 "우리 회사 어느 업무에 영향을 주는지" 분석에 며칠 걸림.
4. **변경 이력 추적의 어려움** — 과거 버전과의 diff, 개정 흐름 추적이 안 됨.

### 2.2 왜 지금(Why Now)

- LLM API의 안정적 가용성 확보 (OpenAI·Anthropic 등)
- 한국어 형태소 분석·BM25 검색 인프라 성숙
- 오픈소스 에이전트 프레임워크(nanobot) 등장 — fork·커스텀 비용이 12주 안에 가능

---

## 3. Goals (목표)

### 3.1 Must Have (P0) — MVP 필수

| # | 목표 | 검증(Verification) |
|---|------|-------------------|
| P0-1 | FSS 1개 소스(보도·규정·해설 게시판)를 자동 수집·분류·저장한다 | AC-001 자동 |
| P0-2 | 신규 규제 발견 후 1시간 이내(시연일 기준)에 NPC가 사용자에게 in-world로 보고 | AC-002 수동 |
| P0-3 | LLM 영향도 분석에 반드시 원문 근거 구절(Citation) 포함 | AC-003 자동+수동 |
| P0-4 | 대시보드 필터 4종 이상 작동 (소스·분류·부서·날짜) | AC-004 자동 |
| P0-5 | 메인 시연 시나리오 4단계가 끊김 없이 작동 | AC-005 수동 |
| P0-6 | VaultDocument가 vault/ markdown 파일로 생성 + Obsidian Git plugin이 private repo에 설정됨 (push는 사용자 수동, v4) | AC-006 자동+수동 |
| P0-7 | 4개 소스(BOK·FSC·국회·관보·BCBS)의 인터페이스 stub + mock 데이터 1건/소스 | AC-007 자동 |
| P0-8 | LLM 사용량 추적 + $40 누적 임계 경고 | AC-008 자동 |
| P0-9 | .harness/gates default 게이트 모두 통과 (CI) | AC-010 자동 |
| **P0-10** | **주간 컴플라이언스 회의실에서 NPC 모임이 디지스트(신규/HIGH/탑 1건+Citation/다음 주 권고)를 자동 발표** *(v2 — AI 미팅룸 repurpose)* | AC-011 자동+수동 |
| **P0-11** | **LPC 캐릭터 커스터마이징(의상·머리 부품) 동작 + 영속화** *(v2 — deskrpg 원본 KEEP)* | AC-012 자동 |

### 3.2 Should Have (P1)

- P1-1: 동일 규제의 개정 이력(RegulationVersion) 최소 2회 이상 캡처 — `AC-009`
- P1-2: RAG는 한국어 BM25 정확도 우선 — pgvector는 stretch
- P1-3: GitHub Actions CI 자동 게이트 실행
- P1-4: Notification(앱 토스트)은 RPG 맵 밖 fallback (MVP에서는 NPCReport만)

### 3.3 Nice to Have (P2 / Future)

- BOK·FSC·국회·관보·BCBS 본격 크롤러 구현
- BCBS(영문) 본문 번역 자동화
- pgvector 의미 검색
- Notification 다채널 확장 (이메일·Slack)
- 픽셀 아트 자산 신규 제작 (NPC 스프라이트·맵 타일)
- RegulationVersion 텍스트 diff (현재는 LLM 1줄 요약)
- Agent 타입 확장 (요약 NPC·디스패처 NPC)
- 부서(target_department) enum 정규화 + 부서별 영향도 매트릭스
- 프로덕션 운영 (멀티 테넌트·권한·SSO·audit)

---

## 4. Non-Goals (의도적으로 하지 않을 것)

다음은 12주 안에 명시적으로 **하지 않습니다**. 스코프 보호.

- 프로덕션 운영 (멀티 테넌트·권한 모델·SSO·audit log)
- 모바일 반응형 UI
- 장기 데이터 보관 (12주 종료 후 폐기)
- deskrpg 원본의 **맵 에디터**·**멀티플레이어 동시 입장** (CUT 유지 — RegTrack 무관) *(v2: AI 미팅룸은 repurpose 되어 P0로 이동)*
- BCBS(바젤위) 영문 본문 번역 자동화 (v2)
- 픽셀 아트 자산 신규 제작 (deskrpg 기본 자산 재활용)
- Vector DB(pgvector) 기반 의미 검색 (BM25로 시작)
- 주간 회의 cron 자동 실행 *(v2 stretch — 시연용은 수동 트리거)*
- 회의 음성 합성 TTS *(v2 stretch — 현재는 자막)*
- **상업 배포 (Production commercial launch)** — deskrpg fork는 Sustainable Use License 1.0 하에 학술용·내부 사용만 허용. 상업화 시 프론트엔드 라이센스 재선택·재구현 필요 *(v8 — seed-v8 D-13, R-18 참조)*
- **deskrpg upstream의 비RegTrack 신규 기능 직접 통합** — 시연 종료 후 M5 retro 안건 *(v8)*

---

## 5. Personas (페르소나)

> 비엔지니어 독자를 위한 사용자 그림. MVP는 교내 시연용 가상 사용자(persona) 1종에 집중합니다.

### 5.1 주 사용자(Primary): "리테일 은행 컴플라이언스 담당자 이지영 대리"

| 속성 | 값 |
|------|-----|
| 직무 | 리테일(소매금융) 부문 컴플라이언스 |
| 일상 | 매일 아침 FSS·금융위 사이트 수동 확인, 부서 회의 자료 작성 |
| 기술 친화도 | 중 (엑셀·노션 능숙, 코딩 X) |
| 핵심 니즈 | "오늘 신규 규제 중 우리 리테일에 영향이 큰 것만 빠르게 알고 싶다" |
| RegTrack에서의 모습 | RPG 맵에 입장하는 사용자 캐릭터(`UserCharacter`). NPC와 in-world 대화로 정보 획득 |

### 5.2 보조 페르소나 (PRD 범위 외, 향후 참고)

- 준법감시인/임원 — 주간/월간 요약 보고 수신자
- B2B SaaS 외부 고객 — 화이트라벨·다중 테넌트 (P2 future)

---

## 6. User Stories (사용자 시나리오)

> 형식: As a `<역할>`, I want to `<행동>`, so that `<가치>`

### P0 (MVP)

- **US-1**: As a **사용자 캐릭터(`UserCharacter`)**, I want to **대시보드에 입장하면 RPG 맵과 활성 NPC를 보고**, so that **오늘 어떤 규제 활동이 있었는지 직관적으로 인지한다**. *(연결 AC: AC-005)*
- **US-2**: As a **사용자 캐릭터**, I want to **크롤러 NPC(`CrawlerAgent`)가 발견한 신규 규제 보고를 in-world 말풍선·사운드로 받고**, so that **놓치지 않고 알 수 있다**. *(AC-002, AC-005)*
- **US-3**: As a **사용자 캐릭터**, I want to **분석 NPC(`ImpactAnalyzerAgent`)에게 자연어로 "리테일 영향" 질문하고 근거 구절(`Citation`) 포함 답변을 받는다**, so that **LLM 환각(hallucination)을 의심하지 않고 의사결정에 쓸 수 있다**. *(AC-003, AC-005)*
- **US-4**: As a **사용자 캐릭터**, I want to **대시보드 필터(소스·분류·부서·날짜)를 자유롭게 조합**, so that **관심 영역에 집중한 뷰를 만들 수 있다**. *(AC-004)*
- **US-5**: As a **컴플라이언스 부서**, I want to **수집된 규제 원문이 Obsidian vault markdown으로 저장되고 Obsidian Git plugin 단축키로 팀과 공유 (수동 push)**, so that **언제든 vault를 열어 원문 확인·메모·링크할 수 있다**. *(AC-006, v4 단순화)*
- **US-6**: As a **개발자**, I want to **LLM API 호출 비용이 자동 누적되고 $40 임계치에서 경고**, so that **$100 / 2.5개월 예산을 넘기지 않는다**. *(AC-008)*
- **US-7**: As a **사용자 캐릭터**, I want to **매주 한 번 컴플라이언스 회의실에서 NPC들이 모여 주간 디지스트(신규/HIGH/탑 1건+Citation/다음 주 권고)를 자동 발표하는 모습을 보고**, so that **한 화면에서 주간 컴플 활동을 종합 인지한다**. *(v2 — AC-011)*
- **US-8**: As a **사용자 캐릭터**, I want to **내 캐릭터의 의상·머리 부품을 자유롭게 조합하고 다음 로그인에도 유지된다**, so that **나만의 페르소나로 RegTrack을 쓴다**. *(v2 — AC-012)*

### P1

- **US-9**: As a **사용자 캐릭터**, I want to **동일 규제의 개정 이력을 시간순으로 확인**, so that **변경 흐름을 추적할 수 있다**. *(AC-009)*

### P2 (Future)

- 임원 페르소나의 주간 요약 자동 보고
- 외부 채널(이메일·Slack) 푸시
- BCBS 영문 자동 번역 후 한국어 영향도 분석

---

## 7. Technical Requirements (기술 요구사항)

> 자세한 내용은 TRD 참조. 본 절은 stakeholder가 알아야 할 수준만.

### 7.1 Architecture (3-Tier Layered)

ARCHITECTURE_INVARIANTS.md Part 1 절대 규칙 준수:

```
┌──────────────────────────────────────────────────────────────┐
│ Presentation                                                  │
│   Next.js + TypeScript (deskrpg fork)                         │
│   - RPG 맵·NPC 스프라이트·말풍선·필터·타임라인 UI             │
│   - 사용자 캐릭터 입력 처리                                    │
└────────────────────┬─────────────────────────────────────────┘
                     │  REST + WebSocket (DTO)
┌────────────────────▼─────────────────────────────────────────┐
│ Logic                                                         │
│   Python (nanobot fork) + 별도 Crawler 서비스(scrapy/playwright)
│   - Agent 워크플로우 오케스트레이션                            │
│   - 신규/개정 분류, 영향도 분석, RAG(BM25), Citation 추출      │
│   - LLM 호출 + 사용량 추적                                     │
└────────────────────┬─────────────────────────────────────────┘
                     │  Repository pattern (DTO/Domain Model)
┌────────────────────▼─────────────────────────────────────────┐
│ Data                                                          │
│   SQLite (구조화 메타) + Obsidian markdown vault (원문)        │
│   - vault → git private repo sync                              │
│   - BM25 인덱스 영속화                                         │
└──────────────────────────────────────────────────────────────┘
```

**핵심 원칙**:
- Presentation은 Data 레이어를 직접 접근할 수 없음 (반드시 Logic 경유)
- 레이어 간 통신은 DTO·Interface로만
- Crawler는 nanobot과 분리된 별도 Python 서비스 — 스케줄·재시도 패턴이 다름

### 7.2 Data Model (Ontology — 18 entities, v2 +3)

| Entity (한국어 / 영어 PascalCase) | 핵심 필드 | 주요 관계 |
|----------|-----------|-----------|
| 규제 / `Regulation` | id, source_id, external_id, title, board_type(보도\|규정\|해설), change_type(NEW\|AMENDED), published_at, vault_path | belongs_to RegulationSource, has_many ImpactAnalysis·RegulationVersion·Notification |
| 규제 소스 / `RegulationSource` | code(FSS\|BOK\|FSC\|NA_GAZETTE\|BCBS), language(KO\|EN), mvp_status(FULL\|INTERFACE_ONLY) | has_many Regulation·CrawlJob |
| 규제 버전 이력 / `RegulationVersion` | regulation_id, version_no, diff_summary(LLM 1줄), snapshot_text | belongs_to Regulation |
| 영향도 분석 / `ImpactAnalysis` | regulation_id, target_department, severity, summary, llm_model, token_usage | belongs_to Regulation·UserCharacter, has_many Citation |
| 근거 인용 / `Citation` | impact_analysis_id, quoted_text, char_offset_start/end, relevance_score | belongs_to ImpactAnalysis·Regulation |
| 에이전트 / `Agent` | agent_type(CRAWLER\|IMPACT_ANALYZER), display_name, sprite_asset_id, status | has_many CrawlJob·NPCReport·LLMUsageRecord |
| 크롤러 NPC / `CrawlerAgent` | assigned_source_id, poll_interval_minutes | is_a Agent, belongs_to RegulationSource |
| 분석 NPC / `ImpactAnalyzerAgent` | rag_strategy(BM25\|HYBRID), llm_provider(OPENAI\|CLAUDE) | is_a Agent, has_many ImpactAnalysis |
| 사용자 캐릭터 / `UserCharacter` | display_name, department, sprite_asset_id | has_many ImpactAnalysis·NPCReport·DashboardFilter |
| 수집 작업 / `CrawlJob` | crawler_agent_id, status(RUNNING\|SUCCESS\|FAILED), items_found, parser_error | belongs_to CrawlerAgent·RegulationSource |
| NPC 보고 / `NPCReport` | agent_id, user_character_id, report_type, payload_ref, visual_effect, audio_effect | belongs_to Agent·UserCharacter |
| 알림 / `Notification` | regulation_id, channel(IN_APP\|TOAST\|BADGE), read_at | belongs_to Regulation (P1 fallback) |
| 대시보드 필터 / `DashboardFilter` | source_codes, change_types, target_departments, date_from/to | belongs_to UserCharacter |
| Vault 문서 / `VaultDocument` | vault_path(PK), regulation_id, frontmatter(YAML), body_markdown | belongs_to Regulation |
| LLM 사용량 / `LLMUsageRecord` | agent_id, provider, model, input/output_tokens, cost_usd, cached | belongs_to Agent |
| **회의 세션 / `MeetingSession`** *(v2)* | scheduled_for, started_at/ended_at, status, room_scene_id, digest_window_start/end | has_many MeetingParticipant, has_one MeetingReport |
| **회의 참가자 / `MeetingParticipant`** *(v2)* | meeting_session_id, participant_type(AGENT\|USER), agent_id?, user_character_id?, seat_position, speaking_order | belongs_to MeetingSession·Agent·UserCharacter |
| **회의 디지스트 / `MeetingReport`** *(v2)* | new_regulation_count, high_severity_count, top_regulation_id, top_citation_id, next_week_recommendation, digest_text, llm_model, token_usage | belongs_to MeetingSession·Regulation·Citation |

> **상세 ERD는** `docs/data-model/`에 별도 문서로 작성 예정.

### 7.3 API / Interface (10 actions)

| Action (한국어 / camelCase) | Actor | Input → Output |
|--------|-------|----------------|
| 규제 소스 크롤링 / `crawlRegulationSource` | CrawlerAgent | RegulationSource → Regulation 목록 + CrawlJob |
| 신규/개정 분류 / `classifyChangeType` | System(Logic) | 후보 + 이력 → change_type ∈ {NEW, AMENDED} |
| 영향도 분석 / `analyzeImpact` | ImpactAnalyzerAgent | Regulation + 부서 → ImpactAnalysis + Citation 목록 |
| 분석 NPC 질문 / `askAnalystNPC` | UserCharacter | 자연어 질문 → in-world 말풍선 응답 |
| 대시보드 입장 / `enterDashboard` | UserCharacter | 세션 → RPG 씬 + Pending NPCReport |
| 필터 적용 / `applyFilter` | UserCharacter | DashboardFilter (≥4종) → 카드/타임라인 |
| Vault git 동기화 / `syncVaultToGit` | System(Data) | 변경 VaultDocument → git commit·push |
| 유연 파싱 / `parseFlexible` | CrawlerAgent | HTML + parser_config → 구조화 후보 (실패 시 알림) |
| NPC 보고 확인 / `acknowledgeReport` | UserCharacter | NPCReport id → acknowledged 상태 전이 |
| LLM 사용량 추적 / `trackLLMUsage` | System(nanobot fork) | LLM 응답 → LLMUsageRecord + 누적 비용 |
| **주간 회의 예약** / `scheduleWeeklyMeeting` *(v2)* | System(Logic) | 다음 금요일 17:00 + 7일 디지스트 윈도우 → MeetingSession (SCHEDULED) |
| **회의 진행** / `conductMeeting` *(v2)* | System(Logic) | MeetingSession → MeetingReport + status=COMPLETED + NPCReport(MEETING_DIGEST) |
| **회의 디지스트 생성** / `generateMeetingDigest` *(v2)* | ImpactAnalyzerAgent | 윈도우 내 Regulation·ImpactAnalysis → MeetingReport (a/b/c/d 4항목) |
| **아바타 커스터마이징** / `customizeAvatar` *(v2)* | UserCharacter | LPC 부품 선택 → UserCharacter.lpc_parts 영속 |

### 7.4 Constraints (제약)

#### MUST (절대 요구)
- 3-tier 레이어 분리 준수 (`ARCHITECTURE_INVARIANTS.md`)
- Base repo `github.com/jhkim43/reg-detection @ dev/nanobot` 위에서 작업
- 백엔드: nanobot fork / 프론트: deskrpg fork
- LLM은 OpenAI/Claude API만 (자체 호스팅 X)
- ImpactAnalysis 응답에 반드시 Citation 포함 (hallucination 방지)
- Obsidian vault는 **private** git repo 강제
- 협업: feature → dev/nanobot → main 마일스톤 머지
- **AI 미팅룸은 RegTrack '주간 컴플라이언스 회의실'로 repurpose** *(v2)*
- **LPC 캐릭터 커스터마이징(의상·머리 부품)은 KEEP** *(v2)*
- **Vault sync는 Obsidian Git community plugin + 수동 push** *(v4)*
- **Scope change는 주 1회 retro + triage matrix로 결정** *(v4 — Section 17 참조)*

#### MUST NOT (절대 금지)
- PostgreSQL/pgvector를 MVP 의존성에 포함
- Obsidian vault를 public repo에 올리기
- LLM 응답을 Citation 없이 사용자에게 노출
- 차터 5개 소스 외 추가 (scope creep 방지)
- 비용 모니터링 없이 LLM 호출
- Crawler 실패 시 silent fail (Flexible Parser는 반드시 알림)
- **deskrpg 원본 맵 에디터·멀티플레이어 코드를 유지** *(v2 — CUT 강제)*
- **주간 회의 디지스트가 Citation 없는 LLM 요약에 의존** *(v2 — 반드시 Regulation·ImpactAnalysis 참조)*

---

## 8. Acceptance Criteria (수락 기준)

> 시연일에 이 체크리스트가 모두 ✓ 되어야 합격. 각 AC의 complexity는 구현 모드(Pair Mode 활성화 여부)를 결정.

### Must (P0)
- [ ] **AC-001** *(high)* — FSS 보도·규정·해설 3개 게시판 크롤링 → 신규/개정 Regulation을 SQLite + Obsidian vault에 저장 (1게시판 1건 이상)
- [ ] **AC-002** *(medium)* — 신규 발견 후 1시간 이내(시연일 기준) NPCReport 시각·청각 표시
- [ ] **AC-003** *(high)* — 분석 NPC 응답에 1개 이상 Citation(원문 인용 + char_offset) 포함
- [ ] **AC-004** *(low)* — 대시보드 필터 4종 작동 (소스·분류·부서·날짜)
- [ ] **AC-005** *(high)* — 시연 시나리오 4단계 끊김 없이 작동
- [ ] **AC-006** *(low, v4 강등)* — VaultDocument가 vault/ markdown 파일로 생성 + Obsidian Git plugin 설치·private remote 설정 확인 (push 자체는 사용자 수동)
- [ ] **AC-007** *(low)* — 4개 소스 RegulationSource 등록 + mock 데이터 1건/소스
- [ ] **AC-008** *(high, v3 격상)* — LLM 호출이 LLMUsageRecord에 모두 기록 + $40 임계 경고 + **메인 시연 진행 중 화면에 'LLM 사용량 위젯' 항시 표시 (누적 비용 USD · 호출 횟수 · 캐시 적중률 · 직전 모델명) 실시간 갱신**
- [ ] **AC-010** *(low)* — `.harness/gates` default 게이트(secrets·boundaries·structure·spec·layers·security·deps) PASS
- [ ] **AC-011** *(high, v2)* — '주간 컴플라이언스 회의실' 씬에서 크롤러 NPC + 분석 NPC가 한 방에 모여 MeetingReport 생성·낭독. 디지스트 4항목 포함: (a) 신규 건수, (b) HIGH 영향 건수, (c) 탑 1건 제목 + Citation 1개, (d) 다음 주 권고 1줄
- [ ] **AC-012** *(low, v2)* — LPC 캐릭터 커스터마이징 작동 (의상·머리 부품 1개 이상 변경 시 sprite_asset_id 반영 + 재로드 시 영속)

### Should (P1)
- [ ] **AC-009** *(medium)* — RegulationVersion 동일 external_id에 대해 최소 2회 이상 캡처 + LLM 1줄 diff_summary

> Complexity 분포 (v4): low **5** / medium **2** / high **5** → high 5개(AC-001 크롤러·AC-003 RAG Citation·AC-005 시연 통합·AC-008 LLM 위젯·AC-011 회의)에 대해 Pair Mode + Test Designer 강제 활성화. AC-006은 v4에서 medium → low로 강등 (Obsidian Git plugin 채택).

---

## 9. 핵심 시연 시나리오 (Demo Storyboard 1페이지)

> AC-005의 시각화. 발표 자료 1슬라이드로 압축 가능한 흐름.
>
> **v3 업데이트**: 모든 Frame에서 화면 우측 상단에 **'LLM 사용량 위젯'** 이 항시 표시되어 (a) 누적 비용 USD, (b) 누적 호출 횟수, (c) 캐시 적중률 %, (d) 직전 호출 모델명을 실시간 갱신. AC-008과 직접 연결되며 wow 모먼트 +1.

```
┌────────────────────────────────────────────────────────────────┐
│  [LLM 사용량 위젯 — 항시 표시, WebSocket 실시간 push]            │
│  💰 $0.42 / $100   📞 17 calls   ⚡ cache 64%   🤖 gpt-4o-mini  │
└────────────────────────────────────────────────────────────────┘

[Frame 1] 사용자 캐릭터 입장
  • 이지영 대리(픽셀 캐릭터)가 RegTrack 사무실 맵에 입장
  • 화면 좌측 상단: "오늘 발견된 규제 N건" 배지
  • 우측 상단 LLM 위젯: $0.00 / 0 calls (시연 시작 시 reset)
  • BGM 페이드인

[Frame 2] 크롤러 NPC 보고
  • 책상에 앉은 크롤러 NPC가 머리 위에 ❗ 말풍선
  • 클릭 → "FSS 보도자료에 신규 규제 1건 발견했습니다!"
  • 시각효과: 노란 글로우 + 알림음
  • payload: 규제 카드 (제목·published_at·요약)
  • LLM 위젯 갱신: 분류 LLM 1회 호출 → $0.01 / 1 call (캐시 미스)

[Frame 3] 분석 NPC에게 질문
  • 이지영 캐릭터가 분석 NPC(라이브러리에 앉아있음)에게 이동
  • 입력창: "이 규제가 우리 리테일 부서에 어떤 영향?"
  • 분석 NPC 머리 위 ⏳ → 처리 중
  • LLM 위젯 갱신: 임베딩·요약 LLM 호출 → $0.04 / 3 calls

[Frame 4] Citation 포함 응답
  • 분석 NPC 말풍선:
      "리테일 영향: HIGH ⚠️
       원문 근거: '제5조 ②항에 따라 ...라고 명시됨'
       (하이라이트된 vault 링크)"
  • 클릭 → Obsidian vault 원문 뷰어 열림 (우측 패널)
  • LLM 위젯: $0.04 / 3 calls / cache 33% / gpt-4o-mini
  • 메인 시나리오 종료
```

> **이것이 곧 AC-005 + AC-008 검증 절차이며 발표 5분 핵심 데모.**
> LLM 위젯이 항시 보임으로써 심사위원에게 **"비용 통제도 시스템의 일부"** 임을 시각적으로 증명.

### 9.2 LLM 사용량 위젯 — 컴포넌트 디테일 (v3)

| 요소 | 값 | 갱신 트리거 |
|------|-----|-----------|
| 누적 비용 USD | `$X.XX / $100` (예산 대비 진행률 바) | 매 LLM 호출 직후 WebSocket push |
| 누적 호출 횟수 | `N calls` | 매 호출 |
| 캐시 적중률 | `cache N%` (직전 100회 기준) | 매 호출 |
| 직전 모델명 | `gpt-4o-mini` 등 | 매 호출 |
| 임계 도달 색상 | $40 ≥ 노랑, $80 ≥ 빨강 | 누적 비용 갱신 시 |

> 위젯은 모든 Scene(Dashboard·Meeting·Avatar)에서 동일하게 floating. 위치는 우측 상단 고정.

### 9.3 보너스 페이즈 (v2 — 30초): 주간 컴플 회의실

> 메인 4단계 종료 후 추가로 30초간 시연. 발표 5분 한도 내 잔여 시간 활용.

```
[Bonus Frame] 주간 컴플라이언스 회의실
  • 사용자 캐릭터가 사무실 옆 회의실 문으로 이동
  • 입장 → 큰 원형 테이블에 크롤러 NPC + 분석 NPC가 좌석에 앉음
  • 사용자가 빈 의자에 앉음 (참관자)
  • 분석 NPC가 일어서서 디지스트 낭독 (자막 + 말풍선 시퀀스):
      "이번 주 신규 N건, HIGH 영향 K건이 발견되었습니다.
       가장 중요한 건은 '○○ 규정 개정안'이며, 제5조에서 '...'라고
       명시합니다. 다음 주는 ○○ 게시판을 집중 모니터링 권고합니다."
  • 화면 우측에 MeetingReport 카드 표시 (a/b/c/d 4항목)
  • 시연 종료 — 5초 정적 후 다음 슬라이드
```

> **이것이 곧 AC-011 검증 절차이며 wow 모먼트 +1.**

---

## 10. Risks & Mitigations (리스크 등록)

> 차터 risk + 인터뷰 surfaced assumption 통합. 상세 마일스톤별 트리거·오너는 `docs/risk/`의 Risk Register 별도 문서.

| ID | Risk | 영향(I) | 가능성(L) | Severity | Mitigation |
|----|------|---------|-----------|----------|-----------|
| R-1 | **스코프 광기 수용** — 12주에 deskrpg 풀 리스킨 + nanobot fork + RAG + 5소스 | H | H | **High** | 사용자 명시 결정 — 마일스톤(W4·W7·W10)마다 cut-off 회의, 슬립 시 future로 강등 |
| R-2 | **픽셀 아트 자산 디자인 역량** 미확인 (4명 중 담당자 미정) | M | M | Medium | MVP는 deskrpg 기본 자산 재활용 + 색상·이름만 변경 (seed 결정) |
| R-3 | **LLM 비용 초과** ($100/2.5개월 = 빡빡) | M | M | Medium | LLMUsageRecord 적재 + $40 임계 경고 (AC-008) + prompt cache 적극 사용 + 저렴 모델(GPT-4o-mini, Claude Haiku) 우선 |
| R-4 | **소스 웹 구조 변경** (FSS 사이트 개편 등) | H | L | Medium | Flexible Parser 설계 + 파싱 실패 즉시 알림 (parser_error 필드) |
| R-5 | **LLM 환각(hallucination)** | H | M | High | Citation 강제 (AC-003) + char_offset 검증 + 필요 시 HITL |
| R-6 | **Obsidian vault git sync 보안** — 민감 본문 노출 | H | L | Medium | Private repo 강제 (seed must_not), .gitignore 검토, 시연 직전 vault 감사 |
| R-7 | **nanobot upstream 변경 추적** 전략 미정 | L | M | Low | 12주 동안 fork 시점 freeze, upstream pull은 시연 후 |
| R-8 | **deskrpg 무관 기능(맵 에디터·멀티플레이어) 제거 공수** *(v2: AI 미팅룸은 repurpose로 이동)* | M | M | Medium | W2 spike에서 제거 범위 확정, 못 빼면 hidden 처리 |
| R-9 | **AI 미팅룸 repurpose 추가 스코프** *(v2)* — 회의 씬 통합·디지스트 LLM·NPC 좌석 동기화 추가 공수 | M | H | **High** | W9-W10 별도 트랙. 시연일 D-7까지 통합 미완 시 보너스 페이즈 cut, 메인 4단계만 시연 |
| R-10 | **회의 디지스트 LLM 추가 비용** *(v2)* | L | M | Low | 주 1회 호출 가정 시 ~$5 추가, $100 예산 내 흡수 가능. 호출 캐싱 강제 |

---

## 11. Timeline (12주 일정 — 차터 WBS 기반)

| 주차 | 단계 | 주요 산출물 | 마일스톤 게이트 |
|------|------|------------|----------------|
| W1-W2 | 착수 및 설계 | PRD·TRD·아키텍처 다이어그램·ERD·API 스펙·시연 스토리보드·Risk Register·LLM 비용 모델 (본 PRD 외 9개 문서) | M1: 모든 분석/설계 문서 v1 완료 + 어드바이저 리뷰 |
| W3-W5 | 데이터 연동 | FSS 크롤러 + Flexible Parser + SQLite 스키마 + Obsidian vault 저장 + git sync + 4개 소스 stub | M2: AC-001, AC-006, AC-007 통과 |
| W6-W8 | AI 분석 개발 | nanobot fork 커스텀 + ImpactAnalyzer Agent + RAG(BM25) + Citation + LLMUsageRecord + $40 임계 + **회의 디지스트 generator** *(v2)* | M3: AC-003, AC-008, AC-009 통과 |
| W9-W10 | 통합·구축 | deskrpg fork + RPG UI + NPCReport + 필터 4종 + 메인 시연 시나리오 통합 + **회의실 씬·LPC 커스터마이징** *(v2)* | M4: AC-002, AC-004, AC-005, **AC-011, AC-012** 통과 |
| W11-W12 | UAT 및 종료 | 게이트 PASS + 시연 리허설 + 최종 발표 | M5: AC-010 + 발표 |

> **양보 우선순위(슬립 시)**: ① 4개 소스 stub → ② deskrpg 고급 자산 → ③ **회의 보너스 페이즈 (AC-011)** → ④ RAG 고도화 → ⑤ 개정 이력 (AC-009 P1)

---

## 12. Success Metrics (성공 지표)

### 12.1 정량 지표 (KPI)

| 영역 | 지표 | 목표 |
|------|------|------|
| Speed | 신규 발견 → NPC 보고 latency | ≤ 1h (시연일 기준) |
| Accuracy | ImpactAnalysis 응답 중 Citation 포함률 | 100% (강제) |
| Coverage | 작동 필터 종류 | ≥ 4종 |
| Coverage | FSS 게시판 커버리지 | 보도·규정·해설 3종 모두 |
| Cost | LLM 누적 비용 | ≤ $100 / 2.5개월 |
| Quality | .harness/gates 통과율 | 100% |

### 12.2 정성 지표

- 시연 acceptance 4단계가 발표 5분 안에 끊김 없이 시연
- 심사 위원의 wow 포인트: "agent가 게임 캐릭터로 돌아다니는 시각화"
- 어드바이저 리뷰 만족도

---

## 13. Open Questions (향후 결정 필요)

> seed-v1.yaml의 `resolved_ambiguities`는 immutable로 결정했지만, 다음은 v2 또는 운영 단계에서 재논의가 필요한 항목:

1. 픽셀 아트 자산 신규 제작 범위 — v2에서 디자이너 합류 가능?
2. 부서(target_department) enum 정규화 기준 (회사별 부서 체계)
3. RegulationVersion 텍스트 diff vs LLM 요약 — 변경량 많을 때 어느 쪽이 더 유용?
4. 4개 소스 본격 크롤러 구현 우선순위 (시연 후 실제 운영 진입 시)
5. nanobot upstream 추적 정책 (rebase 주기·squash 룰)
6. Notification 채널 확장 (이메일·Slack·Webhook) 시기

---

## 14. Glossary (용어 사전 — 비엔지니어용)

| 용어 | 의미 |
|------|------|
| **PRD** | Product Requirements Document — 무엇을 왜 만드는지 적은 문서 |
| **TRD** | Technical Reference Document — 어떻게 만드는지 적은 기술 설계서 |
| **AC** | Acceptance Criteria — "이거 다 되면 합격" 체크리스트 |
| **MVP** | Minimum Viable Product — 최소 기능 제품 |
| **3-tier** | 화면(Presentation)·로직(Logic)·데이터(Data)의 3계층 구조 |
| **DTO** | Data Transfer Object — 레이어 간 데이터 운반용 객체 |
| **LLM** | Large Language Model — GPT·Claude 같은 대형 언어 모델 |
| **RAG** | Retrieval-Augmented Generation — 문서에서 근거를 찾아 LLM이 답하는 기법 |
| **BM25** | 키워드 기반 텍스트 검색 알고리즘 (벡터 검색 대비 가벼움) |
| **Citation** | LLM 응답의 근거 원문 구절 — 환각 방지용 |
| **NPC** | Non-Player Character — RPG 게임에서 컴퓨터가 조종하는 캐릭터. RegTrack에서는 Agent의 시각화 |
| **Vault** | Obsidian의 markdown 노트 모음 폴더 |
| **Fork** | 오픈소스 프로젝트를 복사해 자체 수정 시작 |
| **CI** | Continuous Integration — 코드 push마다 자동 테스트·검사 실행 |
| **Hallucination** | LLM이 사실이 아닌 내용을 그럴듯하게 만들어내는 현상 |
| **deskrpg** | Next.js 기반 픽셀 아트 가상 오피스 오픈소스. RegTrack 프론트의 fork 대상 |
| **nanobot** | Python 기반 경량 AI 에이전트 프레임워크. RegTrack 백엔드의 fork 대상 |
| **Obsidian** | 마크다운 기반 개인 지식 관리 앱 |

---

## 15. References (참고)

| 항목 | 위치 |
|------|------|
| Immutable Spec | `.harness/ouroboros/seeds/seed-v1.yaml` |
| Interview | `.harness/ouroboros/interviews/2026-05-16-10-12.yaml` |
| 차터 | `Project Charter_4팀_0514.docx` |
| 아키텍처 절대 규칙 | `ARCHITECTURE_INVARIANTS.md` |
| 프로젝트 가이드 | `CLAUDE.md` |
| Base Repo | https://github.com/jhkim43/reg-detection @ `dev/nanobot` |
| Fork 대상 (백엔드) | https://github.com/nanobot-ai/nanobot |
| Fork 대상 (프론트) | https://github.com/dandacompany/deskrpg |

---

## 17. Scope Change Governance (v4 신규)

> 12주 진행 중 스코프가 유기적으로 바뀔 수 있음을 인정하면서, 무질서한 변경으로 일정이 슬립하는 것을 방지하기 위한 **변경 거버넌스 정책**.

### 17.1 Retrospective Cadence

| 항목 | 내용 |
|------|------|
| **주기** | 매주 금요일 30분 |
| **참석자** | 팀 4인 (팀장(PM)·팀원1·팀원2·팀원3) |
| **어드바이저** | 대형 변경 안건 발생 시만 별도 회의 |
| **Agenda** | (1) 이번 주 발견된 scope 변경 안건 1줄씩 / (2) 진척 vs 계획 / (3) 다음 주 cut/keep 결정 |
| **Output** | git commit 또는 issue로 결정 기록 → 필요 시 seed-vN 새 버전 발행 |

### 17.2 Triage Matrix — 변경 크기별 처리

| 크기 | 정의 | 결정자 | 절차 | seed 영향 |
|------|------|--------|------|----------|
| **소형** | 단일 모듈·데이터값 변경 (예: FSS 게시판 폴링 주기 조정, parser_config 튜닝) | 작업자 1인 | git commit 메시지에 사유 1줄 | 없음 |
| **중형** | 여러 모듈 영향, 신규 기능 (예: FSS 새 게시판 추가, 필터 추가) | 팀 합의 (주간 retro) | retro에서 결정 → 다음 주 진행 | 없음 (보조 메모만) |
| **대형** | MVP 대상·아키텍처 결정 변경 (예: FSS → BOK 전환, 데이터 레이어 교체) | 어드바이저 + 팀 합의 | retro → 어드바이저 회의 → seed-vN 새 버전 → PRD·TRD 갱신 | **seed 새 버전 발행** |

### 17.3 시나리오 예시

| 발견 시점 | 변경 안건 | 분류 | 처리 |
|-----------|----------|------|------|
| W4 | "FSS '해설' 게시판은 신규 글이 거의 없네. 폴링 60분 → 6시간으로" | 소형 | 즉시 작업자가 parser_config 수정 + git commit |
| W6 | "분석 NPC 응답에 '대안 규제 1건 비교'를 추가하면 임팩트 ↑" | 중형 | 금요일 retro에서 토론 → 채택 시 W7 진행, 거절 시 future로 이동 |
| W8 | "BOK 사이트 구조가 단순해 보여서 BOK도 FULL로 가는 게 어떨까?" | 대형 | retro 안건 → 어드바이저 회의 → seed-v5 발행 (FULL 소스 2개로 확장) |

### 17.4 Enforcement (강제 규칙)

- **소형 변경이 잦으면 medium으로 묶어 retro에서 재분류** — 누적 소형이 결국 중형 임팩트일 수 있음
- **대형 변경은 마일스톤 게이트(M2/M3/M4) 직전·직후에만 허용** — 구현 도중 차단
- **어드바이저 부재 시 대형은 다음 retro로 연기** — 단독 결정 금지
- **변경 후 24시간 내 모든 분석/설계 문서(PRD/TRD/seed)에 반영** — drift 방지

### 17.5 변경 이력 기록

| 위치 | 무엇 |
|------|------|
| `seed-vN.yaml` | immutable 명세 (대형 변경 시) |
| 본 PRD changelog 상단 | 사람이 읽는 변경 요약 |
| git commit 메시지 | 소/중형 변경의 사유 |
| `docs/retro/YYYY-MM-DD.md` (선택) | retro 결정 노트 |

---

## 16. 승인 (Approval)

| 역할 | 이름 | 서명 / 일자 |
|------|------|------------|
| PM (Captain) | 팀장 | _________________ |
| 개발 | 팀원1 | _________________ |
| 기획/QA | 팀원2 | _________________ |
| 개발 | 팀원3 | _________________ |
| Advisor | (성함) | _________________ |

> 본 PRD는 seed-v1.yaml 기반의 **현 시점 합의안**입니다. 변경 시 새로운 PRD 버전(v2) 발행 + seed-v2.yaml 동시 생성 필요.
