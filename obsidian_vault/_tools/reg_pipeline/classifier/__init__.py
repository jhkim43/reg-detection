"""classifier — sub_area 분류 + internal 매칭.

흐름:
  1) classify_text(title, body) → (sub_areas, skip_reason)
     - title_excludes 제외 (행사·시상 등)
     - taxonomy.yaml 키워드 매칭 (임계값 2개)
  2) match_internal(sub_areas, INTERNAL_SUB_AREAS) → bool
     - 우리 내규 sub_area와 교집합 있으면 통과
"""

from .classify import classify_text, load_taxonomy, get_domain, INTERNAL_SUB_AREAS

__all__ = ["classify_text", "load_taxonomy", "get_domain", "INTERNAL_SUB_AREAS"]
