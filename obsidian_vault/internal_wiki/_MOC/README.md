# MOC (Map of Content) 개발 계약 문서

> 영역별 인덱스 파일의 스키마 + 자동 갱신 메커니즘 정의.
> **다른 팀원이 외규 매칭·자동 갱신 기능 개발 시 본 문서를 계약으로 사용**.

---

## 1. 무엇인가

**MOC = Map of Content**, Obsidian 패턴 중 하나로 **특정 sub_area(영역)에 속한 모든 노드를 모아두는 인덱스 노드**.

- Graph view에서 hub 역할 → 같은 영역 노드들이 시각적으로 클러스터링됨
- 사용자가 "수집동의 관련 자료 다 보고 싶다" → `MOC_수집동의.md` 한 번 열면 됨
- 자동화 시스템이 영역별로 자료 추가할 때 진입점

본 vault의 MOC는 다음 9개:

```
_MOC/
├── MOC_수집동의.md
├── MOC_처리위탁.md
├── MOC_제3자제공.md
├── MOC_안전성조치.md
├── MOC_신용정보.md
├── MOC_정보보안.md
├── MOC_IT안전성.md
├── MOC_망분리.md
└── MOC_클라우드.md
```

MOC 종류는 `sub_area` 분류에 1:1 대응. 새 영역 생기면 MOC 추가.

---

## 2. 파일 스키마 (계약)

### Frontmatter

```yaml
---
type: MOC                       # 고정값 (자동화는 이걸로 MOC 식별)
sub_area: 수집동의               # 영역명 (파일명과 일치)
date: 2026-06-06                # 최종 갱신일
tags: [MOC, 영역인덱스]         # 고정값
---
```

**불변**: `type: MOC`은 반드시 있어야 함 (자동화 인식자).

### Body 구조 (3 섹션 고정)

```markdown
# 영역: {sub_area}

> 본 영역과 관련된 모든 내규·외규·영향분석을 모아둔 인덱스 노드.
> Obsidian graph view에서 hub 역할.

## 사내규정 (내규 갈음)

- [[내규파일1]]
- [[내규파일2]]

## 외규 (자동 갱신)

> 본 영역과 매칭된 외규가 여기에 누적됨.

- [[외규파일1]]  ← 자동 추가
- [[외규파일2]]

## 영향도 분석 (자동 갱신)

- [[영향분석파일1]]  ← 자동 추가

---

#MOC #영역/{sub_area}
```

**섹션 헤더는 정확히 위 텍스트 유지** (자동화가 헤더로 섹션 위치 찾음).

---

## 3. 생성 방식

### 초기 생성 (이미 완료)

`internal_wiki/_convert.py`의 `build_moc()` 함수가 자동 생성:

```python
def build_moc(sub_area: str, related_internal: list) -> str:
    # 사내규정 섹션은 SPECS에서 sub_area 매칭으로 채움
    # 외규·영향도분석 섹션은 비어있음 (자동화 대상)
```

→ 9개 MOC 모두 사내규정 섹션은 채워진 상태. 외규/영향분석 섹션은 "(아직 없음)" placeholder.

### sub_area 추가 시

새 영역(예: 마이데이터) 추가하려면:
1. `_convert.py`의 SPECS에서 해당 sub_area를 가진 spec 추가/수정
2. `_convert.py` 재실행 → MOC 자동 생성

---

## 4. 자동 갱신 메커니즘 (★ 다른 팀원 개발 대상)

### 트리거

다음 이벤트 발생 시 MOC 자동 갱신:

| 이벤트 | 갱신 섹션 | 갱신 내용 |
|---|---|---|
| 신규 외규 wiki 추가 (`wiki/*.md`) | "## 외규" | 외규 frontmatter의 sub_area에 매칭되는 MOC 모두에 wikilink append |
| 신규 영향도 분석 생성 (`영향도분석/*.md`) | "## 영향도 분석" | 분석 결과 wikilink append |
| 내규 추가/삭제 | "## 사내규정" | `_convert.py` 재실행 (수동) |

### 알고리즘 (외규 추가 시)

```python
def on_external_added(external_md_path: Path):
    """신규 외규가 wiki/에 추가되면 호출"""
    external = parse_frontmatter(external_md_path)
    sub_areas = external["sub_area"]  # 예: ["수집동의", "처리위탁"]
    external_link = f"[[{external_md_path.stem}]]"

    for sub_area in sub_areas:
        moc_path = MOC_DIR / f"MOC_{sub_area}.md"
        if not moc_path.exists():
            continue  # 해당 sub_area MOC 없으면 skip
        append_under_section(
            moc_path,
            section_header="## 외규 (자동 갱신)",
            content=f"- {external_link}",
            placeholder_to_remove="- (아직 없음)",
        )
        update_frontmatter_date(moc_path, today())
```

### 알고리즘 (영향도 분석 추가 시)

```python
def on_impact_analysis_added(analysis_md_path: Path):
    """신규 영향도 분석이 생성되면 호출"""
    analysis = parse_frontmatter(analysis_md_path)
    related_internal = analysis["internal_affected"]  # 영향받는 내규 wikilinks

    # 영향받는 내규의 sub_area를 모두 모아 MOC에 추가
    sub_areas = set()
    for internal_link in related_internal:
        internal = find_wiki_by_name(internal_link)
        sub_areas.update(internal["sub_area"])

    for sub_area in sub_areas:
        moc_path = MOC_DIR / f"MOC_{sub_area}.md"
        append_under_section(
            moc_path,
            section_header="## 영향도 분석 (자동 갱신)",
            content=f"- [[{analysis_md_path.stem}]]",
            placeholder_to_remove="- (아직 없음)",
        )
```

