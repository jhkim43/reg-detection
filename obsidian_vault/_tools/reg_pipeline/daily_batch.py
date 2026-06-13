"""일일 배치 통합 entry.

흐름 (7 stage):
  1. 크롤링 (4 발행처: fsec/fsc/fss/pipc)
  2. raw → MD 변환 (PDF/HWP/HWPX/DOC/DOCX → opendataloader-pdf via LibreOffice)
  3. 분류 + 필터 (임베딩 sub_area 매칭, INTERNAL_SUB_AREAS 교집합)
  4. 매칭 후보 식별 (internal_wiki 임베딩 코사인 top-K)
  5. LLM 위임 (영향 평가 + 요약·권고, OpenRouter google/gemma-4-31b-it)
  6. external_wiki 생성 (impact_score >= --min-score)
  7. internal_wiki related_external 갱신 + 본문 "# 관련 외규" 섹션 append

사용법:
    # 1회 셋업은 _tools/SETUP.md 참조 (venv + pip install -r requirements.txt + brew)
    # OPENROUTER_API_KEY는 .env.integration에서 자동 로드
    source .venv/bin/activate
    export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
    cd obsidian_vault/_tools
    python -m reg_pipeline.daily_batch --since 20260530

옵션 (stage 실행 범위):
    --since YYYYMMDD     수집 시작일 (기본: 1주일 전). 그 날짜 포함 ~ 오늘까지.
    --sources fsec,pipc  발행처 선택 (기본: fsec,fsc,fss,pipc 전부)
    --crawl-only         stage 1만 (크롤만, 변환·분류·LLM·wiki 모두 skip)
    --no-classify        stage 1~2만 (크롤 + 변환만, 분류 이후 skip)
    --no-llm             stage 1~7 다 실행하되 stage 5만 mock (impact_score=5 고정).
                         실제 LLM 비용 없이 wiki/sync 산출물 형태 검증용.
    --min-score N        external_wiki 진입 + internal sync 임계값 (기본 4)
"""

from __future__ import annotations

import argparse
import importlib
import sys
from datetime import datetime, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent.parent.parent  # → regtrack/
VAULT = ROOT / "obsidian_vault"
EXTERNAL_RAW = VAULT / "external_raw"
EXTERNAL_RAW_MD = VAULT / "external_raw_md"
EXTERNAL_WIKI = VAULT / "external_wiki"
INTERNAL_WIKI = VAULT / "internal_wiki" / "개인정보"
HISTORY_FILE = ROOT / ".cache" / "crawl_history.json"

sys.path.insert(0, str(VAULT / "_tools"))

from reg_pipeline.crawler.base import CrawlHistory, setup_browser  # noqa: E402
from reg_pipeline.converter import BatchConverter  # noqa: E402
from reg_pipeline.classifier import (  # noqa: E402
    classify_text,
    load_taxonomy,
    INTERNAL_SUB_AREAS,
    EmbeddingIndex,
)


SOURCES = ["fsec", "fss", "fsc", "pipc"]  # law_center는 OpenAPI 신청 필요 (v2)


def stage_1_crawl(sources: list[str], since_date: str, history: CrawlHistory) -> dict[str, int]:
    """발행처별 크롤링 → external_raw/{source}/."""
    print("=" * 60)
    print(f"[1/N] 크롤링 (since={since_date})")
    print("=" * 60)
    counts = {}
    with sync_playwright() as p:
        browser, context = setup_browser(p)
        for source in sources:
            print(f"\n>>> [{source}]")
            try:
                mod = importlib.import_module(f"reg_pipeline.crawler.sources.{source}")
                page = context.new_page()
                try:
                    out_dir = EXTERNAL_RAW / source
                    results = mod.crawl(out_dir, since_date, history, page)
                    counts[source] = len(results)
                    print(f"<<< [{source}] {len(results)}건 수집")
                finally:
                    page.close()
            except Exception as e:
                print(f"❌ [{source}] 크롤링 실패: {e}")
                counts[source] = 0
        context.close()
        browser.close()
    history.save()
    return counts


def stage_2_convert() -> dict:
    """external_raw/{source}/ → external_raw_md/{source}/."""
    print("\n" + "=" * 60)
    print("[2/N] raw → MD 변환")
    print("=" * 60)
    bc = BatchConverter(raw_root=EXTERNAL_RAW, out_root=EXTERNAL_RAW_MD)
    stats = bc.run(skip_existing=True)
    print(f"  변환 성공: {stats['success']}건")
    print(f"  skip: {stats['skip']}건, 실패: {stats['failed']}건, 미지원: {stats['unsupported']}건")
    return stats


