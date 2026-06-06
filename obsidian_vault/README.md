# Obsidian Vault — 규제 추적 시스템

> 회사 내규 변화·외부 규제 자동 추적용 vault. 회사 내규 반출 불가로 **시중은행 4곳 공개 처리방침**으로 갈음 + **감독기관 발행 외규** 통합.
> **본 문서가 vault 단일 진입점**. 나노봇 개발자가 skill로 자동 파이프라인을 호출하는 가이드(§5–6)와 MOC 갱신 계약(§7)을 포함.

---

## 1. 폴더 구조 (현재 상태)

```
obsidian_vault/
├── README.md                       ← 이 파일 (vault 진입점)
│
├── _tools/                         ← 자동 파이프라인 (★)
│   └── reg_pipeline/                  Python 패키지
│       ├── daily_batch.py                CLI entry point
│       ├── crawler/                      발행처별 크롤러 (fsec/fsc/fss/pipc)
│       ├── converter/                    PDF/HWP/DOC → MD 변환
│       ├── classifier/                   임베딩 분류 + taxonomy
│       └── llm_judge/                    OpenRouter LLM 영향평가
│
├── external_raw/                   외규 원본 (크롤러 출력)
│   ├── fsec/                          금융보안원 (보도자료·가이드)
│   ├── fsc/                           금융위 (보도자료, 비조치 v2)
│   ├── fss/                           금감원 (보도자료, 행정지도 v2)
│   ├── pipc/                          개보위 (안내서·보도자료)
│   └── reference/                     사용자 직접 적재한 과거 코퍼스 (변환 제외)
│
├── external_raw_md/                외규 본문 마크다운 (변환기 출력)
│   └── {fsec|fsc|fss|pipc}/          PDF→MD (opendataloader-pdf)
│
├── external_wiki/                  외규 정제 wiki (LLM judge ≥ threshold 통과분)
│   └── {fsec|fsc|fss|pipc}/          frontmatter + 요약 + 영향분석
│
├── internal_raw/                   내규 원본 (시중은행 처리방침 PDF 4건)
├── internal_raw_md/                내규 본문 마크다운
└── internal_wiki/                  내규 wiki + MOC
    ├── _convert.py                    PDF → raw_md → wiki + MOC 생성
    ├── _MOC/                          영역별 인덱스 (6개)
    │   ├── MOC_수집동의.md
    │   ├── MOC_처리위탁.md
    │   ├── MOC_제3자제공.md
    │   ├── MOC_안전성조치.md
    │   ├── MOC_신용정보.md
    │   └── MOC_개인정보.md
    └── 개인정보/                       4 시중은행 wiki
```

### 명명 컨벤션

- **external_/internal_** 접두어로 외규/내규 분리
- **raw → raw_md → wiki** 3단계 (Option C 정책)
  - `raw/`: 원본 (인용 정확성, PDF 우선)
  - `raw_md/`: 본문 추출 (LLM·검색·임베딩 입력)
  - `wiki/`: 요약·메타·MOC 연결 (사람·Graph view)
- 폴더 안 `_` 접두어 파일/폴더는 도구·인덱스 (자동 변환 제외)

---

## 2. 갈음 정책 (회사 내규 ← 시중은행 처리방침)

회사 내규 반출 불가 → **시중은행 4곳 공개 처리방침**으로 갈음:

| 은행 | 유형 | 특징 |
|---|---|---|
| KB국민은행 | 4대 시중은행 | 표준 처리방침 모델 |
| 카카오뱅크 | 인터넷전문은행 | 디지털 first, 마이데이터 |
| 하나은행 | 4대 시중은행 | 그룹사 정보 공유, 글로벌 |
| 토스뱅크 | 인터넷전문은행 | 단순 UX, 최소 수집 |

→ 4건이 6개 sub_area 커버: 수집동의 / 처리위탁 / 제3자제공 / 안전성조치 / 신용정보 / 개인정보.

---

## 3. 데이터 흐름

