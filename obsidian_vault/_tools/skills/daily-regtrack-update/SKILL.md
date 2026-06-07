---
name: daily-regtrack-update
description: Use this skill when the daily regulatory tracking trigger fires (cron at 09:00 KST) or when the user explicitly asks to "run daily reg update / 오늘 외규 가져와줘". It crawls 4 Korean financial regulators, classifies new external regulations against the internal policy vault, judges impact, and updates the Obsidian vault. Skip if last run completed within 6 hours and the user did not pass `force: true`.
---

# Daily RegTrack Update

> 이 skill은 매일 외규 변화 모니터링의 단일 진입점이다. 우리 도구(`reg_pipeline`)가 **기계 작업**을 처리하고, 너(LLM)는 **판단·요약·권고**를 담당한다.
> 모든 명령의 `cwd`는 `/path/to/regtrack/obsidian_vault/_tools` 로 가정한다.

---

## 입력 파라미터

| 이름 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `since_date` | YYYYMMDD | 7일 전 | 이날 이후 게시된 외규만 수집 |
| `sources` | str list | `["fsec","fsc","fss","pipc"]` | 발행처 선택 |
| `min_impact_score` | int 0~10 | 4 | wiki 진입 + MOC 갱신 임계값 |
| `force` | bool | false | 마지막 실행이 6시간 내여도 강제 실행 |

---

## Workflow

### Step 1 — 환경 준비 (1회만)

OS별 의존성 설치 + venv + Python 의존성은 [`obsidian_vault/_tools/SETUP.md`](../../../_tools/SETUP.md) 참조 (macOS/Linux/Windows 모두 커버).

이 skill이 호출되는 시점에는 venv가 활성화되어 있다고 가정. 매 호출마다 다음만 확인:

```bash
# 의존성 sanity check (없으면 SETUP.md 안내로 분기)
python -c "import playwright, sentence_transformers, opendataloader_pdf" 2>/dev/null \
  || (echo "의존성 누락. SETUP.md §2 따라 'pip install -r _tools/requirements.txt' 실행 필요"; exit 1)

# Java 21 PATH (macOS Homebrew 기준 — Linux/Windows는 보통 자동)
command -v java >/dev/null || export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
```

OPENROUTER_API_KEY는 `regtrack/.env.integration` 에서 자동 로드되므로 별도 설정 불필요.

### Step 2 — 크롤링 (기계 작업, 발행처별 병렬 가능)

각 발행처를 한 번에 호출:

```bash
for src in fsec fsc fss pipc; do
  python -m reg_pipeline.crawler.run_one $src --since {since_date}
done
```

→ 결과는 `obsidian_vault/external_raw/{source}/` 에 PDF/HWP/HWPX/DOC 파일로 저장.
→ 같은 게시물의 같은 파일이면 자동 skip (history 캐시 + exists 체크).
→ stdout 마지막 "📊 결과: N건" 라인을 파싱해서 발행처별 신규 건수 집계.

**오류 처리**: 한 발행처가 실패해도 다른 발행처는 계속. 실패 발행처는 다음 step에서 0건으로 처리.

### Step 3 — 변환 (raw → MD, 기계 작업)

```bash
python -c "
import sys, json
sys.path.insert(0, '.')
from pathlib import Path
from reg_pipeline.converter import BatchConverter
stats = BatchConverter(
    raw_root=Path('../external_raw'),
    out_root=Path('../external_raw_md'),
).run(skip_existing=True)
print(json.dumps(stats))
"
```

→ `external_raw_md/{source}/*.md` 생성.
→ PDF는 opendataloader-pdf로 고품질 변환. HWPX는 LibreOffice 미지원이라 zipfile fallback (첫 줄에 `> ⚠️ HWPX fallback 변환` 경고). 이 경고가 보이는 .md는 Step 4 분류 점수를 신뢰도 0.8 가중치로 낮춰 처리.

### Step 4 — 분류 + 매칭 (기계 작업, 우리 임베딩 툴)

신규 .md 각각에 대해 sub_area 분류 + 내규 top-3 후보 검색:

```bash
python -c "
import sys, json
sys.path.insert(0, '.')
from pathlib import Path
from reg_pipeline.classifier import EmbeddingIndex, load_taxonomy, INTERNAL_SUB_AREAS

idx = EmbeddingIndex(
    taxonomy=load_taxonomy(),
    internal_dir=Path('../../internal_wiki/개인정보'),
    cache_path=Path('../../../.cache/embeddings.pkl'),
)

results = []
for md in Path('../external_raw_md').rglob('*.md'):
    if md.parent.name == 'reference':
        continue
    text = md.read_text()
    sub_areas, _ = idx.classify(text, title=md.stem, threshold=0.45)
    # INTERNAL 필터 (내규에 실제로 있는 6개 영역만 통과)
    relevant = [sa for sa, _ in sub_areas if sa in INTERNAL_SUB_AREAS]
    if not relevant:
        continue
    top = idx.match_internal(text, k=3, min_score=0.30)
    results.append({
        'raw_md': str(md), 'source': md.parent.name,
        'sub_areas': [sa for sa, _ in sub_areas],
        'matched_internal': relevant,
        'top_internal': top,
    })
print(json.dumps(results, ensure_ascii=False))
" > /tmp/regtrack-matched.json
```

→ JSON list로 후보를 받음. **여기서 통과 못 한 외규는 더 이상 처리 X** (내규에 매칭 가능한 영역이 없으므로).
→ Q: 왜 INTERNAL_SUB_AREAS 필터가 있나? 내규 vault가 현재 개인정보 6개 영역만 커버 (시중은행 처리방침 갈음). 망분리·정보보안 같은 외규는 비교할 내규가 없어 drop.

### Step 5 — 영향 판정 (★ LLM 영역 — 너의 작업)

`/tmp/regtrack-matched.json` 의 각 항목에 대해 **너(나노봇 LLM)가 직접 판정**:

각 외규에 대해:
1. 외규 본문(`raw_md` 경로의 .md 파일)을 읽는다
2. `top_internal[0]` 의 내규 .md 파일을 읽는다 (가장 가까운 내규)
3. 다음 판정을 내려 JSON으로 출력:

```json
{
  "raw_md": "...",
  "evaluation": {
    "has_impact": true|false,
    "impact_score": 0-10,
    "reason": "한 문장",
    "primary_match": "내규 파일명 (확장자 제외)",
    "affected_articles": ["제5조", "제7조"],
    "summary": ["bullet1", "bullet2", "bullet3"],
    "update_recommendation": "내규에 어떤 변경을 권고하는지 한 문단",
    "deadline_hint": "YYYY-MM-DD 또는 null"
  }
}
```

판정 기준:
- `impact_score >= 7`: 명시적으로 내규 개정·신설 필요한 법령 변경
- `impact_score 4-6`: 운영 절차·문서 수정 권고 수준
- `impact_score < 4`: 참고용, vault 업데이트 안 함 (Step 6 진입 X)

**대안**: 자체 판정 대신 우리 편의 도구 `LLMJudge` 호출 (OpenRouter gpt-5-mini, 비용 발생):
```bash
python -c "
import sys, json
sys.path.insert(0, '.')
from reg_pipeline.llm_judge import LLMJudge
matched = json.load(open('/tmp/regtrack-matched.json'))
j = LLMJudge(score_threshold={min_impact_score})
for item in matched:
    text = open(item['raw_md']).read()
    ev = j.judge(external_title=item['raw_md'], external_text=text,
                 external_sub_areas=item['sub_areas'],
                 matched_internals=item['top_internal'])
    item['evaluation'] = ev.to_dict()
json.dump(matched, open('/tmp/regtrack-judged.json','w'), ensure_ascii=False)
"
```

판정 끝나면 `/tmp/regtrack-judged.json` 에 evaluation 필드 포함된 결과 저장.

### Step 6 — Vault 업데이트 (기계 작업)

판정 결과를 우리 wiki 생성 + 내규 sync 툴에 넘김:

```bash
python -c "
import sys, json
sys.path.insert(0, '.')
from pathlib import Path
from reg_pipeline.daily_batch import stage_6_build_wiki, stage_7_sync_internal

matched = json.load(open('/tmp/regtrack-judged.json'))
for item in matched:
    item['raw_md'] = Path(item['raw_md'])
created = stage_6_build_wiki(matched, min_score={min_impact_score})
synced = stage_7_sync_internal(matched, min_score={min_impact_score})
print(json.dumps({'created_wiki': created, 'synced_internal': synced}))
"
```