def stage_3_classify_filter(
    embed_idx: EmbeddingIndex,
    classify_threshold: float = 0.45,
) -> list[dict]:
    """raw_md 임베딩 분류 + internal 매칭만 필터."""
    print("\n" + "=" * 60)
    print(f"[3/N] 분류 + 필터 (임베딩, threshold={classify_threshold})")
    print("=" * 60)
    matched = []
    for source_dir in sorted(EXTERNAL_RAW_MD.iterdir()):
        if not source_dir.is_dir() or source_dir.name == "reference":
            continue
        n = 0
        for md in source_dir.glob("*.md"):
            try:
                text = md.read_text(encoding="utf-8")
            except Exception:
                continue
            sub_areas_scored, _ = embed_idx.classify(
                text=text,
                title=md.stem,
                threshold=classify_threshold,
            )
            if not sub_areas_scored:
                continue
            sub_areas = [sa for sa, _ in sub_areas_scored]
            relevant = [sa for sa in sub_areas if sa in INTERNAL_SUB_AREAS]
            if relevant:
                matched.append({
                    "source": source_dir.name,
                    "raw_md": md,
                    "sub_areas": sub_areas,
                    "sub_areas_scored": sub_areas_scored,
                    "matched_internal": relevant,
                    "text": text,
                })
                n += 1
        print(f"  [{source_dir.name}] {n}건 internal 매칭")
    print(f"  → 총 {len(matched)}건")
    return matched


def stage_4_match_corpus(
    matched: list[dict],
    embed_idx: EmbeddingIndex,
    k: int = 3,
    min_score: float = 0.30,
) -> list[dict]:
    """internal_wiki 임베딩 매칭 후보 top-K."""
    print("\n" + "=" * 60)
    print(f"[4/N] internal 매칭 후보 (임베딩 코사인, top-{k}, min={min_score})")
    print("=" * 60)
    for item in matched:
        item["top_internal"] = embed_idx.match_internal(
            item["text"], k=k, min_score=min_score
        )
    print(f"  {len(matched)}건 각각 매칭 후보 식별")
    return matched


def stage_5_llm_judge(matched: list[dict], use_llm: bool, score_threshold: int = 5) -> list[dict]:
    """LLM 위임 (영향 평가 + 요약·권고).

    use_llm=False면 mock 결과 (score=5, 빈 요약).
    """
    print("\n" + "=" * 60)
    print(f"[5/N] LLM 위임 ({'OpenRouter/google/gemma-4-31b-it' if use_llm else 'mock'})")
    print("=" * 60)
    if not use_llm:
        for item in matched:
            item["evaluation"] = {
                "has_impact": True,
                "impact_score": 5,
                "reason": "(mock) LLM 위임 skip",
                "primary_match": item["top_internal"][0][0] if item["top_internal"] else "",
                "affected_articles": [],
                "summary": [],
                "update_recommendation": "",
                "deadline_hint": None,
            }
        return matched

    # 실제 LLM 호출
    from reg_pipeline.llm_judge import LLMJudge
    judge = LLMJudge(score_threshold=score_threshold)
    for i, item in enumerate(matched, 1):
        print(f"  [{i}/{len(matched)}] {item['raw_md'].stem[:50]}...")
        try:
            evaluation = judge.judge(
                external_title=item["raw_md"].stem,
                external_text=item["text"],
                external_sub_areas=item["sub_areas"],
                matched_internals=item["top_internal"],
            )
            item["evaluation"] = {
                "has_impact": evaluation.impact.has_impact,
                "impact_score": evaluation.impact.impact_score,
                "reason": evaluation.impact.reason,
                "primary_match": evaluation.impact.primary_match,
                "affected_articles": evaluation.impact.affected_articles,
                "summary": evaluation.summary,
                "update_recommendation": evaluation.update_recommendation,
                "deadline_hint": evaluation.deadline_hint,
            }
        except Exception as e:
            print(f"    ❌ LLM 호출 실패: {e}")
            item["evaluation"] = {
                "has_impact": False, "impact_score": 0,
                "reason": f"LLM 실패: {e}",
            }
    return matched


def stage_6_build_wiki(matched: list[dict], min_score: int = 4) -> int:
    """external_wiki/{발행처}/ 생성 (impact_score >= min_score)."""
    print("\n" + "=" * 60)
    print(f"[6/N] external_wiki 생성 (impact_score >= {min_score})")
    print("=" * 60)
    created = 0
    for item in matched:
        evaluation = item.get("evaluation", {})
        if evaluation.get("impact_score", 0) < min_score:
            continue

        wiki_dir = EXTERNAL_WIKI / item["source"]
        wiki_dir.mkdir(parents=True, exist_ok=True)
        wiki_path = wiki_dir / item["raw_md"].name

        # frontmatter + body
        tags = (
            ["외규", f"출처/{item['source']}", "status/active"]
            + [f"영역/{sa}" for sa in item["matched_internal"]]
        )
        tags_yaml = "\n".join(f"  - {t}" for t in tags)
        sub_area_yaml = ", ".join(item["matched_internal"])
        summary_bullets = "\n".join(f"- {b}" for b in evaluation.get("summary", []) or ["(요약 없음)"])
        primary = evaluation.get("primary_match", "")
        affected = ", ".join(evaluation.get("affected_articles", []) or [])

        content = f"""---
title: "{item['raw_md'].stem}"
source_institution: "{item['source']}"
document_type: "외규"
tags:
{tags_yaml}
status: "active"
type: "외규"
sub_area: [{sub_area_yaml}]
impact_score: {evaluation.get('impact_score', 0)}
has_impact: {str(evaluation.get('has_impact', False)).lower()}
primary_match: "{primary}"
affected_articles: [{affected}]
related_internal: ["{primary}"]
source_md: "external_raw_md/{item['source']}/{item['raw_md'].name}"
---

# 개요

- **발행처**: {item['source']}
- **영역**: {', '.join(item['matched_internal'])}
- **영향도 점수**: {evaluation.get('impact_score', 0)}/10
- **판정 이유**: {evaluation.get('reason', '')}
- **영향 받을 내규**: [[{primary}]]
- **영향 조항**: {affected or '(미상)'}

# 요약

{summary_bullets}

# 내규 업데이트 권고

{evaluation.get('update_recommendation', '(권고 없음)')}

# 마감 힌트

{evaluation.get('deadline_hint') or '(없음)'}

# 출처

- 📝 **추출본**: [`external_raw_md/{item['source']}/{item['raw_md'].name}`](../../external_raw_md/{item['source']}/{item['raw_md'].name})
"""
        wiki_path.write_text(content, encoding="utf-8")
        created += 1
    print(f"  → {created}건 external_wiki 생성")
    return created