```
[발행처 사이트] ─ Playwright ─→ external_raw/{source}/  (PDF/HWP/HWPX/DOC/DOCX)
                                       │
                opendataloader-pdf     │
              (LibreOffice via PDF)   ↓
                            external_raw_md/{source}/  (.md 본문)
                                       │
              ko-sroberta-multitask    │  (1) 분류
              + taxonomy.yaml         ↓
                          INTERNAL_SUB_AREAS 통과한 자료만 (2) 매칭
                                       │
                                       │  internal_wiki 임베딩 top-K
                                       ↓
                              [매칭 후보 ≤ 4개 내규]
                                       │
              OpenRouter gpt-5-mini    │  (3) LLM 영향평가
                                       │     impact_score 0~10
                                       ↓
                          impact_score ≥ min_score (default 4)
                              │                          │
                              ↓                          ↓
              external_wiki/{source}/.md      internal_wiki/{...}.md
              (frontmatter + 요약)            related_external 갱신
                              │                          │
                              └─────────────┬────────────┘
                                            ↓
                          internal_wiki/_MOC/MOC_*.md "## 외규" 섹션 갱신
                                            ↓
                              [deskrpg 알림 후크 — 나노봇 skill 영역]
```

---

## 4. 통합 wrapper (`daily_batch.py`) — 수동/cron 실행용

> 7개 stage를 한 번에 묶은 편의 entry. **나노봇 skill 개발자는 §5의 stage 단위 호출을 권장** —
> skill로 워크플로우를 쪼개야 LLM 판단 단계에서 나노봇 자기 모델을 끼울 수 있음.

### 4.1 1회 환경 셋업

**OS별 (macOS / Linux / Windows) 자세한 셋업은 [`_tools/SETUP.md`](_tools/SETUP.md) 참조.** 요약:

```bash
# (1) OS 의존성: Java 21 + LibreOffice — SETUP.md §1 OS별 명령
# (2) Python venv 활성화 + 의존성
source .venv/bin/activate
pip install -r obsidian_vault/_tools/requirements.txt
playwright install chromium
# (3) OpenRouter API key (LLM 사용 시)
echo "OPENROUTER_API_KEY=sk-or-v1-..." > regtrack/.env.integration
```

### 4.2 일배치 실행

```bash
source .venv/bin/activate
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"   # macOS만, Linux/Windows는 SETUP.md §3
cd obsidian_vault/_tools
python -m reg_pipeline.daily_batch --since 20260601
```

### 4.3 CLI 옵션

| 옵션 | 기본 | 설명 |
|---|---|---|
| `--since YYYYMMDD` | 1주일 전 | 수집 시작일 |
| `--sources fsec,fsc,fss,pipc` | 전체 4 | 발행처 선택 |
| `--crawl-only` | off | stage 1만 (테스트용) |
| `--no-classify` | off | stage 1–2까지만 (크롤+변환) |
| `--no-llm` | off | LLM 호출 skip (mock score=5) |
| `--min-score N` | 4 | external_wiki 진입 임계값 (0~10) |

### 4.4 7개 Stage

| Stage | 모듈 | 입력 → 출력 |
|---|---|---|
| 1. 크롤 | `crawler/sources/{source}.py` | 발행처 사이트 → `external_raw/{source}/` |
| 2. 변환 | `converter/to_md.py` | raw 파일 → `external_raw_md/{source}/*.md` |
| 3. 분류 | `classifier/embed.py::EmbeddingIndex.classify` | .md → sub_area 다중 라벨 (threshold 0.45) |
| 4. 매칭 | `classifier/embed.py::EmbeddingIndex.match_internal` | 분류 통과분 → 내규 top-K (cosine ≥ 0.30) |
| 5. LLM 판정 | `llm_judge/judge.py::LLMJudge.judge` | 매칭 후보 → impact_score + 요약·권고 |
| 6. wiki 생성 | `daily_batch.py::stage_6_build_wiki` | score ≥ min → `external_wiki/{source}/*.md` |
| 7. internal sync | `daily_batch.py::stage_7_sync_internal` | 매칭 내규의 `related_external` 갱신 |

### 4.5 중복 처리 정책

- 크롤러: `attach_path.exists()` → skip (덮어쓰지 않음)
- 변환기: `BatchConverter.run(skip_existing=True)` → 같은 stem .md 있으면 skip
- 같은 stem PDF + HWP 동시 첨부 → PDF 우선, HWP 무시 (`select_best_attachment_per_stem`)
- 크롤 history: `regtrack/.cache/crawl_history.json` (게시물 ID 키)