→ `external_wiki/{source}/{date}_{title}.md` 신규 생성.
→ 매칭된 내규의 `related_external` 필드 + 본문 `# 관련 외규 (자동 갱신)` 섹션 갱신.

### Step 7 — MOC 갱신 (★ LLM 영역 — 우리 도구 미구현, 너가 수행)

`internal_wiki/_MOC/MOC_{sub_area}.md` 의 `## 외규 (자동 갱신)` 섹션 갱신.

각 신규 external_wiki .md 에 대해:
1. frontmatter 의 `sub_area` 리스트 파싱
2. 각 sub_area마다 `MOC_{sub_area}.md` 열기
3. `## 외규 (자동 갱신)` 섹션 다음에 `- [[외규파일명]]` 줄 append
4. `- (아직 없음)` placeholder가 있으면 제거
5. frontmatter `date:` 필드를 오늘 날짜로 갱신
6. 이미 같은 wikilink가 본문에 있으면 skip (dedup)

이 단계의 상세 계약은 vault README §7 참조.

### Step 8 — 사용자 알림

deskrpg 측 인터페이스로 push:
- 신규 wiki N건, 영향 큰 자료(`impact_score >= 7`) M건 요약
- 각 항목의 `primary_match` 내규 wikilink 포함

알림 본문 템플릿 예:
```
📋 오늘의 외규 업데이트 (N건)
- 영향 큰 자료 (impact >= 7): M건
  - [외규제목] → 영향: [내규명] (deadline: YYYY-MM-DD)
- 일반 자료 (impact 4-6): K건
- 분류 X: skipped 자료 L건
```

---

## 출력 (사용자 보고)

skill 종료 시 반환:

```json
{
  "since_date": "20260601",
  "sources_attempted": ["fsec","fsc","fss","pipc"],
  "sources_failed": [],
  "crawled": {"fsec": 2, "fsc": 7, "fss": 9, "pipc": 6},
  "converted": 24,
  "classified_relevant": 18,
  "judged_above_threshold": 12,
  "wiki_created": 12,
  "internal_synced": 8,
  "moc_updated": 9,
  "duration_seconds": 287
}
```

---

## 오류 처리

| 시나리오 | 대응 |
|---|---|
| 발행처 사이트 다운 | 해당 source는 0건으로 처리, 다른 발행처 진행, 알림에 명시 |
| LibreOffice 미설치 | HWP/DOC 변환 실패 → `failed` 카운트 증가, raw는 보존 (다음 실행에 재시도) |
| OPENROUTER_API_KEY 없음 (LLMJudge 사용 시) | 너(나노봇 LLM)의 자체 판정으로 폴백 |
| `.md` 첫 줄에 `> ⚠️ HWPX fallback 변환` | 분류 점수에 0.8 가중치 적용, 판정시 "구조 손실 가능성" 명시 |
| `embeddings.pkl` 캐시 손상 | 캐시 삭제 후 재실행 (재계산 ~10초) |

---

## 멱등성

같은 since_date로 재실행해도:
- 이미 받은 raw 파일은 skip (history.json + exists 체크)
- 이미 만든 raw_md는 skip (skip_existing=True)
- 이미 있는 external_wiki는 덮어쓰기 (LLM 판정이 갱신됐을 수 있으므로 의도된 동작)
- 내규 `related_external` 에 같은 wikilink 있으면 skip (dedup)
- MOC 본문에 같은 wikilink 있으면 skip (Step 7 에서 처리)

→ **하루에 여러 번 호출해도 안전**. force=false면 마지막 종료 후 6시간 내면 "skipped, last run at HH:MM" 반환.

---

## 도구 reference (vault README 링크)

- 책임 분리 (기계 vs LLM): `obsidian_vault/README.md` §5.1
- Python import surface: §5.3
- 3단 게이트 (분류·매칭·판정): §5.4
- 임계값 튜닝: §5.5
- 결과 위치: §5.6
- MOC 갱신 계약: §7

---

## 트리거 시점 (skill 사용 측 cron 예)

```cron
# 매일 09:00 KST (UTC+9)
0 0 * * * cd /path/to/regtrack && nanobot skill daily-regtrack-update --since-days-ago 7
```

온디맨드:
```
사용자: "어제부터 외규 가져와줘"
→ skill 호출 with since_date = 어제 (YYYYMMDD)
```
