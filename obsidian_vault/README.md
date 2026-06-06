# Obsidian Vault — 규제 추적 시스템

> 회사 내규 변화·외부 규제 자동 추적을 위한 vault.
> 회사 내규 반출 불가로 **시중은행 4곳 공개 처리방침**으로 갈음 + **감독기관 발행 외규** 통합.

---

## 1. 폴더 구조

```
obsidian_vault/
├── README.md                       ← 이 파일
│
├── external_raw/                   외규 원본 (팀원 영역, 발행처별 분리)
│   ├── fsec/                          금융보안원 (110건, 보도자료 .md)
│   ├── fss/                           금감원 (254건, 행정지도·감독행정)
│   ├── law_center/                    국가법령정보센터 (30 JSON, 법령·고시)
│   └── pipc/                          개인정보보호위원회 (87건, 가이드·안내서)
│
├── external_wiki/                  외규 정제 wiki (팀원 분류 + 우리 도구)
│   ├── 01_법령_규제/                  팀원 분류 (법·시행령·고시)
│   ├── 02_행정지도_감독/              팀원 분류 (감독행정)
│   ├── 03_가이드라인_안내서/          팀원 분류 (가이드라인)
│   ├── 04_동향_보도자료/              팀원 분류 (보도자료)
│   └── _tools/                        ← (우리) 자동 분류 도구
│       ├── taxonomy.yaml                 영역 키워드 사전
│       ├── classify_external.py          분류 prototype
│       └── build_external_wiki.py        v13 스켈레톤
│
├── internal_raw/                   내규 원본 (시중은행 처리방침 4건)
│   ├── SOURCES.md                     출처·URL 정리
│   ├── _download.py                   Playwright 자동 다운로드
│   ├── KB은행_개인정보처리방침_*.pdf
│   ├── 카카오뱅크_개인정보처리방침_*.pdf
│   ├── 하나은행_개인정보처리방침_*.pdf
│   └── 토스뱅크_개인정보처리방침_*.pdf
│
├── internal_raw_md/                내규 본문 마크다운 (4건, opendataloader)
│   └── (4개 은행 처리방침)
│
└── internal_wiki/                  내규 요약·MOC (4 wiki + 6 MOC)
    ├── _convert.py                    PDF→raw_md→wiki 변환 + SUMMARIES
    ├── _MOC/                          영역 인덱스
    │   ├── README.md                     MOC 자동 갱신 개발 계약
    │   ├── MOC_수집동의.md
    │   ├── MOC_처리위탁.md
    │   ├── MOC_제3자제공.md
    │   ├── MOC_안전성조치.md
    │   ├── MOC_신용정보.md
    │   └── MOC_개인정보.md
    └── 개인정보/                       4 시중은행 wiki
```

### 폴더 명명 컨벤션

- **external_/internal_** 접두어로 외규/내규 명확 분리
- **raw → raw_md → wiki** 3단계 (Option C 정책)
  - `raw/`: 원본 (인용·정확성)
  - `raw_md/`: 본문 추출 (LLM·검색·임베딩)
  - `wiki/`: 요약·메타·MOC 연결 (사람·Graph)

---

## 2. 갈음 정책 (회사 내규 ← 시중은행 처리방침)

실제 회사 내규 반출 불가로 **시중은행 4곳 공개 처리방침**으로 갈음:

| 은행 | 유형 | 특징 |
|---|---|---|
| **KB국민은행** | 4대 시중은행 | 표준 처리방침 모델 |
| **카카오뱅크** | 인터넷전문은행 | 디지털 first, 마이데이터 활용 |
| **하나은행** | 4대 시중은행 | 그룹사 정보 공유, 글로벌 |
| **토스뱅크** | 인터넷전문은행 | 단순 UX, 최소 수집 |

→ 4건이 모두 6개 sub_area 커버 (수집동의·처리위탁·제3자제공·안전성조치·신용정보·개인정보).

미수집: 신한은행 (URL 표준 못 찾음, v13에서 보강).

---

## 3. 데이터 흐름 (v13+ 비전)

```
[external_raw] (팀원 크롤링)
    ↓
[추출] PDF/HWP → 본문 마크다운 (opendataloader, hwp2md)
    ↓
[분류] sub_area 매칭 (키워드 → 임베딩)
    ↓
[필터] 우리 internal에 영향 있는 자료만 (임계값 통과)
    ↓
[external_wiki] 진입 + 요약·meta 작성
    ↓
[MOC 갱신] internal_wiki/_MOC/MOC_*.md "## 외규" 섹션
    ↓
[internal sync] 매칭 internal wiki의 related_external 갱신, status: needs-review
    ↓
[알림] deskrpg 사용자 푸시
```

→ 현재 단계: **internal 셋업 완료, external 분류 v13 진행 예정**.

---

## 4. external_raw 영향 분석 (현재 상태)