selector/코드 변경 반영하려면 raw 폴더 + history JSON 손으로 비워야 함.

---

## 5. 나노봇 Skill 통합 가이드 (★)

> **나노봇 skill = .md 워크플로우 문서**. LLM(나노봇 모델)이 그 .md를 읽고 단계별로 명령을 실행.
> 우리 `reg_pipeline`은 **그 skill 안에서 호출할 기계 작업 building block 모음**.
> 판단·요약·권고 같은 LLM 영역은 skill 안에서 나노봇이 자기 모델로 처리, 기계 영역만 우리 툴 호출.
>
> **📘 완성된 예제**: `_tools/skills/daily-regtrack-update/SKILL.md` — Claude Skills 표준 양식으로 작성한
> "매일 크롤 → 분류 → 판정 → vault·MOC 업데이트 → 알림" 전체 워크플로우. 본 가이드는 그 reference.

### 5.1 책임 분리 — 우리 툴 vs 나노봇 LLM

| 작업 | 종류 | 누가 | 어디서 |
|---|---|---|---|
| 발행처 사이트 크롤 (Playwright) | 기계 | 우리 | `python -m reg_pipeline.crawler.run_one X --since YYYYMMDD` |
| PDF/HWP/HWPX/DOC → MD 변환 | 기계 | 우리 | `BatchConverter.run()` |
| 외규 → sub_area 다중 라벨 분류 (임베딩) | 기계 | 우리 | `EmbeddingIndex.classify(text)` |
| 외규 → 내규 top-K 후보 검색 (cosine) | 기계 | 우리 | `EmbeddingIndex.match_internal(text)` |
| 영향도 판단·점수·요약·권고 | **LLM 위임** | 나노봇 (또는 우리 `LLMJudge` 사용) | skill 안에서 직접 / `LLMJudge.judge()` |
| 외규 wiki frontmatter + body 생성 | 기계 | 우리 | `stage_6_build_wiki(matched)` |
| 내규 `related_external` + MOC 갱신 | 기계 | 우리 / 나노봇 | `stage_7_sync_internal()` / §7 |

→ 나노봇은 자기 LLM으로 판단하고, 우리 툴로 데이터·매칭·파일 입출력만 처리.
→ 우리 `llm_judge`는 **편의 기본값** (OpenRouter gpt-5-mini). 나노봇이 자기 모델 쓰면 우회.

### 5.2 사용자가 만들고 싶은 skill 3종 — 우리 툴 매핑

#### skill A. `crawl-source.md` — 발행처 수집 + 변환

skill 본문에 들어갈 명령 블록:
```bash
# 사전: cd obsidian_vault/_tools  (모든 명령의 cwd)

# 1) 한 발행처 크롤 (PDF/HWP 받기)
python -m reg_pipeline.crawler.run_one \
    {fsec|fsc|fss|pipc} --since YYYYMMDD

# 2) raw → MD 변환
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
python -c "
import sys, json
sys.path.insert(0, 'obsidian_vault/_tools')
from pathlib import Path
from reg_pipeline.converter import BatchConverter
stats = BatchConverter(
    raw_root=Path('obsidian_vault/external_raw'),
    out_root=Path('obsidian_vault/external_raw_md'),
).run(skip_existing=True)
print(json.dumps(stats))
"
```
skill의 LLM은 stdout JSON을 받아서 "변환 N건 성공 / 실패 N건" 정도만 보고.

#### skill B. `assess-impact.md` — 외규-내규 연관 판단

skill 본문 흐름:
```
1. 우리 매칭 툴로 후보 받기 (기계)
2. 그 후보 + 외규 본문을 나노봇 자기 LLM에게 전달 (LLM 판정)
3. LLM 응답으로 impact_score 결정
4. 결과를 다음 skill (update-vault)에 넘김
```

