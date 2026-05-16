# RegTrack 문서 — 왜·어디서·언제 보는지

> **이 문서의 목적**: repo에 갑자기 추가된 `docs/`와 `.harness/` 안의 파일들이 뭔지 모르겠는 팀원·신규 합류자·어드바이저가 "어떤 상황에 어느 문서를 보면 되는지" 5분 안에 파악하는 것.

| 항목 | 내용 |
|------|------|
| 프로젝트 | RegTrack — 지능형 규제 변화 모니터링 시스템 |
| 팀 | AIMBA ABP 4팀 |
| 기간 | 12주 (2026-05 ~ 2026-08) |
| 본 문서 | catalog v2 (2026-05-16) |

---

## 1. 먼저, "왜 이런 문서들이 잔뜩 생긴 건가?"

base repo에는 원래 `nanobot/` 소스코드만 있었습니다. 그런데 갑자기 PR로 `docs/` 9개 문서 + `.harness/ouroboros/` 안의 spec 파일들이 추가됐다면 — 이건 **AI 코딩 협업을 위한 "하네스(harness) 템플릿"** 을 도입한 결과입니다.

### 하네스가 해결하려는 문제

```
❌ "AI가 한 번에 큰 작업을 받으면 정확도가 떨어진다"
❌ "팀원마다 PRD·TRD 양식이 달라서 일관성이 없다"
❌ "결정이 어디서 났는지 추적이 안 된다"
❌ "AI가 만든 코드가 우리 아키텍처를 무시한다"
❌ "스코프가 계속 바뀌어서 누가 무엇 책임인지 모른다"
```

### 하네스가 제공하는 답

```
✅ 작업을 73개 atomic task로 분해 (각 30분 이내)
✅ 모든 문서가 동일한 ground truth(seed)에서 파생
✅ 모든 결정이 immutable seed 버전(v1~v7)으로 추적 가능
✅ 아키텍처 규칙(ARCHITECTURE_INVARIANTS)이 자동 게이트로 강제
✅ 변경 거버넌스(Scope §17)로 누가 무엇을 결정하는지 명시
```

→ 그래서 코드 한 줄 쓰기 전에 이 문서들을 먼저 만든 것입니다.

---

## 2. 문서별 — 왜·언제·어떻게

### 📘 `prd/PRD-RegTrack-2026-05-16.md` — **무엇을·왜** 만드는지

**왜 필요한가**
어드바이저·PM·비엔지니어가 "이 프로젝트 뭐 만든다는 거야?"라고 물을 때, 코드를 안 보고도 답할 수 있는 단일 출처. 12주 후 시연 자리에서 합격 여부를 판정하는 acceptance criteria 12개의 원천.

**언제 보나**
- 처음 프로젝트 합류했을 때 (전체 그림)
- "이 기능이 P0인지 P1인지" 결정할 때
- 시연 시나리오 검토 시
- 어드바이저 회의 자료로

**어떻게 쓰나**
- §3 Goals → 본인 작업이 어느 우선순위에 속하는지 확인
- §8 AC 12개 → 본인이 구현 중인 task가 어느 AC에 기여하는지
- §9 Storyboard → 시연 흐름이 어떻게 잡혔는지
- §10 Risks → 본인 작업의 위험 인지
- §17 Scope Governance → 변경 제안할 때 어느 절차 따라야 하는지

**변경 시점**: seed가 새 버전 나오면 24시간 내 동기 갱신 (drift 방지)

---

### 📗 `trd/TRD-RegTrack-2026-05-16.md` — **어떻게** 만드는지

**왜 필요한가**
PRD는 "리테일 영향 분석을 보여준다"고만 적혀있음. TRD는 "그걸 위해 FastAPI에 어떤 endpoint를 만들고, 어떤 service에 어떤 함수를 두고, Repository를 어떻게 분리할지" 결정 모음. 개발자가 PRD만으로는 못 만듦.

**언제 보나**
- 새 모듈 짜기 직전 (어디에 위치시킬지)
- "이 코드 어느 레이어에 두지?" 헷갈릴 때
- 다른 사람이 짠 코드 리뷰할 때 (구조 위반 검출)
- 외부 의존성(Obsidian·OpenRouter) 통합 방식 확인할 때
- 신규 합류자 온보딩

**어떻게 쓰나**
- §1.2 핵심 결정 D-1~D-7 → "왜 REST? 왜 SQLite?" 답
- §2.1~2.3 레이어별 책임 → 본인 모듈이 어느 폴더에 가야 하는지
- §2.2.3 BR-1·BR-2·BR-3 → 비즈니스 규칙 의사코드
- §4 디렉토리 구조 → 새 파일 만들 때 어디에 둘지
- §7.2 구현 순서 → "지금이 어느 단계지?"

