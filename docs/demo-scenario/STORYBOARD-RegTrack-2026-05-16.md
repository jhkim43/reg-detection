# Demo Storyboard — RegTrack 발표 시연 풀 스크립트

> 발표 시연(5분 메인 + 30초 보너스)의 NPC 대사·동선·UI 트랜지션·음향·LLM 위젯 변화를 frame-by-frame으로 정의.
> AC-005 (메인 4단계) + AC-011 (보너스 회의실) + AC-008 (LLM 위젯) 통합 검증 대본.
> seed-v6 + PRD v4 + 모든 후속 문서 정합.

| 항목 | 내용 |
|------|------|
| **버전** | v1 |
| **작성일** | 2026-05-16 |
| **출처** | seed-v6 · PRD v4 §9 · ERD v1 · API spec v1 |
| **연결 AC** | AC-005, AC-008, AC-011, AC-012 |
| **총 길이** | 메인 5분 + 보너스 30초 = **5분 30초** |
| **사용자 페르소나** | 이지영 대리 (리테일 컴플라이언스, PRD §5.1) |

---

## 목차

- [1. 시연 전 준비 체크리스트](#1-시연-전-준비-체크리스트)
- [2. Frame-by-Frame 스크립트](#2-frame-by-frame-스크립트)
  - [Pre-roll (0:00~0:15)](#pre-roll-000015)
  - [Frame 1 — 사용자 캐릭터 입장 (0:15~1:00)](#frame-1--사용자-캐릭터-입장-015100)
  - [Frame 2 — 크롤러 NPC 보고 (1:00~2:00)](#frame-2--크롤러-npc-보고-100200)
  - [Frame 3 — 분석 NPC에게 질문 (2:00~3:15)](#frame-3--분석-npc에게-질문-200315)
  - [Frame 4 — Citation 포함 응답 (3:15~4:30)](#frame-4--citation-포함-응답-315430)
  - [Frame 5 — 마무리 + LLM 위젯 강조 (4:30~5:00)](#frame-5--마무리--llm-위젯-강조-430500)
  - [보너스 — 주간 회의실 (5:00~5:30)](#보너스--주간-회의실-500530)
- [3. NPC 대사 풀 스크립트](#3-npc-대사-풀-스크립트)
- [4. UI 트랜지션 정의](#4-ui-트랜지션-정의)
- [5. 사운드 큐 시트](#5-사운드-큐-시트)
- [6. LLM 위젯 색상 변화 타임라인](#6-llm-위젯-색상-변화-타임라인)
- [7. 백업·실패 시나리오](#7-백업실패-시나리오)
- [8. 리허설 체크리스트](#8-리허설-체크리스트)

---

## 1. 시연 전 준비 체크리스트

시연 D-1일 (시연 전날) 완료:

### Pre-flight Check

- [ ] Backend 컨테이너 정상 (`/healthz` 200, all checks "ok")
- [ ] Obsidian app 실행 + Local REST API plugin enabled (port 27123)
- [ ] OpenRouter API key 유효 (테스트 호출 1회 성공)
- [ ] SQLite 시드 데이터 확인 (FSS Regulation ≥ 3건, mock 4건)
- [ ] BM25 인덱스 빌드 완료 (`corpus_size > 0`)
- [ ] LLM 위젯 reset (`POST /admin/reset-usage` 또는 SQLite truncate)
- [ ] Frontend 로컬 dev 서버 실행 (`http://localhost:3000/dashboard`)
- [ ] **데모 데이터 시나리오 시드**: '전자금융감독규정 일부개정' Regulation + 영향도 분석 mock 1건 (실시간 분석 실패 fallback)
- [ ] **백업 영상 녹화** (이전 리허설 화면 — 인터넷·LLM 장애 fallback)
- [ ] **노트북 배터리 100% + 전원 어댑터 연결**
- [ ] **WiFi 대신 유선 LAN** (가능하면)
- [ ] 시연 직전 vault Obsidian Git plugin로 1회 push (팀원 공유 + 최신 상태)

### Pre-flight 자동화 스크립트 (제안)

```bash
# scripts/demo-preflight.sh
set -e
curl -fsS http://localhost:8000/healthz | jq -e '.status == "healthy"'
curl -fsS http://192.168.56.1:27123/vault/ -H "Authorization: Bearer $OBSIDIAN_TOKEN" >/dev/null
sqlite3 data/sqlite.db "SELECT COUNT(*) FROM regulations WHERE source_id IN (SELECT id FROM regulation_sources WHERE code='FSS')" | awk '$1>=3'
curl -fsS http://localhost:8000/api/llm-usage/snapshot | jq -e '.cost_usd <= 1.0'  # reset 검증
echo "✅ All preflight checks passed"
```

---

## 2. Frame-by-Frame 스크립트

> **타임라인 기준**: 0:00 = 시연 시작 직전 (발표자 인사 직후)
> **화면 구성**: 좌측 = 발표자, 우측 = 노트북 화면 (프로젝터로 미러링)

### Pre-roll (0:00~0:15)

**[화면]**: 검은 화면에 RegTrack 로고 페이드인 (5초) → 자동으로 `/dashboard` URL 진입

**[발표자]**:
> "오늘 보여드릴 RegTrack은 5개 금융 규제 사이트를 자동으로 모니터링하고, AI 에이전트들이 RPG 사무실에서 여러분에게 in-world로 보고하는 시스템입니다. 지금부터 5분 시연 시작합니다."

**[음향]**: 잔잔한 BGM 페이드인 (`bgm_dashboard_loop.ogg`, volume 30%)

**[LLM 위젯]**: 우측 상단 표시 — `💰 $0.00 / 📞 0 calls / ⚡ -- / 🤖 ready` (GRAY/NONE)

---

### Frame 1 — 사용자 캐릭터 입장 (0:15~1:00)

#### Visual
- 픽셀 아트 사무실 맵 (deskrpg 기본 자산 + RegTrack 리스킨)
- 화면 좌측: **이지영 대리** 캐릭터 (LPC 합성: brown_long hair + business_casual outfit)
- 사무실 안: 책상에 앉은 **크롤러 NPC** (왼쪽 책상), 라이브러리 책장 옆 **분석 NPC** (오른쪽)
- 좌측 상단 배지: "📋 오늘 발견된 규제 3건"

#### Action Sequence
| 시각 | 동작 |
|------|------|
| 0:15 | 사용자 캐릭터 페이드인, 출입문 위치에 등장 |
| 0:20 | 캐릭터가 자동으로 사무실 중앙으로 걸어들어옴 (3초 walk animation) |
| 0:25 | 좌측 상단 배지 페이드인 + count up animation (0→3) |
| 0:30 | NPC 2명이 각자 책상에서 idle animation 시작 |
| 0:40 | **TTS 또는 자막**: "이지영 대리, RegTrack에 오신 것을 환영합니다" |
| 0:50 | 화면 좌측 하단: 사용자 입력 안내 "💬 NPC를 클릭하면 대화할 수 있어요" |

#### 발표자 narration
> "사용자 캐릭터가 사무실에 입장합니다. 이미 백엔드 크롤러가 밤사이 작업해서 새 규제 3건을 발견한 상태고요. 그 중 1건은 우리 캐릭터에게 보고가 대기 중입니다."

#### LLM 위젯 (변화 없음)
```
💰 $0.00 / 📞 0 / ⚡ -- / 🤖 ready    [NONE]
```

#### 연결 컴포넌트
- `<DashboardScene>` → `<PlayerCharacter sprite={lpc_parts}>` (AC-012)
- API: `GET /api/user-characters/me` + `GET /api/agents/active`

---

### Frame 2 — 크롤러 NPC 보고 (1:00~2:00)

#### Visual
- 크롤러 NPC 머리 위에 **❗ 노란 글로우 말풍선** 등장
- 사용자가 NPC에게 클릭 또는 자동 접근
- NPC 옆에 카드 형태 알림 펼침

#### Action Sequence
| 시각 | 동작 |
|------|------|
| 1:00 | 크롤러 NPC ❗ 말풍선 등장 + 글로우 pulse (3 sec loop) |
| 1:05 | 알림음 재생 (`notification_chime.wav`) |
| 1:10 | 사용자 캐릭터가 크롤러 NPC에게 걸어감 (mouse-driven 또는 자동) |
| 1:20 | 크롤러 NPC 말풍선 펼침 (Frame 2.1 참조) |
| 1:30 | 우측에서 RegulationCard 슬라이드 인 |
| 1:50 | 사용자가 카드 클릭 → 카드 zoom + 본문 미리보기 |

#### Frame 2.1 — NPC 대사 (자막 + 말풍선)

```
크롤러 NPC: "이지영 대리님! 방금 FSS 보도자료 게시판에서
            신규 규제 1건을 발견했습니다."

           [📋 카드 표시]
           ┌─────────────────────────────────────────┐
           │ 🆕 전자금융감독규정 일부개정             │
           │ FSS · 보도 · 2026-05-15 09:00            │
           │                                          │
           │ 요약: 비대면 본인확인 절차의 강화를      │
           │       포함하여 ...                       │
           │                                          │
           │ [본문 보기]  [영향도 분석 의뢰]         │
           └─────────────────────────────────────────┘
```

#### 발표자 narration
> "크롤러 NPC가 새 규제를 발견하면 머리 위 말풍선과 효과음으로 즉시 알려줍니다. 단순 알림이 아니라 NPC 캐릭터의 'in-world 보고'로 표현해서 누가 어떤 일을 했는지 직관적으로 보입니다."

#### LLM 위젯 변화
- 분류 LLM 호출 1회 (`classifyChangeType` 1줄 diff 생성)
```
💰 $0.01 / 📞 1 / ⚡ 0% / 🤖 qwen3.6-35b-a3b    [NONE]
```

#### 연결 컴포넌트
- `<NpcReportToasts>` + WebSocket `/ws/npc-reports` 메시지
- API: `payload_ref` → `GET /api/regulations/{id}`
- 백엔드: SEQ-2 (TRD §시퀀스 다이어그램)

---

### Frame 3 — 분석 NPC에게 질문 (2:00~3:15)

#### Visual
- 사용자 캐릭터가 분석 NPC(라이브러리)로 이동
- 분석 NPC가 일어서서 사용자를 맞이함
- 화면 하단 입력창 활성화

#### Action Sequence
| 시각 | 동작 |
|------|------|
| 2:00 | 사용자 캐릭터 분석 NPC 좌석으로 walk (10초) |
| 2:10 | 분석 NPC가 일어남 + greeting animation |
| 2:15 | 화면 하단에 입력창 활성화 + placeholder "분석 NPC에게 무엇이든 물어보세요" |
| 2:20 | 발표자가 미리 준비된 질문 타이핑: **"이 규제가 우리 리테일 부서에 어떤 영향을 미치나요?"** |
| 2:40 | Enter 키 → 분석 NPC 머리 위 ⏳ 처리 중 |
| 2:45 | 백엔드: `POST /api/impact/ask` 호출 → RAG → LLM |
| 2:45~3:10 | 분석 NPC "생각하는" 애니메이션 + LLM 위젯 카운터 실시간 갱신 |

#### 발표자 narration (입력하면서)
> "이제 분석 NPC에게 자연어로 물어봅니다. '이 규제가 우리 리테일 부서에 어떤 영향을 미치나요?' — 백엔드에서는 BM25 검색으로 원문에서 관련 구절을 찾고, OpenRouter Qwen 모델이 영향도를 분석합니다. 핵심은 응답에 반드시 원문 근거를 포함시킨다는 점입니다."

#### LLM 위젯 변화 (실시간 갱신, ~3초 동안 위젯 카운터 증가)
```
2:45  💰 $0.01 / 📞 1 / ⚡ 0%   / 🤖 qwen3.6-35b-a3b   [NONE]
2:48  💰 $0.04 / 📞 2 / ⚡ 0%   / 🤖 qwen3.6-35b-a3b   [NONE]   ← BM25 + analyze
2:50  💰 $0.07 / 📞 3 / ⚡ 33%  / 🤖 qwen3.6-35b-a3b   [NONE]   ← Citation extract
```

#### 연결 컴포넌트
- `<ChatBubble>` 입력 + 응답
- API: `POST /api/impact/ask {regulation_id, target_department: "리테일"}`
- 백엔드: SEQ-3 (TRD §시퀀스)

---

### Frame 4 — Citation 포함 응답 (3:15~4:30)

#### Visual
- 분석 NPC 머리 위 ⏳ → ✓ 변경
- NPC 말풍선이 크게 펼쳐짐 + 본문 자막 typewriter 효과 (sec당 30자)
- 우측 패널: Obsidian vault 원문 뷰어 슬라이드 인

#### Frame 4.1 — NPC 응답 (대사 + 카드)

```
분석 NPC: "리테일 부문 영향: HIGH ⚠️

         이번 개정은 비대면 본인확인의 강화를 요구합니다.
         리테일 계좌 개설 프로세스에 추가 인증 단계가
         필요할 것으로 보입니다.

         📖 원문 근거:
         > '제5조 ②항에 따라 비대면 거래 시
            추가 본인확인 수단을 의무화한다.'
         (FSS 전자금융감독규정 일부개정, line 1234)
         "

         [Obsidian vault 원문 보기 →]
```

#### Action Sequence
| 시각 | 동작 |
|------|------|
| 3:15 | 분석 NPC ⏳ → ✓ 전환 + 사운드 cue (`analysis_done.wav`) |
| 3:18 | 말풍선 펼침 (1초) + typewriter 시작 |
| 3:50 | 본문 출력 완료 |
| 3:55 | "📖 원문 근거" 섹션 하이라이트 (yellow background pulse) |
| 4:05 | 발표자가 vault 링크 클릭 |
| 4:10 | 우측 패널에 Obsidian markdown 원문 슬라이드 인 (vault embed) |
| 4:15 | 원문 안에 인용 구절이 yellow background로 강조 표시 |
| 4:25 | 잠시 정적 (관객이 읽을 시간) |

#### 발표자 narration
> "Citation, 즉 원문 근거가 함께 표시됩니다. LLM이 '환각'으로 만들어낸 답이 아니라, 실제 규제 본문의 제5조 ②항을 정확히 인용했다는 게 보입니다. 우측 패널을 클릭하면 Obsidian vault의 원문으로 바로 이동해서 전체 맥락을 확인할 수 있습니다."

#### LLM 위젯 변화
```
4:00  💰 $0.08 / 📞 4 / ⚡ 25% / 🤖 qwen3.6-35b-a3b   [NONE]
```

#### 연결 컴포넌트
- `<ChatBubble>` 응답 표시
- `<VaultEmbed>` 또는 외부 링크 (우측 패널)
- BR-1 검증: Citation 0개면 422 응답 (이 시연에선 강제 데이터로 보장)

---

### Frame 5 — 마무리 + LLM 위젯 강조 (4:30~5:00)

#### Visual
- 화면 점진적 zoom out (전체 사무실 + 위젯 다 보임)
- 위젯이 잠시 highlight (glow 효과 1초)

#### Action Sequence
| 시각 | 동작 |
|------|------|
| 4:30 | 분석 NPC가 자리로 돌아감 + 사용자 캐릭터 자유 |
| 4:35 | 카메라 zoom out (sceneCenter → full view) |
| 4:40 | LLM 위젯 zoom in (CSS scale 1.2, 2초) |
| 4:45 | 위젯 highlight effect 종료 |
| 4:55 | "다음은 보너스" 자막 페이드인 |

#### 발표자 narration
> "여기까지가 핵심 4단계 시연이고요, 우측 상단을 보시면 시연 동안 LLM이 4번 호출됐고 누적 비용은 0.08달러 — Qwen 모델 덕분에 정말 저렴합니다. 캐시 적중률도 25%로 점점 올라가고 있어요. 비용을 시각화하는 것도 시스템의 일부입니다. 이제 보너스 페이즈로 넘어가서 주간 회의실을 보여드리겠습니다."

#### LLM 위젯 최종 (메인 시연 종료 시점)
```
💰 $0.08 / 📞 4 / ⚡ 25% / 🤖 qwen3.6-35b-a3b   [NONE]
```

> 100달러 예산 대비 0.08%. 시각적으로 progress bar 거의 비어있음.

---

### 보너스 — 주간 회의실 (5:00~5:30)

#### Visual
- 사용자 캐릭터가 사무실 옆 회의실 문으로 이동
- 회의실 씬 전환: 큰 원형 테이블 + NPC 2명 + 빈 의자
- NPC들이 좌석 안무 (D-4 클라이언트 자체 애니메이션)

#### Action Sequence
| 시각 | 동작 |
|------|------|
| 5:00 | 사용자가 회의실 문 클릭 → 회의실 씬 전환 (1초 fade) |
| 5:01 | API: `GET /api/meeting/current` → MeetingSession 조회 |
| 5:02 | API: `POST /api/meeting/:id/conduct` → MeetingReport 생성 (백엔드 ~3초) |
| 5:03 | 그 동안: NPC 2명이 좌석으로 walk + sit animation |
| 5:06 | 사용자도 빈 의자에 앉음 (참관자) |
| 5:07 | 분석 NPC가 일어서서 디지스트 낭독 시작 |
| 5:07~5:25 | 자막 typewriter + 우측 DigestCard 4항목 순차 표시 |
| 5:26 | 분석 NPC가 앉음 + "다음 주에 또 만나요" 인사 |
| 5:28 | 화면 fade out + RegTrack 로고 |
| 5:30 | 시연 종료 |

#### Frame B.1 — 분석 NPC 회의 발표 대사

```
분석 NPC (회의실, 일어서서):
"안녕하세요, 이번 주 컴플라이언스 디지스트를 보고드립니다.

 📊 이번 주 신규 규제 7건
 ⚠️  HIGH 영향 2건

 가장 중요한 건은 'FSS 전자금융감독규정 일부개정'으로,
 제5조에서 비대면 본인확인 절차 강화를 명시했습니다.

 다음 주는 FSS 보도자료에서 후속 시행 가이드라인을
 집중 모니터링하시기를 권고합니다."

[DigestCard 우측 표시]
┌─────────────────────────────┐
│ 📅 2026-05-15 ~ 2026-05-22  │
├─────────────────────────────┤
│ (a) 신규 건수      7건       │
│ (b) HIGH 영향      2건       │
│ (c) 탑 1건         FSS-...   │
│     근거           제5조 ②항  │
│ (d) 다음 주 권고    ...      │
└─────────────────────────────┘
```

#### 발표자 narration
> "원본 deskrpg에 있던 AI 미팅룸 기능을 RegTrack용으로 재해석했습니다. 매주 금요일 NPC들이 모여서 그 주의 컴플라이언스 디지스트를 발표하는 거죠. 이 디지스트도 마찬가지로 원문 근거를 포함합니다."

#### LLM 위젯 변화 (디지스트 LLM 호출)
```
5:06  💰 $0.13 / 📞 5 / ⚡ 20% / 🤖 qwen3.6-35b-a3b   [NONE]
```

#### 연결 컴포넌트
- `<MeetingScene>` + `<SeatedAgents>` + `<DigestSubtitle>` + `<DigestCard>`
- API: `POST /api/meeting/:id/conduct` (BR-3 4항목 검증)
- 백엔드: SEQ-5 (TRD §시퀀스)

---

## 3. NPC 대사 풀 스크립트

> Frame별 대사를 한 곳에 모아 변경 시 위치 추적 쉽게.

### 3.1 사용자 캐릭터 (이지영 대리)

| Frame | 대사 |
|-------|------|
| 1 | (음성·자막 모두 없음. 동작만) |
| 3 | "이 규제가 우리 리테일 부서에 어떤 영향을 미치나요?" (타이핑 입력) |
| B | (음성 없음. 의자에 앉아 참관) |

### 3.2 크롤러 NPC (FSS 수집 NPC)

| Frame | 대사 |
|-------|------|
| 2 | "이지영 대리님! 방금 FSS 보도자료 게시판에서 신규 규제 1건을 발견했습니다." |
| B | (회의에서 침묵 — 분석 NPC가 발표) |

### 3.3 분석 NPC

| Frame | 대사 |
|-------|------|
| 3 | (말풍선 없음. ⏳ 처리 중 표시만) |
| 4 | "리테일 부문 영향: HIGH ⚠️ 이번 개정은 비대면 본인확인의 강화를 요구합니다. 리테일 계좌 개설 프로세스에 추가 인증 단계가 필요할 것으로 보입니다." (이어서) "원문 근거: '제5조 ②항에 따라 비대면 거래 시 추가 본인확인 수단을 의무화한다.'" |
| B | "안녕하세요, 이번 주 컴플라이언스 디지스트를 보고드립니다." (이어서 위 Frame B.1 디지스트 전문) |

### 3.4 시스템 (TTS 또는 자막만)

| Frame | 메시지 |
|-------|--------|
| 1 | "이지영 대리, RegTrack에 오신 것을 환영합니다" |
| 5 | "메인 시연 종료. 보너스 — 주간 회의실" |
| B (종료) | (음성 없음. 로고 페이드 아웃) |

---

## 4. UI 트랜지션 정의

> 모든 transition은 `frontend/scenes/*` 컴포넌트의 framer-motion 또는 CSS transition으로 구현.

| ID | 이름 | 시점 | duration | easing | 주의 |
|----|------|------|----------|--------|------|
| T-01 | RegTrack 로고 페이드인 | 0:00 | 5s | ease-in | BGM과 동기화 |
| T-02 | dashboard fade in | 0:15 | 1s | ease-out | 검은 화면 → 사무실 |
| T-03 | 캐릭터 walk-in | 0:20 | 3s | linear | sprite 4 frames |
| T-04 | 배지 count up | 0:25 | 1s | ease-out | 숫자 0→3 |
| T-05 | NPC ❗ 글로우 | 1:00 | 3s loop | sine pulse | sat=80% |
| T-06 | RegulationCard 슬라이드 인 | 1:30 | 0.4s | spring | from right |
| T-07 | RegulationCard zoom | 1:50 | 0.3s | ease-out | scale 1.0→1.05 |
| T-08 | 입력창 활성화 | 2:15 | 0.2s | ease-in | placeholder 페이드 |
| T-09 | 분석 NPC ⏳→✓ | 3:15 | 0.5s | bounce | sprite 변경 + scale |
| T-10 | 말풍선 펼침 + typewriter | 3:18~3:50 | 30/sec | linear | 자막 chunk |
| T-11 | Citation 하이라이트 pulse | 3:55 | 1s × 3 | ease-in-out | yellow bg |
| T-12 | vault embed 슬라이드 인 | 4:10 | 0.4s | spring | from right, 40% width |
| T-13 | 카메라 zoom out | 4:35 | 5s | ease-in-out | scene scale 1.0→0.8 |
| T-14 | LLM 위젯 zoom in | 4:40 | 2s | ease-in-out | scale 1.0→1.2 |
| T-15 | 회의실 씬 전환 | 5:00 | 1s | cross-fade | dashboard→meeting |
| T-16 | NPC 좌석 walk | 5:03 | 3s | linear | 각 NPC 좌표 이동 |
| T-17 | 분석 NPC 일어섬 | 5:07 | 0.5s | spring | scale.y 0.9→1.0 |
| T-18 | DigestCard 항목 순차 표시 | 5:07~5:20 | 2s/item | spring | stagger 0.3s |
| T-19 | 최종 fade out + logo | 5:28 | 2s | ease-out | volume도 fade |

---

## 5. 사운드 큐 시트

> 모든 음원은 `frontend/public/audio/` 배치. CC0/MIT 라이선스 사용.

| ID | 파일 | 시점 | 길이 | volume | 비고 |
|----|------|------|------|--------|------|
| S-01 | `bgm_dashboard_loop.ogg` | 0:00 fade in | loop | 30% | 부드러운 office BGM |
| S-02 | `welcome_chime.wav` | 0:40 | 1s | 60% | TTS 직전 |
| S-03 | `notification_chime.wav` | 1:05 | 0.5s | 80% | 크롤러 NPC 보고 |
| S-04 | `npc_greeting.wav` | 2:10 | 1s | 70% | 분석 NPC 일어섬 |
| S-05 | `thinking_loop.ogg` | 2:45 fade in/out | 25s | 40% | NPC 처리 중 |
| S-06 | `analysis_done.wav` | 3:15 | 0.8s | 80% | 분석 완료 |
| S-07 | `vault_open.wav` | 4:10 | 0.3s | 60% | vault embed 슬라이드 |
| S-08 | `bgm_meeting.ogg` | 5:00 cross-fade | loop | 35% | 회의실용 약간 진지 |
| S-09 | `digest_announce.wav` | 5:07 | 1s | 70% | 디지스트 시작 |
| S-10 | `bgm_dashboard_loop.ogg` | 5:28 fade out | - | 0% | 종료 |

---

## 6. LLM 위젯 색상 변화 타임라인

> seed-v6 단계별 임계치 적용. 시연 동안 위젯이 **GRAY → (변화 없음, 비용 매우 적음)** 으로 유지됨.

```
시점    누적($)  threshold_level  위젯 색상   설명
─────────────────────────────────────────────────────
0:00     0.00    NONE            GRAY        시연 시작 reset
1:05     0.01    NONE            GRAY        classify LLM 1회
2:48     0.04    NONE            GRAY        impact analyze + RAG
2:50     0.07    NONE            GRAY        Citation extract
4:00     0.08    NONE            GRAY        Frame 4 종료
5:06     0.13    NONE            GRAY        meeting digest LLM
5:30     0.13    NONE            GRAY        시연 종료
```

**예산 대비**: 0.13 / 100 = **0.13%**. 위젯 progress bar 거의 비어있음 (시각적으로 안심감 ↑).

### 6.1 시연 외 (실제 누적이 진행됐을 때)

리허설 중 누적 비용을 일부러 올린 데모도 가능:
```
누적($)  level     색상     이펙트
< 30     NONE      GRAY     기본
30-59    YELLOW    🟡       위젯 background yellow tint
60-89    ORANGE    🟠       background orange + NPC 알림 popup
≥ 90     RED       🔴       background red + 차단 경고
```

> 시연 본편에는 단계 변화가 일어나지 않음 (저비용). 단 발표자가 "여기까지가 yellow 임계까지 75% 더 호출할 수 있다"고 언급 가능.

---

## 7. 백업·실패 시나리오

> 시연 중 외부 의존성(인터넷·LLM API·Obsidian REST API)이 실패할 경우 대응.

### 7.1 실패 매트릭스

| 실패 | 영향 Frame | 백업 |
|------|-----------|------|
| LLM API 다운 | 3, 4, 보너스 | **사전 캐싱된 응답** 재생 (prompt cache fixture) |
| Obsidian REST API 다운 | 4 (vault embed) | 외부 링크 → 정적 markdown viewer (`/static/regulation.md`) |
| 인터넷 끊김 | 모두 | localhost 폐쇄 동작 + 사전 녹화 영상 fallback |
| Frontend 빌드 오류 | 모두 | **사전 녹화 영상**으로 전환 (Keynote에서 5분 영상 재생) |
| Backend 컨테이너 다운 | 모두 | `docker compose restart backend` (10초) + 발표자 즉흥 |

### 7.2 사전 캐싱 fixture (Frame 3·4 보장)

```python
# scripts/seed-demo-cache.py
# 시연 직전 실행 — Frame 3 응답을 prompt cache에 미리 적재
DEMO_QUESTION = "이 규제가 우리 리테일 부서에 어떤 영향을 미치나요?"
DEMO_REGULATION_ID = "demo-regulation-fss-001"

cached_response = ImpactAnalysisDTO(
    severity="HIGH",
    summary="비대면 본인확인의 강화...",
    citations=[Citation(quoted_text="제5조 ②항...", ...)],
)
prompt_cache.set(hash(...), cached_response)
```

→ 시연 중 LLM API 다운이어도 캐시에서 응답 → 0.5초 latency.

### 7.3 사전 녹화 영상

- **녹화 시점**: 시연 D-2일 (이틀 전) 리허설 영상
- **포맷**: 1080p 60fps MP4, 5분 30초
- **저장**: `docs/demo-scenario/backup-recording.mp4` + 클라우드 (Google Drive 등)
- **활용 시점**: Frontend·Backend 동시 다운 시 발표자가 "시간 단축을 위해 사전 녹화 영상으로 보여드리겠습니다"라고 자연스럽게 전환

---

## 8. 리허설 체크리스트

### 8.1 D-7일 (1주 전)

- [ ] 메인 4단계 e2e 통합 완료 (AC-005 PASS)
- [ ] 회의실 보너스 완료 (AC-011 PASS)
- [ ] LLM 위젯 실시간 갱신 확인 (AC-008 PASS)
- [ ] LPC 아바타 변경 확인 (AC-012 PASS) — 시연엔 미사용이지만 백업 데모용

### 8.2 D-3일 (3일 전 — 첫 풀 리허설)

- [ ] 시연 풀 스크립트 1회 실행 (스톱워치 측정 — 5:30 ± 15초)
- [ ] 발표자 narration 외움
- [ ] NPC 대사 자막 한국어 맞춤법 검수
- [ ] 백업 영상 녹화
- [ ] 사전 캐싱 fixture 작동 확인

### 8.3 D-1일 (전날)

- [ ] preflight 스크립트 100% PASS
- [ ] vault Obsidian Git plugin로 push
- [ ] LLM 위젯 reset
- [ ] 노트북 충전 + 케이블 점검
- [ ] **발표자 2회 풀 리허설** (시간 측정)

### 8.4 D-day (당일)

| 시점 | 행동 |
|------|------|
| 발표 1시간 전 | preflight 재실행 + 백업 영상 클라우드 다운로드 |
| 발표 30분 전 | 노트북 reboot + 브라우저 cache clear |
| 발표 10분 전 | Backend·Frontend·Obsidian 정상 확인 + LLM 위젯 reset |
| 발표 5분 전 | 화면 미러링 테스트 (프로젝터) |
| 발표 1분 전 | `/dashboard` URL bookmark 클릭 준비 |

---

## 9. References

- **Seed**: `.harness/ouroboros/seeds/seed-v6.yaml`
- **PRD §9**: `docs/prd/PRD-RegTrack-2026-05-16.md`
- **TRD §시퀀스**: `docs/trd/TRD-RegTrack-2026-05-16.md`
- **Architecture SEQ-1~7**: `docs/architecture/ARCHITECTURE-RegTrack-2026-05-16.md`
- **ERD**: `docs/data-model/ERD-RegTrack-2026-05-16.md`
- **API spec**: `docs/api/API-RegTrack-2026-05-16.md`
- **Backup recording (촬영 후)**: `docs/demo-scenario/backup-recording.mp4`
- **deskrpg 픽셀 자산**: https://github.com/dandacompany/deskrpg
- **LPC sprites**: https://liberatedpixelcup.github.io/