후보 받는 부분 (skill 본문에 들어갈 한 줄 명령):
```bash
python -c "
import sys, json
sys.path.insert(0, 'obsidian_vault/_tools')
from pathlib import Path
from reg_pipeline.classifier import EmbeddingIndex, load_taxonomy

idx = EmbeddingIndex(
    taxonomy=load_taxonomy(),
    internal_dir=Path('obsidian_vault/internal_wiki/개인정보'),
    cache_path=Path('.cache/embeddings.pkl'),
)
text = Path('$EXTERNAL_MD').read_text()
sub_areas, _ = idx.classify(text, title='$TITLE', threshold=0.45)
top = idx.match_internal(text, k=3, min_score=0.30)
print(json.dumps({'sub_areas': sub_areas, 'matched_internals': top}, ensure_ascii=False))
"
```
→ skill의 LLM(나노봇)은 이 JSON 받고 \[외규 본문 + 매칭 내규 본문] 비교 후 자기 언어로 `impact_score`, `reason`, `primary_match`, `summary`, `update_recommendation` 결정.

선택: `reg_pipeline.llm_judge`를 그대로 쓰면 OpenRouter gpt-5-mini가 같은 일을 함 — skill에서 직접 LLM 호출 안 하고 위임하고 싶을 때:
```bash
python -c "
import sys, json
sys.path.insert(0, 'obsidian_vault/_tools')
from reg_pipeline.llm_judge import LLMJudge
j = LLMJudge(score_threshold=4)
ev = j.judge(external_title='$TITLE', external_text=open('$EXTERNAL_MD').read(),
             external_sub_areas=$SUB_AREAS, matched_internals=$TOP)
print(ev.to_json())
"
```

#### skill C. `update-vault.md` — wiki 생성 + MOC + 내규 sync

판정 결과(impact_score, summary 등)를 받아 vault에 쓰는 단계. 직접 호출 가능한 helper가 없으므로 skill에서 `stage_6_build_wiki` + `stage_7_sync_internal`을 import해서 호출, 또는 frontmatter 템플릿을 직접 write:

```bash
python -c "
import sys, json
sys.path.insert(0, 'obsidian_vault/_tools')
from pathlib import Path
from reg_pipeline.daily_batch import stage_6_build_wiki, stage_7_sync_internal

# matched = skill이 모은 [{'source', 'raw_md', 'sub_areas', 'matched_internal', 'evaluation', ...}, ...]
matched = json.load(open('$MATCHED_JSON'))
for item in matched:
    item['raw_md'] = Path(item['raw_md'])
created = stage_6_build_wiki(matched, min_score=4)
synced = stage_7_sync_internal(matched, min_score=4)
print(json.dumps({'created': created, 'synced': synced}))
"
```
MOC `## 외규` 섹션 갱신은 §7 계약대로 별도 모듈로 — 이 skill 안에 같이 두거나 `update-moc.md` 하위 skill로 분리.

### 5.3 우리 툴이 노출하는 인터페이스 (skill .md에 복붙용 reference)

#### Python import surface

```python
sys.path.insert(0, "obsidian_vault/_tools")

# 분류·매칭
from reg_pipeline.classifier import (
    EmbeddingIndex,        # 클래스 — 모델·캐시 관리
    load_taxonomy,         # taxonomy.yaml 로드
    INTERNAL_SUB_AREAS,    # 내규 영역 6개 frozenset
    classify_text,         # 키워드 기반 (legacy, fallback)
)

# 변환
from reg_pipeline.converter import BatchConverter, convert_to_md

# LLM 판정 (편의)
from reg_pipeline.llm_judge import LLMJudge

# Stage 직접
from reg_pipeline.daily_batch import (
    stage_1_crawl, stage_2_convert,
    stage_3_classify_filter, stage_4_match_corpus,
    stage_5_llm_judge, stage_6_build_wiki, stage_7_sync_internal,
)

# 크롤러 (개별 호출 가능)
from reg_pipeline.crawler.sources import fsec, fsc, fss, pipc, law_center
from reg_pipeline.crawler.base import CrawlHistory, setup_browser
```

#### CLI 한 줄

| 작업 | 명령 |
|---|---|
| 전체 (수동/cron) | `python -m reg_pipeline.daily_batch --since YYYYMMDD` |
| 크롤만 | `python -m reg_pipeline.daily_batch --crawl-only --sources X` |
| 크롤+변환 | `python -m reg_pipeline.daily_batch --no-classify --sources X` |
| 한 발행처 | `python -m reg_pipeline.crawler.run_one X --since YYYYMMDD` (X ∈ fsec/fsc/fss/pipc) |
| LLM 비용 없이 끝까지 | `python -m reg_pipeline.daily_batch --no-llm` |

### 5.4 판단 기준 — 3단 게이트