### 헬퍼 함수 시그니처 (구현 시 참고)

```python
def parse_frontmatter(md_path: Path) -> dict:
    """파일의 YAML frontmatter를 dict로 파싱"""

def append_under_section(
    md_path: Path,
    section_header: str,  # 예: "## 외규 (자동 갱신)"
    content: str,         # 예: "- [[외규파일명]]"
    placeholder_to_remove: str = None,  # "- (아직 없음)" 같은 빈 표시
) -> None:
    """지정 섹션 아래에 새 줄 append. placeholder 있으면 제거."""

def update_frontmatter_date(md_path: Path, date_str: str) -> None:
    """frontmatter의 date: 필드 업데이트"""

def find_wiki_by_name(wikilink: str) -> dict:
    """wikilink 텍스트로 wiki 파일 찾아 frontmatter 반환"""
```

---

## 5. 동시 갱신 처리

같은 sub_area에 여러 외규가 동시에 들어오면:
- File lock 사용 (`fcntl.flock`) 또는 단일 워커 큐 권장
- 중복 wikilink는 자동 dedupe (set 사용)

---

## 6. 갱신 이후 wiki 측 동작

외규가 MOC에 추가되면 **개별 내규 wiki의 `related_external` 필드도 같이 갱신해야** 함:

```python
def sync_related_external(external_md_path: Path):
    external = parse_frontmatter(external_md_path)
    sub_areas = external["sub_area"]

    for sub_area in sub_areas:
        # 같은 sub_area를 가진 내규 wiki 모두 찾기
        for internal_wiki in find_internals_by_sub_area(sub_area):
            append_to_related_external(
                internal_wiki,
                f"[[{external_md_path.stem}]]"
            )
            # status: active → needs-review 자동 변경
            update_status(internal_wiki, "needs-review")
```

→ 외규 1건 추가 → MOC N건 갱신 + 내규 M건 갱신 (M = 외규의 sub_area와 매칭되는 내규 수)

---

## 7. 외규 매칭 정확도 개선 후크

기본은 `sub_area` 태그 매칭이지만, 정밀도 높이려면:

1. **벡터 유사도 사전 필터**: 외규 본문 임베딩 vs 내규 본문 임베딩 → 코사인 유사도 0.7 이상만 후보
2. **약한 LLM 판정**: 후보 중 영향도 점수 ≥ 7만 MOC에 추가
3. **사용자 검수**: PR/리뷰로 자동 추가 결과 검토

본 MOC는 이러한 매칭 파이프라인의 **결과 수신처** 역할.

---

## 8. 테스트 시나리오

### 시나리오 A: 신규 외규 1건

```
입력: wiki/01_법령_규제/개인정보위_자율점검가이드_2026.md
      frontmatter: sub_area: [수집동의, 처리위탁]

기대 결과:
- MOC_수집동의.md "## 외규" 섹션에 wikilink 추가
- MOC_처리위탁.md "## 외규" 섹션에 wikilink 추가
- 두 MOC 모두 frontmatter date 갱신
- 매칭되는 내규 wiki 모두에 related_external 갱신 + status="needs-review"
```

### 시나리오 B: sub_area 누락 외규

```
입력: 외규 frontmatter에 sub_area 필드 없음

기대 결과:
- 어떤 MOC에도 추가 안 됨
- 로그: "no sub_area, skipped"
- 또는 default sub_area "미분류" MOC에 추가 (정책 선택)
```

### 시나리오 C: 신규 sub_area 등장

```
입력: 외규 sub_area: [마이데이터] (기존 MOC 없는 영역)

기대 결과:
- MOC_마이데이터.md 자동 생성 (또는 알림 후 사용자 결정)
- 새 MOC에 해당 외규 wikilink 추가
```

---

## 9. 구현 위치 권장

```
nanobot/agent/tools/  (또는 deskrpg 측 별도 모듈)
└── moc_updater.py    ← 본 문서 §4 알고리즘 구현
```

호출 시점:
- 외규 wiki MD가 vault에 commit된 직후 (post-commit hook 또는 별도 워커)
- 영향도 분석 생성 직후 (LLM 분석 파이프라인 종료 시점)

---

## 10. 참고: 현재 MOC 파일 (자동 생성된 9개)

| 파일 | sub_area | 사내규정 | 외규 | 영향분석 |
|---|---|---|---|---|
| MOC_수집동의.md | 수집동의 | 2건 | (없음) | (없음) |
| MOC_처리위탁.md | 처리위탁 | 3건 | (없음) | (없음) |
| MOC_제3자제공.md | 제3자제공 | 2건 | (없음) | (없음) |
| MOC_안전성조치.md | 안전성조치 | 4건 | (없음) | (없음) |
| MOC_신용정보.md | 신용정보 | 1건 | (없음) | (없음) |
| MOC_정보보안.md | 정보보안 | 3건 | (없음) | (없음) |
| MOC_IT안전성.md | IT안전성 | 1건 | (없음) | (없음) |
| MOC_망분리.md | 망분리 | 1건 | (없음) | (없음) |
| MOC_클라우드.md | 클라우드 | 1건 | (없음) | (없음) |

→ 자동 갱신 시스템 가동되면 "외규"·"영향분석" 컬럼이 채워짐.