**변경 시점**: 큰 결정(예: REST → GraphQL)은 retro 거쳐서. 작은 결정(폴더명 변경)은 commit 메시지에 사유.

---

### 📐 `architecture/ARCHITECTURE-RegTrack-2026-05-16.md` — **그림으로 보는** 구조

**왜 필요한가**
글로 된 TRD를 다 안 읽어도, 다이어그램만 봐도 시스템 윤곽이 잡힘. 회의·발표·white-board 토론에서 시각 자료로 쓰임.

**언제 보나**
- 어드바이저·외부에 시스템 설명할 때 (다이어그램 캡처)
- 처음 코드 읽기 시작할 때 (전체 컴포넌트 위치)
- 새 시나리오(예: 회의실 흐름) 토론 시 시퀀스 다이어그램
- TRD §2가 너무 글이 많을 때 시각 보조

**어떻게 쓰나**
- §1.1 Context → 외부 시스템과의 경계 (5개 사이트·LLM·GitHub)
- §1.2 Container → docker compose 서비스 4개 어떻게 통신
- §1.4 Component-Frontend → React 컴포넌트 트리
- §2 SEQ-1~7 → 각 시나리오의 메시지 흐름 (백엔드 디버깅 시 유용)
- §4 Layer Dependency → 게이트가 무엇을 차단하는지

**변경 시점**: 컨테이너·시퀀스 변경 시. 자주는 변하지 않음.

---

### 🗄 `data-model/ERD-RegTrack-2026-05-16.md` — **데이터** 구조 상세

**왜 필요한가**
TRD는 "Regulation 엔티티가 있다"고만 적음. ERD는 "regulation 테이블에 어떤 컬럼·타입·CHECK 제약·인덱스가 있는지" 코드 수준 상세. 데이터 작업자가 매일 봐야 함.

**언제 보나**
- 새 Alembic 마이그레이션 작성 직전
- Repository 메서드 짤 때 (어떤 컬럼 쿼리할지)
- SQLite 직접 디버깅 시 (`sqlite3 .schema`)
- Obsidian frontmatter 작성 시 (어떤 키가 필수인지)
- BM25 인덱스 동작 이해할 때

**어떻게 쓰나**
- §1 Mermaid ERD → 관계 한눈에
- §2 DDL → 직접 복사해서 마이그레이션
- §3 Obsidian markdown 템플릿 → ObsidianApiClient에서 본문 합성 시
- §6 시드 데이터 → 초기 INSERT
- §8 자주 쓰는 SQL → 대시보드 필터·디지스트 등 패턴

**변경 시점**: 테이블 추가/스키마 변경 시. Alembic 마이그레이션과 함께.

---

### 🔌 `api/API-RegTrack-2026-05-16.md` — **외부에 노출되는 인터페이스**

**왜 필요한가**
FastAPI가 자동으로 OpenAPI를 만들지만, 그건 endpoint 목록일 뿐. "왜 이 endpoint가 필요한지·언제 422 에러가 나는지·외부 서비스(Obsidian·OpenRouter)와 어떻게 통신하는지"는 사람이 적어야 함.

**언제 보나**
- 프론트엔드 API 호출 코드 짤 때
- 백엔드 endpoint 신규 추가 시 (스타일·error code 통일)
- Obsidian Local REST API 호출 디버깅
- OpenRouter Qwen 호출 비용·인증 이슈
- error_code 표 (어떤 상황에 어떤 422·502 발생?)

**어떻게 쓰나**
- §1 전체 지도 → 어디서 어디로 무슨 프로토콜
- §2 REST endpoint 24개 → 각 endpoint 스펙
- §3 WebSocket 2개 채널 → push 메시지 형식
- §4 ObsidianApiClient → 팀원 obsidian skill 통합 의사코드
- §5 LLMClient → OpenRouter Qwen 호출 (BR-2 비용 가드 포함)
- §7 error_code 표 → 4xx·5xx 응답 의미

**변경 시점**: endpoint 추가/변경 시. 응답 필드 추가는 backward-compat이라 OK. 삭제는 seed-vN 필요.

---

### 🎬 `demo-scenario/STORYBOARD-RegTrack-2026-05-16.md` — **시연 5분 30초 풀 스크립트**