`reg_pipeline`은 외규 → 내규 영향을 다음 3단으로 판정:

**게이트 1 — 분류 게이트** (`classifier/embed.py::EmbeddingIndex.classify`)
- 입력: 외규 본문 (raw_md)
- 비교 대상: `taxonomy.yaml`의 10개 sub_area description (자연어 설명)
- 임베딩 모델: `jhgan/ko-sroberta-multitask` (한국어 sentence embedding)
- 통과 조건: 코사인 유사도 ≥ **0.45** (다중 라벨)
- 추가 필터: `INTERNAL_SUB_AREAS = {수집동의, 처리위탁, 제3자제공, 안전성조치, 신용정보, 개인정보}` — 내규에 실제로 존재하는 6개만 통과

**게이트 2 — 매칭 게이트** (`classifier/embed.py::match_internal`)
- 입력: 게이트 1 통과 외규
- 비교 대상: `internal_wiki/개인정보/*.md` 본문 임베딩
- 통과 조건: 코사인 유사도 ≥ **0.30**, 상위 **K=3**개 내규
- 출력: `[(내규 파일명, 점수), ...]`

**게이트 3 — 판정 게이트** (`llm_judge/judge.py` **또는** 나노봇 skill 내 LLM)
- 입력: 외규 본문 + 게이트 2의 매칭 후보
- 모델: 편의 기본은 OpenRouter `openai/gpt-5-mini` (`llm_judge/client.py`), 나노봇이 자기 모델로 대체 가능
- 1차 (`SYS_JUDGE_AND_SCORE`): `has_impact`, `impact_score` (0~10), `reason`, `primary_match`, `affected_articles`
- 2차 (`SYS_SUMMARIZE_AND_RECOMMEND`): impact_score ≥ threshold일 때만 (비용 절감)
- 통과 조건: `impact_score >= min_score` (CLI 기본 4)
- 출력: `external_wiki/{source}/*.md` + `internal_wiki/{...}.md`의 `related_external` 갱신

### 5.5 임계값 튜닝 포인트

| 무엇 | 어디 | 기본값 | 영향 |
|---|---|---|---|
| sub_area 분류 임계값 | `EmbeddingIndex.classify(threshold=)` | 0.45 | 낮추면 false positive ↑ |
| 내규 매칭 min_score | `EmbeddingIndex.match_internal(min_score=)` | 0.30 | 낮추면 후보 ↑ (LLM 비용 ↑) |
| 매칭 top-K | `match_internal(k=)` | 3 | LLM이 한 번에 비교할 내규 수 |
| 판정 threshold | `LLMJudge(score_threshold=)` 또는 CLI `--min-score` | 4 | wiki 진입 + internal sync 트리거 |
| sub_area 정의 자체 | `classifier/taxonomy.yaml` | 10개 | description 수정 → 캐시 무효화 → 재임베딩 |

캐시 (`regtrack/.cache/embeddings.pkl`)는 taxonomy + 내규 본문 해시가 같으면 재사용. taxonomy.yaml 수정 시 자동 재계산.

### 5.6 결과 위치 (나노봇 알림 후크 참조)

| 산출물 | 경로 | frontmatter 핵심 필드 |
|---|---|---|
| 신규 외규 wiki | `external_wiki/{source}/{date}_{title}.md` | `impact_score`, `primary_match`, `affected_articles`, `sub_area` |
| 영향받은 내규 | `internal_wiki/개인정보/{bank}_개인정보처리방침.md` | `related_external: [...]`, `status: needs-review` |
| MOC 인덱스 | `internal_wiki/_MOC/MOC_{sub_area}.md` | `## 외규 (자동 갱신)` 섹션 wikilink append (§7) |

### 5.7 권장 skill 호출 토폴로지

```
[cron / 사용자 트리거]
       ↓
crawl-source.md   ← 발행처별 1회씩 (병렬 가능)
       ↓
[새 .md 1건당 반복]
       ↓
assess-impact.md  ← 우리 매칭 툴 → 나노봇 LLM 판정
       ↓ (impact_score ≥ 4)
update-vault.md   ← 우리 wiki/sync 툴 + §7 MOC 갱신
       ↓
[deskrpg 알림] ← 나노봇 자체 인터페이스
```

---

