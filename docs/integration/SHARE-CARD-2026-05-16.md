# 카카오톡 공유 카드 — RegTrack 분석/설계 PR 사전 안내

> 팀원에게 push 전 카카오톡·슬랙 등 메신저로 공유할 짧은 안내 텍스트.
> **아래 ─── 박스 안의 내용만 복사해서 메신저에 붙여넣으세요.**

---

## 버전 A — 가장 짧은 버전 (~600자, 카톡 1메시지)

```
─────────────────────────────────────────
📚 RegTrack 분석/설계 문서 PR 예정 안내

이번 주 진행한 분석/설계 결과물을 dev 브랜치에 PR 올릴 예정이에요.

🆕 추가되는 것 (코드 변경 X, 문서만):
- docs/ 안에 9개 설계 문서 (PRD, TRD, ERD, API, 시나리오, Risk, LLM비용, 통합가이드)
- .harness/ouroboros/ 안에 spec 파일 (seed v1~v7, 인터뷰, 73개 atomic task)
- .github/pull_request_template.md (PR 양식)

📖 가장 먼저 봐야 할 것:
→ docs/README.md (전체 안내 + 역할별 추천 순서)

⏰ PR 올라가면 코멘트 부탁드려요. M1 마일스톤 통과 (2026-05-25) 전까지!

질문은 본 채팅으로 ✌️
─────────────────────────────────────────
```

---

## 버전 B — 역할별 안내 추가 (~1200자, 카톡 1-2메시지)

```
─────────────────────────────────────────
📚 RegTrack 분석/설계 문서 PR 예정 안내

이번 주 작업한 분석·설계 문서 일괄을 dev 브랜치에 PR 올립니다.
12주 일정의 M1 (W1-W2) 단계 결과물이에요.

📦 PR 내용 (코드 변경 X, 문서/spec만):

1) docs/ — 9개 문서
   ・PRD (제품 요구사항, 무엇·왜)
   ・TRD (기술 설계, 3-tier)
   ・Architecture (Mermaid C4 + 시퀀스)
   ・ERD (SQLite 18 테이블 + Obsidian 스키마)
   ・API spec (REST + WS + OpenRouter)
   ・Storyboard (시연 5분30초 풀 스크립트)
   ・Risk Register (17 risk + 12주 갠트)
   ・LLM Cost (Qwen 가격 모델, 예상 ~$1.20)
   ・Push Guide (이 PR 절차)

2) .harness/ouroboros/ — immutable spec
   ・seed v1~v7 (v7이 최신)
   ・interviews/ (인터뷰 결과)
   ・tasks/decomposition (73 atomic task)

3) .github/pull_request_template.md
4) .gitignore 갱신 (vault/, .env.local, 차터 제외)

🎯 역할별 추천 읽기 순서:

📌 김지효 PM
→ PRD §3 Goals + §17 Scope Governance
→ Risk Register §2 High risks
→ seed-v7

📌 백정헌 (QA/기획)
→ PRD §8 AC 12개
→ Storyboard (시연 풀스크립트)
→ decomposition.yaml test 필드

📌 조민희 (개발)
→ TRD + ERD + API spec
→ decomposition Phase 1 (W3) tasks

📌 이득규 (본인)
→ 이미 다 봤죠 ㅎㅎ

⏰ PR 머지는 다음 retro에서 결정해요.
M1 게이트(2026-05-25) 전까지 코멘트 부탁!

📍 가장 먼저 열어볼 파일:
→ docs/README.md (모든 문서 카탈로그·역할별 안내)
─────────────────────────────────────────
```

---

## 버전 C — 어드바이저용 (이메일 또는 정중한 메신저)

```
─────────────────────────────────────────
[RegTrack] 분석·설계 문서 검토 요청드립니다

안녕하세요 교수님,

AIMBA ABP 4팀 RegTrack의 M1 단계(W1-W2) 분석·설계 결과물이 정리되어
GitHub에 PR 형태로 올라갈 예정입니다.

▶ Repo: https://github.com/jhkim43/reg-detection (dev 브랜치)
▶ PR (예정): feat/spec-and-design → dev

산출물 요약:
• Product Requirements (PRD v4) — 페르소나·AC 12개·시연 시나리오
• Technical Reference (TRD v2) — 3-tier 아키텍처·핵심 결정 9개
• Architecture Diagrams — C4 모델 + 7개 시퀀스
• ERD/Schema — SQLite 18 테이블 + Obsidian frontmatter
• API spec — REST·WebSocket·Obsidian REST·OpenRouter+Qwen
• Storyboard — 시연 5분30초 풀 스크립트
• Risk Register — 17 risk + 12주 마일스톤 갠트
• LLM Cost Model — Qwen3.6-35b-a3b 가격·예상 $1.20
• Immutable Spec (seed v1~v7) — 결정 진화 추적
• 73 Atomic Tasks — 구현 분해

특히 검토 부탁드리고 싶은 부분:
1. PRD §9 시연 시나리오 (메인 4단계 + 회의실 보너스)
2. Risk Register §2 — Critical(R-1) 및 High(R-5·R-9·R-11) risk 대응
3. Scope Governance §17 — 12주 동안 변경 관리 정책

추가 회의가 필요한 안건:
• R-11 시연 환경 결정 (Windows VM vs Mac 단일)
• AI 미팅룸 repurpose의 임팩트 평가

회의 일정 잡으실 수 있는 시간 알려주시면 감사하겠습니다.

이득규 드림
─────────────────────────────────────────
```

---

## 사용 시점

| 시점 | 어느 버전 | 채널 |
|------|-----------|------|
| push **직전** | 버전 A 또는 B | 팀 카카오톡·슬랙 |
| 어드바이저 검토 요청 | 버전 C | 이메일 또는 정중한 메신저 |
| PR 머지 **후** | 별도 — "M2 시작합니다" 알림 | 팀 카카오톡 |

---

## 카카오톡 호환성 노트

- 카톡은 markdown 일부만 렌더링 (`*`강조`*`만 부분 동작, 표·체크박스 안 됨)
- **이모지는 잘 보임** (🆕 📖 ⏰ ✌️ 등)
- 코드블록 ``` 안 됨 → 들여쓰기로 대체
- 줄바꿈은 두 번 (\n\n)
- 한 메시지 최대 1000자 이내가 안전 (잘림 방지)
- 위 버전 A는 한 메시지에, 버전 B는 두 메시지로 나눠 보내는 것 권장
