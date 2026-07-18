"""단일 발행처 크롤러 실행 (CLI).

사용:
    python run_one.py {fsec|fss|fsc|pipc|law_center} [--since YYYYMMDD]
"""

from __future__ import annotations

import argparse
import importlib
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

# 루트 path
ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # → regtrack/
VAULT = ROOT / "obsidian_vault"
OUT_ROOT = VAULT / "external_raw"
HISTORY_FILE = ROOT / ".cache" / "crawl_history.json"

# reg_pipeline import
sys.path.insert(0, str(VAULT / "_tools"))
from reg_pipeline.crawler.base import CrawlHistory, setup_browser  # noqa: E402

SOURCES = ["fsec", "fss", "fsc", "pipc", "law_center"]


def main():
    parser = argparse.ArgumentParser(description="단일 발행처 크롤러")
    parser.add_argument("source", choices=SOURCES, help="발행처 코드")
    parser.add_argument("--since", default=None, help="YYYYMMDD 이후만 수집")
    args = parser.parse_args()

    mod = importlib.import_module(f"reg_pipeline.crawler.sources.{args.source}")
    out_dir = OUT_ROOT / args.source
    history = CrawlHistory.load(HISTORY_FILE)

    print(f"=== [{args.source}] 크롤링 시작 (since={args.since}) ===")
    with sync_playwright() as p:
        browser, context = setup_browser(p)
        page = context.new_page()
        try:
            results = mod.crawl(out_dir, args.since, history, page)
            print(f"\n📊 결과: {len(results)}건")
        finally:
            history.save()
            page.close()
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