## 6. 외규 wiki / 내규 wiki frontmatter 스키마

자동 파이프라인이 생성/수정하는 필드:

### external_wiki/{source}/*.md (자동 생성)

```yaml
---
title: "외규 제목"
source_institution: "fsec | fsc | fss | pipc"
document_type: "외규"
tags: [외규, 출처/X, status/active, 영역/X, ...]
status: "active"
type: "외규"
sub_area: [수집동의, 처리위탁, ...]   # 게이트 1 통과 라벨
impact_score: 7                        # 게이트 3 (0~10)
has_impact: true
primary_match: "토스뱅크_개인정보처리방침"   # 게이트 3 1차 응답
affected_articles: ["제5조", ...]      # LLM 추정 조항
related_internal: ["토스뱅크_..."]
source_md: "external_raw_md/{source}/...md"
---

# 개요 / # 요약 / # 내규 업데이트 권고 / # 마감 힌트 / # 출처
```

### internal_wiki/개인정보/{bank}.md (자동 갱신)

자동 파이프라인이 수정하는 부분만:
```yaml
related_external: ["{외규제목1}", ...]   # 매칭된 외규 누적
status: "needs-review"                    # active → needs-review 자동 전이 (TODO)
```

본문 끝 `# 관련 외규 (자동 갱신)` 섹션에 `- [[외규파일명]] ✨ NEW` append.

---

## 7. MOC 자동 갱신 계약 (다른 팀원 개발 대상)

> **현재 `reg_pipeline`은 stage 7 (internal sync)까지 구현**. MOC `## 외규` 섹션 갱신은 별도 모듈로 분리 — 나노봇 skill 또는 deskrpg 측에서 구현 권장.

### 7.1 MOC = Map of Content

특정 sub_area에 속한 모든 노드를 모아두는 Obsidian 패턴.
- Graph view hub 역할
- 사용자가 "수집동의 자료 다 보기" → `MOC_수집동의.md` 한 번 열면 됨
- 자동화의 진입점

현재 6개 MOC (sub_area 1:1 대응):
```
internal_wiki/_MOC/
├── MOC_수집동의.md / MOC_처리위탁.md / MOC_제3자제공.md
└── MOC_안전성조치.md / MOC_신용정보.md / MOC_개인정보.md
```

### 7.2 MOC 파일 스키마 (계약)

```yaml
---
type: MOC                       # 고정값 (자동화 식별자)
sub_area: 수집동의               # 영역명 (파일명과 일치)
date: 2026-06-06                # 최종 갱신일
tags: [MOC, 영역인덱스]
---
```

Body 3섹션 고정 (헤더 텍스트 변경 금지 — 자동화가 텍스트로 섹션 위치 찾음):

```markdown
# 영역: {sub_area}

## 사내규정 (내규 갈음)
- [[내규파일1]]
- [[내규파일2]]

## 외규 (자동 갱신)
> 본 영역과 매칭된 외규가 여기에 누적됨.
- [[외규파일1]]  ← 자동 추가
- (아직 없음)    ← placeholder (첫 외규 추가 시 제거)

## 영향도 분석 (자동 갱신)
- (아직 없음)
```

### 7.3 갱신 알고리즘 (구현 권장 패턴)

```python
def on_external_wiki_created(external_md_path: Path):
    """external_wiki/* 신규 .md 생성 직후 호출 (post-stage-6 hook)."""
    external = parse_frontmatter(external_md_path)
    sub_areas = external["sub_area"]  # 예: ["수집동의", "처리위탁"]
    external_link = f"[[{external_md_path.stem}]]"

    for sub_area in sub_areas:
        moc_path = MOC_DIR / f"MOC_{sub_area}.md"
        if not moc_path.exists():
            continue
        append_under_section(
            moc_path,
            section_header="## 외규 (자동 갱신)",
            content=f"- {external_link}",
            placeholder_to_remove="- (아직 없음)",
        )
        update_frontmatter_date(moc_path, today())
```

### 7.4 헬퍼 함수 시그니처

```python
def parse_frontmatter(md_path: Path) -> dict: ...
def append_under_section(md_path, section_header, content, placeholder_to_remove=None): ...
def update_frontmatter_date(md_path, date_str): ...
def find_wiki_by_name(wikilink: str) -> dict: ...
```