**왜 필요한가**
12주 후 시연 자리에서 발표자(이지영 캐릭터 조종)가 정확히 뭘 클릭하고 뭘 말하는지 frame-by-frame 정의. NPC 대사·사운드·UI 트랜지션·LLM 위젯 변화 모두 사전 안무. 즉흥하면 5분 시간 초과 위험.

**언제 보나**
- 시연 리허설 (D-7, D-3, D-1)
- 시연 발표자가 narration 외울 때
- QA가 e2e 테스트(AC-005·AC-011) 시나리오 작성할 때
- 백업 영상 녹화 시
- 사운드·자산 디자이너가 작업 파악 시

**어떻게 쓰나**
- §2 Frame-by-Frame → 시연 본편 5분 + 보너스 30초 흐름
- §3 NPC 대사 풀 스크립트 → 자막 한국어 검수
- §4 UI 트랜지션 19종 → framer-motion 구현
- §5 사운드 큐 시트 10종 → audio 파일 준비
- §7 백업 시나리오 → LLM 다운·인터넷 끊김 대응
- §8 리허설 체크리스트 → D-day까지 단계별 확인

**변경 시점**: 시연 시나리오 변경 시. 시연 D-7까지는 자주, D-3 이후는 변경 동결.

---

### ⚠️ `risk/RISK-RegTrack-2026-05-16.md` — **무엇이 잘못될 수 있는지**

**왜 필요한가**
12주 동안 발생할 수 있는 17가지 위험을 미리 식별하고 대응을 준비. PM은 매주 retro에서 이 문서로 점검. 위험을 무시하다 마일스톤 슬립하는 게 가장 큰 risk.

**언제 보나**
- 매주 금요일 30분 retro (필수)
- 본인 작업 시작 전 (해당 영역 risk 인지)
- 마일스톤 게이트 통과 못 할 위기 시 (양보 §6 발동)
- 어드바이저 회의 자료
- 신규 합류자 — 우리가 어떤 위험을 안고 있는지

**어떻게 쓰나**
- §2 Risk Register 17개 → severity 순으로 점검
- §3 Heatmap → 우선 대응 순서 시각화
- §4 갠트 차트 → 마일스톤 일정 시각화
- §5 Risk-Milestone 매트릭스 → 각 단계에 어떤 risk가 최대
- §6 양보 우선순위 → "스코프 못 맞추면 무엇부터 자를지"
- §7 Decision Triggers → 임계 도달 시 자동/수동 행동

**변경 시점**: retro마다 status 갱신 (OPEN→MITIGATED 등). 새 risk 발견 시 즉시 R-N 추가.

---

### 💰 `llm-cost/LLM-COST-RegTrack-2026-05-16.md` — **LLM 비용 통제**

**왜 필요한가**
LLM API는 호출할수록 돈이 든다. $100 예산 안에 12주를 끝내려면 호출 패턴·캐싱·임계 가드를 미리 설계해야 함. 무한 루프 버그 1번에 $50 날리는 사고 방지.

**언제 보나**
- LLMClient 구현 직전 (가격·임계 코드에 반영)
- 위젯 단계별 색상 구현 (AC-008)
- "이 호출 비용 얼마야?" 견적 필요할 때
- 모델 변경 검토 (Qwen → 다른)
- 비용 알림 받을 때 (YELLOW·ORANGE·RED)
- 월 1회 비용 점검 retro 안건

**어떻게 쓰나**
- §1 가격 기준 → 현재 모델 단가
- §2 호출 시나리오 6종 → 각 시나리오 비용 추정
- §3 12주 누적 시뮬레이션 → "예산 1.2%만 쓸 예정"
- §4 캐싱 전략 → 절감 비교 표
- §6 모델 선택 매트릭스 → 전환 후보
- §7 예산 가드 의사코드 → BR-2 구현 직접 참고
- §9 worst-case → 사고 대응

**변경 시점**: 모델·가격 변경 시. 정확도 benchmark 후 모델 전환 시.

---

### 🚀 `integration/PUSH-GUIDE-RegTrack-2026-05-16.md` — **PR 올릴 때 절차**

**왜 필요한가**
모든 작업자가 PR을 일관된 절차로 올려야 충돌·secret 노출·잘못된 force push를 막을 수 있음. 본인뿐 아니라 모든 작업자가 따라야 할 팀 표준.

**언제 보나**
- 새 작업 끝나고 PR 올리기 직전 (매번)
- "fork·collaborator 어느 쪽이지?" 모를 때
- 충돌·실수 발생 시 (rebase·revert·filter-repo)
- 신규 합류자 첫 PR 가이드

