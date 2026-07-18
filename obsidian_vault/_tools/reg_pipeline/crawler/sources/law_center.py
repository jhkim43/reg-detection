"""국가법령정보센터 (law.go.kr) — 최신 법령 + 행정규칙.

URLs:
  latest_laws: https://www.law.go.kr/lsSc.do?menuId=1&subMenuId=23&tabMenuId=121 (최신 법령)
  adm_rules:   https://www.law.go.kr/admRulSc.do?menuId=5&subMenuId=45&tabMenuId=203 (행정규칙)
"""

from __future__ import annotations

import time
from pathlib import Path

from ..base import (
    CrawlResult,
    CrawlHistory,
    clean_filename,
    is_after,
    make_filename,
    parse_date,
)

SOURCE = "law_center"
BASE = "https://www.law.go.kr"
LATEST_LAWS_URL = f"{BASE}/lsSc.do?menuId=1&subMenuId=23&tabMenuId=121"
ADM_RULES_URL = f"{BASE}/admRulSc.do?menuId=5&subMenuId=45&tabMenuId=203"


def _crawl_law_list(
    list_url: str,
    out_dir: Path,
    since_date: str | None,
    history: CrawlHistory,
    page,
    kind: str,
    max_pages: int = 5,
) -> list[CrawlResult]:
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[CrawlResult] = []
    posts: list[dict] = []

    for page_num in range(1, max_pages + 1):
        url = f"{list_url}&pageIndex={page_num}"
        try:
            page.goto(url, timeout=20000)
            page.wait_for_selector("table tbody tr, .lawListTable tr", timeout=10000)
            time.sleep(1)
        except Exception:
            break

        rows = page.query_selector_all("table tbody tr, .lawListTable tr")
        any_added = False
        for row in rows:
            try:
                title_link = row.query_selector("a")
                if not title_link:
                    continue
                title = title_link.inner_text().strip()
                if not title or len(title) < 3:
                    continue
                href = title_link.get_attribute("href") or ""
                full_url = href if href.startswith("http") else (BASE + href)

                text = row.inner_text()
                date = parse_date(text)
                if not is_after(date, since_date):
                    continue
                hist_key = f"{SOURCE}_{kind}_{date}_{clean_filename(title, 50)}"
                if history.has(hist_key):
                    continue
                posts.append({
                    "title": title, "date": date, "url": full_url,
                    "hist_key": hist_key,
                })
                any_added = True
            except Exception:
                continue
        if not any_added and page_num > 1:
            break

    for post in posts:
        try:
            page.goto(post["url"], timeout=15000)
            time.sleep(1)
            # 본문 영역 (iframe 가능성)
            body = ""
            try:
                body_el = page.query_selector(
                    "#contentBody, .conScroll, .contentBox, #lawmunCont"
                )
                if body_el:
                    body = body_el.inner_text().strip()
            except Exception:
                pass

            if not body:
                # iframe
                frames = page.frames
                for f in frames:
                    try:
                        body_el = f.query_selector("body")
                        if body_el:
                            text = body_el.inner_text().strip()
                            if len(text) > 100:
                                body = text
                                break
                    except Exception:
                        continue

            out_path = out_dir / make_filename(post["date"], post["title"], ".md")
            if not out_path.exists():
                out_path.write_text(f"# {post['title']}\n\n{body}", encoding="utf-8")
                results.append(CrawlResult(
                    source=SOURCE, title=post["title"], date=post["date"],
                    url=post["url"], out_path=out_path,
                ))
            history.add(post["hist_key"])
            time.sleep(0.6)
        except Exception as e:
            print(f"  ⚠️ law_center 상세 실패 {post['title']}: {e}")

    return results


def crawl_latest_laws(out_dir, since_date, history, page):
    return _crawl_law_list(LATEST_LAWS_URL, out_dir, since_date, history, page, "law")


def crawl_adm_rules(out_dir, since_date, history, page):
    return _crawl_law_list(ADM_RULES_URL, out_dir, since_date, history, page, "admrule")


def crawl(out_dir, since_date, history, page):
    """법령정보센터 전체 (최신법령 + 행정규칙)."""
    results = []
    print(f"\n[{SOURCE}] 최신법령 크롤링...")
    results.extend(crawl_latest_laws(out_dir, since_date, history, page))
    print(f"\n[{SOURCE}] 행정규칙 크롤링...")
    results.extend(crawl_adm_rules(out_dir, since_date, history, page))
    return results
