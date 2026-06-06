"""taxonomy 기반 sub_area 분류기.

알고리즘:
  1. title_excludes 패턴 → 즉시 제외 ([], "title-excluded:X")
  2. 각 sub_area별 키워드 매칭 카운트
  3. 매칭 키워드 ≥ min_keywords (기본 2개) → sub_area 인정
  4. broader domain 결정 (개인정보 우선, 정보보안 차순위, 미분류)

internal 매칭은 INTERNAL_SUB_AREAS 집합과 교집합 있으면 통과.
"""

from pathlib import Path
import yaml

TAXONOMY_FILE = Path(__file__).parent / "taxonomy.yaml"

# 우리 내규 sub_area (시중은행 처리방침이 커버하는 영역)
INTERNAL_SUB_AREAS = frozenset({
    "수집동의", "처리위탁", "제3자제공",
    "안전성조치", "신용정보", "개인정보",
})


def load_taxonomy(path: Path = TAXONOMY_FILE) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def classify_text(
    title: str,
    body: str,
    taxonomy: dict,
    min_keywords: int = 2,
) -> tuple[list[str], str]:
    """본문+제목 → 매칭 sub_area 리스트.

    Args:
        title: 제목 (title_excludes 검사 대상)
        body: 본문
        taxonomy: load_taxonomy() 결과
        min_keywords: 최소 매칭 키워드 (임계값)

    Returns:
        (matched_sub_areas, skip_reason)
        skip_reason 비어있으면 정상.
    """
    # 1. Title exclude
    title_excludes = taxonomy.get("title_excludes") or []
    for ex in title_excludes:
        if ex in title:
            return [], f"title-excluded:{ex}"

    full_text = title + "\n" + body

    matched: list[str] = []
    for sub_area, config in taxonomy["sub_areas"].items():
        keywords = config.get("keywords") or []
        excludes = config.get("keywords_must_not") or []
        if any(ex in full_text for ex in excludes):
            continue
        unique_matches = {kw for kw in keywords if kw in full_text}
        if len(unique_matches) >= min_keywords:
            matched.append(sub_area)
    return matched, ""


def get_domain(sub_areas: list[str], taxonomy: dict) -> str:
    """sub_area 리스트 → broader domain.

    우선순위: 개인정보 > 정보보안 > 미분류
    """
    if not sub_areas:
        return "미분류"
    domains = {
        taxonomy["sub_areas"][sa]["domain"]
        for sa in sub_areas
        if sa in taxonomy["sub_areas"]
    }
    if "개인정보" in domains:
        return "개인정보"
    if "정보보안" in domains:
        return "정보보안"
    return "미분류"


def is_internal_relevant(sub_areas: list[str]) -> bool:
    """우리 내규(시중은행 처리방침) 영역과 교집합 있는지."""
    return bool(set(sub_areas) & INTERNAL_SUB_AREAS)


def filter_internal_matches(sub_areas: list[str]) -> list[str]:
    """매칭된 sub_area 중 internal과 교집합만."""
    return [sa for sa in sub_areas if sa in INTERNAL_SUB_AREAS]