총 481건 중 **약 120건이 우리 internal에 영향 가능성** (~25%):

| 발행처 | 전체 | 영향 추정 | 비율 | 비고 |
|---|---|---|---|---|
| law_center | 30 | ~25 | 83% | 법령 본문, 거의 모두 직접 근거 |
| pipc | 87 | ~50 | 57% | 처리방침 작성·운영 가이드 다수 |
| fss | 254 | ~30 | 12% | 대부분 IT 무관 행정지도 |
| fsec | 110 | ~15 | 14% | 대부분 보도자료·이벤트 |
| **합계** | **481** | **~120** | **25%** | |

### 6 sub_area별 매핑

| sub_area | 영향 큰 외규 (raw 폴더) |
|---|---|
| 수집동의 | law_center/개인정보보호법, pipc/수집최소화가이드, pipc/처리방침작성지침 |
| 처리위탁 | pipc/처리위탁안내서, law_center/신용정보업감독규정, fss/위탁 관련 |
| 제3자제공 | law_center/개인정보보호법, pipc/제3자제공 가이드 |
| 안전성조치 | law_center/안전성확보조치기준, pipc/암호화안내서, pipc/보호조치안내서, fsec/ISMS-P |
| 신용정보 | law_center/신용정보업감독규정, law_center/신용정보법, fss/신용정보 |
| 개인정보 | law_center/개인정보보호법, pipc/처리방침작성지침, pipc/영향평가안내서 |

→ **영향 자료 충분히 많음**. v13에서 본격 분류 + wiki 진입 + MOC 갱신.

---

## 5. 자동화 스크립트 실행법

```bash
# 1회 환경 셋업
python3 -m venv /tmp/playwright-venv
/tmp/playwright-venv/bin/pip install playwright pypdf opendataloader-pdf pyyaml
/tmp/playwright-venv/bin/playwright install chromium
brew install openjdk@21

# 내규 다운로드 (4 시중은행)
/tmp/playwright-venv/bin/python obsidian_vault/internal_raw/_download.py

# 내규 변환 (raw → raw_md → wiki + MOC)
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
/tmp/playwright-venv/bin/python obsidian_vault/internal_wiki/_convert.py
```

> 외규 분류·매칭은 v13 작업 (현재 스켈레톤만).

---

## 6. 사이클 로드맵

| 사이클 | 작업 | 산출물 |
|---|---|---|
| **v12 (완료)** | 내규 vault 셋업 + 컨벤션 | 외규 inflation으로 잘못된 구조 |
| **v12.1 (현재)** | 내규 시중은행 갈음 + 폴더 재구성 + 외규 분류 prototype | 4 은행 + external/internal 분리 |
| **v13** | 외규 분류 본격 + wiki 생성 + MOC 갱신 + internal sync | external_wiki 자동 생성 |
| **v14** | 영향도 분석 (LLM) + 변경 권고 | 영향분석 wiki |
| **v15** | 가짜 내규 합성 (LLM) — 외규+실사례 → 회사 가상 내규 | synthetic_internal/ |
| **v16** | 사용자 알림 + 대시보드 (deskrpg) | UI |
| **v17+** | 발행처 확장 (국회·관보·BIS·신용정보원·KISA), 뉴스·웹검색 | 통합 모니터링 |

---

## 7. 새 팀원이 알아야 할 핵심

### 자료 보기

| 목적 | 어디로 |
|---|---|
| 시중은행 처리방침 갈음 자료 찾기 | `internal_raw/SOURCES.md` |
| 영역별 자료 묶음 보기 | `internal_wiki/_MOC/MOC_*.md` |
| 외규 종류별 보기 | `external_wiki/01~04/` (팀원 분류) |
| 외규 raw | `external_raw/{fsec\|fss\|law_center\|pipc}/` |

### 자료 추가·갱신

| 작업 | 방법 |
|---|---|
| 신규 시중은행 추가 | `internal_raw/_download.py`에 URL 추가 + 실행 |
| 내규 wiki 재생성 | `internal_wiki/_convert.py` 실행 |
| 외규 신규 분류 (v13) | `external_wiki/_tools/build_external_wiki.py` 구현 후 실행 |

---

## 8. 작성 형식 (frontmatter)

내규·외규 모두 동일 컨벤션:

```yaml
---
title: "..."
date: YYYY-MM-DD
source_institution: "발행기관"
document_type: "처리방침 | 법령 | 고시 | 가이드 | 보도자료"
tags:
  - 출처/X
  - 영역/X        ← slash hierarchy
  - status/active
status: "active | needs-review | archived"
type: "내규갈음 | 외규"
sub_area: [수집동의, 처리위탁, ...]
source_doc: "원본 파일명"
source_url: "원본 URL"
related_external: []   # 내규: 매칭 외규 자동 갱신
related_internal: []   # 외규: 매칭 내규 자동 갱신
---
```