def stage_7_sync_internal(matched: list[dict], min_score: int = 4) -> int:
    """internal_wiki/개인정보/{wiki}.md 의 related_external 갱신."""
    print("\n" + "=" * 60)
    print(f"[7/N] internal_wiki sync (related_external 갱신)")
    print("=" * 60)
    updated = 0
    for item in matched:
        evaluation = item.get("evaluation", {})
        if evaluation.get("impact_score", 0) < min_score:
            continue
        primary = evaluation.get("primary_match", "")
        if not primary:
            continue
        internal_path = INTERNAL_WIKI / f"{primary}.md"
        if not internal_path.exists():
            continue
        try:
            content = internal_path.read_text(encoding="utf-8")
            external_wikilink = f"[[{item['raw_md'].stem}]]"
            if external_wikilink in content:
                continue  # 이미 있음
            # related_external: [] → [...]
            updated_content = content.replace(
                "related_external: []",
                f"related_external: [\"{item['raw_md'].stem}\"]",
                1,
            )
            # 관련 외규 섹션도 append
            if "# 관련 외규 (자동 갱신)" in updated_content:
                updated_content = updated_content.replace(
                    "- (아직 없음)",
                    f"- {external_wikilink} ✨ NEW",
                    1,
                )
            internal_path.write_text(updated_content, encoding="utf-8")
            updated += 1
        except Exception as e:
            print(f"  ⚠️ {primary} sync 실패: {e}")
    print(f"  → {updated}건 internal_wiki sync")
    return updated


def main():
    parser = argparse.ArgumentParser(description="일일 배치 통합")
    parser.add_argument("--since", default=None, help="YYYYMMDD (기본: 1주일 전)")
    parser.add_argument("--sources", default=",".join(SOURCES), help="발행처 콤마 구분")
    parser.add_argument("--no-llm", action="store_true", help="LLM 호출 skip (mock)")
    parser.add_argument("--crawl-only", action="store_true", help="크롤링만")
    parser.add_argument("--no-classify", action="store_true", help="크롤링 + 변환까지만 (분류·LLM·wiki skip)")
    parser.add_argument("--min-score", type=int, default=4, help="wiki 진입 임계값")
    args = parser.parse_args()

    since_date = args.since or (datetime.now() - timedelta(days=7)).strftime("%Y%m%d")
    sources = [s.strip() for s in args.sources.split(",") if s.strip()]

    print(f"📅 since_date: {since_date}")
    print(f"📋 sources: {sources}")
    print(f"🤖 LLM: {'mock' if args.no_llm else 'OpenRouter/google/gemma-4-31b-it'}")

    history = CrawlHistory.load(HISTORY_FILE)
    stage_1_crawl(sources, since_date, history)
    if args.crawl_only:
        print("\n🎉 (crawl-only) 완료")
        return

    stage_2_convert()
    if args.no_classify:
        print("\n🎉 (no-classify) 크롤 + 변환까지 완료")
        return

    # 임베딩 인덱스 (모델 1회 로드, sub_area + internal 캐시)
    taxonomy = load_taxonomy()
    embed_cache = ROOT / ".cache" / "embeddings.pkl"
    embed_idx = EmbeddingIndex(
        taxonomy=taxonomy,
        internal_dir=INTERNAL_WIKI,
        cache_path=embed_cache,
    )

    matched = stage_3_classify_filter(embed_idx)
    if not matched:
        print("\n매칭된 자료 없음. 종료.")
        return

    matched = stage_4_match_corpus(matched, embed_idx)
    matched = stage_5_llm_judge(matched, use_llm=not args.no_llm, score_threshold=args.min_score)
    stage_6_build_wiki(matched, min_score=args.min_score)
    stage_7_sync_internal(matched, min_score=args.min_score)

    print("\n🎉 일일 배치 완료")


if __name__ == "__main__":
    main()
