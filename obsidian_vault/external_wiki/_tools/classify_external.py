"""
외규 raw 파일을 taxonomy.yaml 기준으로 sub_area 분류.

dry-run 모드 (기본): 분류 결과만 출력. wiki 생성 안 함.
build 모드: 분류 결과를 wiki/외규_분류/{domain}/{filename}.md로 생성.

사용법:
    /tmp/playwright-venv/bin/pip install pyyaml
    /tmp/playwright-venv/bin/python obsidian_vault/wiki/_tools/classify_external.py
    /tmp/playwright-venv/bin/python obsidian_vault/wiki/_tools/classify_external.py --build
"""

import sys
import re
import yaml
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent.parent.parent  # obsidian_vault/
RAW_DIR = ROOT / "external_raw"
WIKI_DIR = ROOT / "external_wiki" / "외규_분류"
TAXONOMY_FILE = Path(__file__).parent / "taxonomy.yaml"


def load_taxonomy() -> dict:
    with open(TAXONOMY_FILE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def classify_text(title: str, body: str, taxonomy: dict, min_keywords: int = 2) -> tuple[list[str], str]:
    """본문+제목에서 키워드 매칭 → sub_area 리스트 반환.

    Args:
        title: 제목 (제목에 title_excludes 있으면 사전 제외)
        body: 본문
        min_keywords: 최소 매칭 키워드 수 (임계값, 기본 2)

    Returns:
        (matched_sub_areas, skip_reason)
        skip_reason이 비어있으면 정상 분류 결과.
    """
    # 1. Title exclude check
    title_excludes = taxonomy.get("title_excludes", [])
    for ex in title_excludes:
        if ex in title:
            return [], f"title-excluded:{ex}"

    full_text = title + "\n" + body

    # 2. Sub_area 매칭 (임계값 적용)
    matched = []
    for sub_area, config in taxonomy["sub_areas"].items():
        keywords = config["keywords"]
        excludes = config.get("keywords_must_not", [])

        if any(ex in full_text for ex in excludes):
            continue

        # distinct keyword matches (중복 제외)
        matches = {kw for kw in keywords if kw in full_text}

        if len(matches) >= min_keywords:
            matched.append(sub_area)
    return matched, ""


def get_domain(sub_areas: list[str], taxonomy: dict) -> str:
    """sub_area 리스트 → broader domain (개인정보 우선)."""
    if not sub_areas:
        return "미분류"
    domains = {taxonomy["sub_areas"][sa]["domain"] for sa in sub_areas if sa in taxonomy["sub_areas"]}
    if "개인정보" in domains:
        return "개인정보"
    if "정보보안" in domains:
        return "정보보안"
    return "미분류"


def extract_date_and_source(filename: str) -> tuple[str, str, str]:
    """파일명에서 날짜·출처·제목 추출.

    fsec_YYYYMMDD_제목.md → ("YYYYMMDD", "FSEC", "제목")
    """
    stem = Path(filename).stem
    m = re.match(r"^([a-z]+)_(\d{8})_(.+)$", stem)
    if m:
        source_code = m.group(1).upper()
        date_str = m.group(2)
        title = m.group(3).replace("_", " ")
        # 출처 코드 → 발행기관
        source_map = {
            "FSEC": "금융보안원",
            "FSC": "금융위원회",
            "FSS": "금융감독원",
            "PIPC": "개인정보보호위원회",
        }
        institution = source_map.get(source_code, source_code)
        return date_str, institution, title
    return "00000000", "미상", stem.replace("_", " ")


def format_date(date_str: str) -> str:
    """YYYYMMDD → YYYY-MM-DD."""
    if len(date_str) == 8:
        return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    return date_str


def build_frontmatter(title: str, date: str, institution: str, sub_areas: list[str]) -> str:
    """frontmatter 생성 (internal_wiki와 동일 컨벤션)."""
    tags = ["외규"]
    tags.append(f"출처/{institution}")
    tags.append("status/active")
    for sa in sub_areas:
        tags.append(f"영역/{sa}")
    tags_yaml = "\n".join(f"  - {t}" for t in tags)
    sub_area_yaml = ", ".join(sub_areas)

    return f"""---
title: "{title}"
date: {format_date(date)}
source_institution: "{institution}"
document_type: "외규"
tags:
{tags_yaml}
status: "active"
type: "외규"
sub_area: [{sub_area_yaml}]
source_doc: "raw/{Path('').name}"
related_internal: []
---

"""


def build_wiki_body(date: str, raw_filename: str, raw_excerpt: str, sub_areas: list[str]) -> str:
    """wiki body. raw 링크 + 본문 인용 (앞부분만)."""
    excerpt_limit = 2000
    excerpt = raw_excerpt[:excerpt_limit]
    truncated = len(raw_excerpt) > excerpt_limit

    return f"""# 개요

- **발행일**: {format_date(date)}
- **영역**: {', '.join(sub_areas)}
- **원천 raw**: [`raw/{raw_filename}`](../../raw/{raw_filename})

# 본문 (raw 인용 {'일부' if truncated else '전체'})

{excerpt}{'...(중략)' if truncated else ''}

# 관련 내규 (자동 갱신 예정)

> 영향도 분석 시 본 외규에 매칭된 내규가 여기에 누적됨.

- (아직 없음)
"""


def classify_all(taxonomy: dict) -> list[dict]:
    """raw 폴더 모든 .md 분류."""
    if not RAW_DIR.exists():
        print(f"❌ {RAW_DIR} not found")
        return []

    results = []
    for md_file in sorted(RAW_DIR.glob("*.md")):
        text = md_file.read_text(encoding="utf-8")
        date, institution, title = extract_date_and_source(md_file.name)
        sub_areas, skip_reason = classify_text(title, text, taxonomy)
        domain = get_domain(sub_areas, taxonomy)
        results.append({
            "filename": md_file.name,
            "title": title,
            "date": date,
            "institution": institution,
            "sub_areas": sub_areas,
            "domain": domain,
            "skip_reason": skip_reason,
            "raw_path": md_file,
            "raw_text": text,
        })
    return results


def print_summary(results: list[dict]):
    by_domain = defaultdict(list)
    by_subarea = defaultdict(list)
    unclassified = []
    multi_area = []

    for r in results:
        if not r["sub_areas"]:
            unclassified.append(r["filename"])
        else:
            by_domain[r["domain"]].append(r["filename"])
            for sa in r["sub_areas"]:
                by_subarea[sa].append(r["filename"])
            if len(r["sub_areas"]) >= 3:
                multi_area.append((r["filename"], r["sub_areas"]))

    total = len(results)
    classified = total - len(unclassified)

    print(f"\n{'='*60}")
    print(f"📊 분류 결과 요약")
    print(f"{'='*60}")
    print(f"전체 raw: {total}건")
    print(f"분류 성공: {classified}건 ({classified/total*100:.0f}%)")
    print(f"미분류: {len(unclassified)}건")

    print(f"\n--- Domain별 (wiki 폴더) ---")
    for d, files in by_domain.items():
        print(f"  {d}: {len(files)}건")

    print(f"\n--- Sub_area별 (frontmatter) ---")
    for sa, files in sorted(by_subarea.items(), key=lambda x: -len(x[1])):
        print(f"  {sa}: {len(files)}건")

    print(f"\n--- 분류 샘플 (각 sub_area별 1건) ---")
    for sa in sorted(by_subarea.keys()):
        f = by_subarea[sa][0]
        # 50자 자르기
        f_short = f[:80] + "..." if len(f) > 80 else f
        print(f"  [{sa}] {f_short}")

    if multi_area:
        print(f"\n--- 다중 영역 매칭 (3+ sub_area, {len(multi_area)}건) ---")
        for f, sas in multi_area[:5]:
            f_short = f[:60] + "..." if len(f) > 60 else f
            print(f"  {f_short}")
            print(f"    → {sas}")

    if unclassified:
        print(f"\n--- 미분류 샘플 (5건) ---")
        for f in unclassified[:5]:
            f_short = f[:80] + "..." if len(f) > 80 else f
            print(f"  - {f_short}")


def build_wiki(results: list[dict]):
    """매칭된 결과를 wiki/외규_분류/{domain}/...md로 생성."""
    print(f"\n{'='*60}")
    print(f"📝 wiki MD 생성")
    print(f"{'='*60}")

    for domain in ["개인정보", "정보보안"]:
        (WIKI_DIR / domain).mkdir(parents=True, exist_ok=True)

    created = 0
    for r in results:
        if not r["sub_areas"]:
            continue  # 미분류는 skip

        wiki_name = f"{r['date']}_{r['institution']}_{r['title'][:60]}.md"
        # 파일명 정제 (특수문자 제거)
        wiki_name = re.sub(r'[\\/*?:"<>|]', '', wiki_name)
        wiki_path = WIKI_DIR / r["domain"] / wiki_name

        fm = build_frontmatter(r["title"], r["date"], r["institution"], r["sub_areas"])
        body = build_wiki_body(r["date"], r["filename"], r["raw_text"], r["sub_areas"])

        wiki_path.write_text(fm + body, encoding="utf-8")
        created += 1

    print(f"  ✅ {created}건 wiki 생성됨 (wiki/외규_분류/)")


def main():
    taxonomy = load_taxonomy()
    print(f"taxonomy 로드: {len(taxonomy['sub_areas'])}개 sub_area")

    results = classify_all(taxonomy)
    print_summary(results)

    if "--build" in sys.argv:
        build_wiki(results)
    else:
        print(f"\n{'='*60}")
        print(f"💡 wiki 생성하려면: --build 옵션 추가")
        print(f"{'='*60}")


if __name__ == "__main__":
    main()