**어떻게 쓰나**
- §1 pre-push 5단계 → 모든 PR 전 필수 체크
- §3 push 명령어 → 단계별 복사
- §4 PR 본문 템플릿 → 첫 PR에 그대로 사용
- §6 충돌 대응 → 사고 시 cheat sheet

**변경 시점**: PR 절차 자체가 바뀔 때. 거의 변하지 않음.

---

### 📣 `integration/SHARE-CARD-2026-05-16.md` — **메신저 공유용 사전 안내**

**왜 필요한가**
"갑자기 PR 하나에 12개 commit이 올라왔는데 이게 다 뭐야?"를 막기 위해, push 직전에 팀원에게 카카오톡으로 알리는 짧은 텍스트. repo 안에 두는 이유는 → 다른 phase에서도 재사용 가능.

**언제 보나**
- 큰 PR 올리기 직전 (특히 분석/설계 단계 같은 일괄 다수 commit)
- M2·M3·M4·M5 단계 진입 시 (단계별 알림 카드 작성 참조)

**어떻게 쓰나**
- 박스 안 텍스트만 복사 → 카카오톡·슬랙 붙여넣기
- 버전 A: 짧은 알림 / B: 역할별 / C: 어드바이저용

**변경 시점**: 매 마일스톤 직전 (단계별 안내문 작성).

---

### 🌱 `.harness/ouroboros/seeds/seed-v{1..7}.yaml` — **immutable 명세**

**왜 필요한가**
요구사항이 계속 바뀐다. 하지만 어느 시점에 무엇을 결정했는지 추적이 안 되면 "그건 누가 그때 그렇게 정한 거야?"가 발생. seed는 한 번 만들면 못 바꿈. 바꾸려면 새 버전(v8)을 발급해야 함. 변경 이력이 changelog로 남음.

**언제 보나**
- "현재 결정 상태 알고 싶다" → **seed-v7만** 보면 됨 (최신만)
- "이 결정이 언제 왜 생겼지?" → v1~v6 changelog 추적
- 큰 변경 제안 시 → seed-vN 새 버전 발급 절차 (Scope Governance §17 large)
- 모든 후속 문서(PRD·TRD·ERD·API 등)의 출처 검증

**어떻게 쓰나**
- 보통은 **seed-v7만** 본다 (현재 ground truth)
- `acceptance_criteria` → AC-001~AC-012 권위 있는 정의
- `constraints.must / must_not` → 절대 규칙
- `ontology.entities` → 도메인 모델 (15개 entity)
- `tech_decisions D-1~D-12` → 모든 핵심 결정과 alternatives
- `process_governance §17` → 변경 거버넌스

**변경 시점**: 절대 수정 X. 새 버전 발급만.

---

### 📋 `.harness/ouroboros/tasks/decomposition-2026-05-16.yaml` — **73개 atomic task**

**왜 필요한가**
"FSS 크롤러 만들어"는 너무 크다. AI든 사람이든 한 번에 못 한다. 30분 이내 atomic 단위로 쪼개야 정확도 ↑, 실패 시 롤백 범위 ↓, 진행률 추적 ↑.

**언제 보나**
- 본인 다음 작업 할당 시 (PM과 협의)
- /run 실행 시 task 단위로
- 일정 추적 (어느 phase·어느 task 진행 중?)
- 마일스톤 게이트 도달 여부 점검

**어떻게 쓰나**
- `tasks.T-001~T-073` → 각 task의 description·test·depends_on·estimated_minutes
- `execution_order.phase 1~10` → 어느 주차에 어느 task 묶음
- `pair_mode_tasks 9개` → Navigator + Driver + Test Designer 강제
- 본인 task = "지금 무엇을 만들어야 하는가"의 단일 출처

**변경 시점**: 큰 task 분해·재할당 시 retro에서. 작은 변경은 commit 메시지.

---

### 🎤 `.harness/ouroboros/interviews/2026-05-16-10-12.yaml` — **출발점 인터뷰**

**왜 필요한가**
모든 결정의 출발점. "이지영 대리 페르소나는 왜 등장했어?", "Qwen 모델은 왜?" 같은 질문의 root cause. 정황 검토·archeology 용도.

**언제 보나**
- 어드바이저가 "이 프로젝트 시작 동기" 물을 때
- 결정의 의도가 모호할 때 (source 추적)
- 본 인터뷰 ambiguity score 0.08 → "이만큼 명확한 출발"