### 7.5 동시 갱신·중복 처리

- 같은 sub_area에 외규 동시 도착 → `fcntl.flock` 또는 단일 워커 큐
- 같은 외규 재호출 → 본문에 이미 같은 wikilink 있으면 skip (set 기반 dedupe)
- placeholder `- (아직 없음)` → 첫 진짜 항목 추가 시 제거

### 7.6 권장 구현 위치

```
nanobot/agent/tools/moc_updater.py     # skill로 노출
또는
deskrpg/src/lib/moc-updater.ts          # post-vault-write hook
```

호출 시점:
- `daily_batch.py` stage 6 완료 직후 (`external_wiki/{source}/*.md` 추가 시점)
- LLM 영향분석 별도 생성 시 (`internal_wiki/영향도분석/*.md` 추가 시점)

---

## 8. 테스트·튜닝

### 8.1 dry-run (LLM 비용 없이 끝까지)

```bash
python -m reg_pipeline.daily_batch \
    --since 20260601 --no-llm
```
LLM judge가 mock으로 `impact_score=5` 반환 → wiki 생성·sync 끝까지 흐름만 검증.

### 8.2 한 발행처·하나만

```bash
python -m reg_pipeline.daily_batch \
    --since 20260601 --sources pipc --min-score 0
```

### 8.3 변환 단계만 (selector 디버깅)

```bash
python -m reg_pipeline.daily_batch \
    --since 20260601 --no-classify
```

### 8.4 신규 발행처 추가

1. `crawler/sources/{newone}.py` — `crawl(out_dir, since_date, history, page)` 함수 구현
2. `crawler/sources/__init__.py` 에 import
3. `daily_batch.py::SOURCES` 리스트에 추가
4. 첫 실행: `--sources newone --since 20200101` (백필)

### 8.5 알려진 제약

| 항목 | 현재 상태 |
|---|---|
| HWPX 파일 | LibreOffice 26.x 미지원 → zipfile fallback (`> ⚠️ HWPX fallback 변환` 헤더 명시, 헤딩·표 손실) |
| HWP (구 binary) | LibreOffice → PDF 변환 가능 |
| DOC / DOCX | LibreOffice → PDF 변환 가능 |
| FSC 비조치의견서 | JS 동적 로드 — v2 deferred |
| FSS 행정지도·감독행정 | URL 미검증 — v2 deferred |
| law_center (국가법령) | OpenAPI 신청 필요 — v2 deferred |
| MOC `## 외규` 자동 갱신 | reg_pipeline 미구현, §7 가이드대로 별도 모듈 |

---

## 9. 사이클 로드맵

| 사이클 | 작업 | 산출물 |
|---|---|---|
| v12 | 내규 vault 셋업 + 컨벤션 | (legacy) |
| v12.1 | 시중은행 갈음 + 외규 분류 prototype | 4 은행 + 폴더 재구성 |
| **v13 (현재)** | reg_pipeline 완성 (크롤·변환·분류·LLM·wiki) | `_tools/reg_pipeline/` 7-stage 파이프라인 |
| v14 | MOC 자동 갱신 + 영향도 분석 wiki | `_MOC/MOC_*.md` 외규 섹션 채워짐 |
| v15 | 가짜 내규 합성 (LLM) | `synthetic_internal/` |
| v16 | 사용자 알림 + 대시보드 (deskrpg) | 나노봇 skill → push |
| v17+ | 발행처 확장 (국회·관보·BIS·KISA) + 뉴스·웹검색 | 통합 모니터링 |

---

## 10. 새 팀원 진입 체크리스트

| 목적 | 어디로 |
|---|---|
| 자동 파이프라인 한 번 돌려보기 | §4.1 → §4.2 |
| 나노봇 skill 작성 | §5 |
| 영역별 자료 묶음 보기 (Obsidian) | `internal_wiki/_MOC/MOC_*.md` |
| 외규 raw | `external_raw/{fsec\|fsc\|fss\|pipc}/` |
| 외규 변환본 | `external_raw_md/{...}/` |
| 외규 wiki (LLM 통과분) | `external_wiki/{...}/` |
| 신규 발행처 추가 | §8.4 |
| 분류·매칭 임계값 변경 | §5.5 |
| MOC 갱신 모듈 구현 | §7 (계약 문서) |
