"""
external_raw → external_wiki 변환 스켈레톤 (v13 구현 예정)

흐름:
  external_raw/{발행처}/*.pdf|hwp|json|md
    ↓ [1] PDF/HWP → 마크다운 추출 (opendataloader, 기존 도구)
    ↓ [2] sub_area 자동 분류 (classify_external.py)
    ↓ [3] 임계값 통과만 → external_wiki/외규_분류/{domain}/*.md
    ↓ [4] MOC 자동 갱신 (internal_wiki/_MOC/MOC_*.md "## 외규" 섹션)
    ↓ [5] 매칭 internal wiki의 related_external 갱신

영향 판단 기준 (우리 internal sub_area):
  수집동의 / 처리위탁 / 제3자제공 / 안전성조치 / 신용정보 / 개인정보

영향 없는 자료는 external_raw에만 남기고 external_wiki로 안 옮김.

사용법 (v13 이후 구현):
    export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
    /tmp/playwright-venv/bin/python obsidian_vault/external_wiki/_tools/build_external_wiki.py
"""

from pathlib import Path

ROOT = Path(__file__).parent.parent.parent  # obsidian_vault/
EXTERNAL_RAW = ROOT / "external_raw"
EXTERNAL_WIKI = ROOT / "external_wiki" / "외규_분류"
INTERNAL_MOC = ROOT / "internal_wiki" / "_MOC"


# === [v13 TODO] Stage 1: raw 파일 본문 추출 ===

def extract_to_markdown():
    """PDF/HWP/JSON → 마크다운 변환.

    - PDF: opendataloader_pdf.convert()
    - HWP: hwp2md 또는 olefile (crawler.py 활용)
    - JSON: 법령 본문 정형 데이터 → 마크다운 정리
    - MD: 이미 마크다운 (raw_md/로 복사)

    출력: external_raw_md/{발행처}/*.md
    """
    raise NotImplementedError("v13에서 구현")


# === [v13 TODO] Stage 2: sub_area 분류 + 영향도 평가 ===

def classify_and_filter():
    """본문 → sub_area 자동 분류 + 영향도 점수.

    1. taxonomy.yaml 기반 키워드 매칭 (현재 prototype 도구 활용)
    2. (선택) Mecab 형태소 + TF-IDF 정확도 향상
    3. (선택) 임베딩 매칭 (외규 본문 vs 우리 internal wiki 9개)
    4. 임계값 ≥ N 통과만 external_wiki로 진입

    영향 판단 기준 (우리 internal sub_area):
      - 수집동의 / 처리위탁 / 제3자제공 / 안전성조치 / 신용정보 / 개인정보

    임계값 미만 → external_raw에만 남기고 external_wiki 진입 X.
    """
    raise NotImplementedError("v13에서 구현")


# === [v13 TODO] Stage 3: external_wiki 생성 ===

def build_external_wiki():
    """external_wiki/외규_분류/{domain}/*.md 생성.

    frontmatter:
      title, date, source_institution, document_type,
      tags: [영역/X, 출처/X, status/active],
      sub_area: [매칭된 영역],
      impact_score: float,
      related_internal: [매칭된 우리 internal wiki wikilinks],

    body:
      개요 + 핵심 요약 + 영향 분석 + raw 링크
    """
    raise NotImplementedError("v13에서 구현")


# === [v13 TODO] Stage 4: MOC 자동 갱신 ===

def update_mocs():
    """internal_wiki/_MOC/MOC_{sub_area}.md 의 "## 외규" 섹션 갱신.

    개발 계약 문서: internal_wiki/_MOC/README.md

    - 매칭된 sub_area별 MOC에 [[외규파일명]] append
    - placeholder "(아직 없음)" 제거
    - frontmatter date 갱신
    """
    raise NotImplementedError("v13에서 구현")


# === [v13 TODO] Stage 5: 매칭 internal wiki sync ===

def sync_internal_wikis():
    """매칭된 internal wiki의 related_external 배열 + status 갱신.

    - related_external: [[외규파일명]] append
    - status: active → needs-review (사용자 검토 트리거)
    """
    raise NotImplementedError("v13에서 구현")


# === main (스켈레톤) ===

def main():
    print("=" * 60)
    print("external_raw → external_wiki (스켈레톤, v13 구현 예정)")
    print("=" * 60)
    print(f"\nINPUT:  {EXTERNAL_RAW}")
    print(f"OUTPUT: {EXTERNAL_WIKI}")
    print(f"\n예상 흐름:")
    print(f"  external_raw/  →  추출  →  분류  →  임계값 통과만  →  external_wiki/")
    print(f"  → MOC 갱신    →  internal sync  →  사용자 알림")
    print(f"\n총 영향 추정: 481건 중 약 120건 (25%)")
    print(f"  law_center:  30/30  (83%)")
    print(f"  pipc:        ~50/87 (57%)")
    print(f"  fss:         ~30/254 (12%)")
    print(f"  fsec:        ~15/110 (14%)")
    print(f"\n⚠️  실제 분류는 v13에서 구현. 이 파일은 스켈레톤.")


if __name__ == "__main__":
    main()