**어떻게 쓰나**
- 보통 거의 안 본다. seed-v7이 흡수했음.
- 단 결정의 "왜"가 궁금할 때 archive로 참조

**변경 시점**: 절대 X. 인터뷰는 1회성.

---

## 3. 한 줄 요약 표 (cheat sheet)

| 상황 | 봐야 할 문서 |
|------|------------|
| 처음 합류 | 본 문서 → PRD §1~§3 → TRD §1~§2 |
| 코드 짜기 직전 | TRD + ERD + API + decomposition.yaml |
| 시연 발표 준비 | Storyboard |
| 매주 retro | Risk Register |
| PR 올리기 직전 | PUSH-GUIDE + .github/pull_request_template.md |
| 비용 알림 받음 | LLM Cost |
| 어드바이저 질문 받음 | PRD + Risk Register + Architecture 다이어그램 캡처 |
| "이 결정 누가 언제 했지?" | seed-v{N} changelog |
| "다음 내 작업 뭐지?" | decomposition.yaml Phase X |
| 외부에 시스템 그림 보여주기 | Architecture §1 C4 모델 |
| LPC·deskrpg 라이선스 궁금 | seed-v8 (예정) + PRD non_goals |

---

## 4. "이거 다 우리 팀이 만든 거야?" — 출처

| 파일 | 출처 |
|------|------|
| PRD·TRD·ERD·API·Storyboard·Risk·LLM Cost·Push Guide·Share Card | **이번에 AI 협업으로 작성** (팀원1 + Claude) |
| seed-v1~v7·interviews·decomposition | 같음 (immutable spec 체계) |
| ARCHITECTURE_INVARIANTS·CLAUDE.md·.harness 게이트 | **하네스 템플릿** (재사용 표준) |
| .claude/agents·commands·hooks | 같음 |
| `nanobot/` 소스코드 | **팀원 기존 작업** (특히 팀장 obsidian skill) |
| docker-compose·Dockerfile | nanobot upstream + 팀원 커스텀 |

---

## 5. 자주 묻는 질문

**Q1. "PRD랑 TRD랑 비슷한데 둘 다 필요해?"**
→ PRD는 **What·Why** (어드바이저도 봄), TRD는 **How** (개발자만). 분리 이유: 어드바이저에게 코드 디테일 보여주면 핵심을 놓침.

**Q2. "seed가 7개나 있어. v7만 보면 안 봐도 돼?"**
→ 맞음. v7만 보세요. v1~v6는 변경 이력 archive.

**Q3. "73개 task 다 외워야 해?"**
→ 아뇨. 본인이 맡은 Phase의 task만. PM이 retro에서 배분.

**Q4. "Architecture 다이어그램이 TRD에도 있고 별도로도 있는데?"**
→ TRD는 글 중심, Architecture 문서는 다이어그램 중심. 회의·발표 시 시각 자료가 필요할 때 후자 사용.

**Q5. "Risk Register는 PM만 보면 되지?"**
→ 아뇨. 본인 영역 risk는 본인이 owner인 경우가 많음. 매주 retro에서 함께 점검.

**Q6. "이 문서들이 코드보다 더 많은데 너무 over-engineering 아닌가?"**
→ 일리 있음. 다만 (a) AI 협업 시 명확한 명세가 정확도 크게 ↑, (b) 4명 팀 12주에 일관성 유지 필수, (c) 시연 acceptance가 명확해야 합격. 시연 후 운영 단계에서는 일부 문서를 합치는 게 맞음 (Scope §17 large 변경).

**Q7. "LLM·OpenRouter·Qwen·Obsidian Local REST API 다 어디서 결정된 거야?"**
→ seed-v6·v7의 tech_decisions D-10·D-12. 변경 사유는 각 seed의 changelog.

---

## 6. 다음 단계

1. **본 문서 한 번 정독** (~5분)
2. **본인 역할에 해당하는 문서 1~2개 정독**
3. **궁금증은 retro 또는 카카오톡으로**
4. **PR 머지 후 M2 작업 분담 (PM 진행)**

---

## 7. References

- repo: https://github.com/jhkim43/reg-detection (`dev` 브랜치)
- 본 문서가 가리키는 모든 파일은 같은 `docs/` 또는 `.harness/ouroboros/` 안에 있음
- AI 협업 규칙: `CLAUDE.md` (이 repo의 모든 AI 작업이 따르는 헌장)
- 절대 변경 금지 규칙: `ARCHITECTURE_INVARIANTS.md`
- 카톡 공유: `docs/integration/SHARE-CARD-2026-05-16.md`
