"""금융감독원 (FSS) — 행정지도 + 감독행정."""

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

SOURCE = "fss"
BASE = "https://www.fss.or.kr"
GUIDANCE_URL = f"{BASE}/fss/job/admnstgudc/list.do?menuNo=200492"
SUPERVISION_URL = f"{BASE}/fss/job/admnstgudcDtls/list.do?menuNo=200494"


def _crawl_fss_board(
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
            page.wait_for_selector("tbody tr", timeout=10000)
        except Exception:
            break

        rows = page.query_selector_all("tbody tr")
        any_added = False
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 5:
                continue
            title_link = row.query_selector("td.title a")
            if not title_link:
                continue
            try:
                title = title_link.inner_text().strip()
                href = title_link.get_attribute("href") or ""
                full_url = href if href.startswith("http") else (
                    BASE + href if href.startswith("/") else
                    f"{BASE}/fss/job/{kind}/" + href
                )
                date = parse_date(tds[3].inner_text().strip())
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
        if not any_added:
            break

    for post in posts:
        try:
            page.goto(post["url"], timeout=15000)
            page.wait_for_selector(".bd-view, .b-file, table", timeout=10000)
            time.sleep(0.8)

            dl_links = page.query_selector_all(
                "a[href*='download'], .b-file a"
            )
            downloaded = 0
            for link in dl_links:
                href_attr = link.get_attribute("href") or ""
                if "javascript" in href_attr and "down" not in href_attr.lower():
                    continue
                try:
                    with page.expect_download(timeout=12000) as dl_info:
                        link.click()
                    dl = dl_info.value
                    safe = clean_filename(f"{post['date']}_{dl.suggested_filename}")
                    out_path = out_dir / safe
                    if out_path.exists():
                        continue
                    dl.save_as(str(out_path))
                    downloaded += 1
                    results.append(CrawlResult(
                        source=SOURCE, title=post["title"],
                        date=post["date"], url=post["url"], out_path=out_path,
                    ))
                except Exception:
                    continue

            if downloaded == 0:
                # 본문만 .md
                out_path = out_dir / make_filename(post["date"], post["title"], ".md")
                if not out_path.exists():
                    try:
                        body_el = page.query_selector(".bd-view, .content")
                        body = body_el.inner_text().strip() if body_el else ""
                    except Exception:
                        body = ""
                    out_path.write_text(f"# {post['title']}\n\n{body}", encoding="utf-8")
                    results.append(CrawlResult(
                        source=SOURCE, title=post["title"],
                        date=post["date"], url=post["url"], out_path=out_path,
                    ))

            history.add(post["hist_key"])
            time.sleep(0.6)
        except Exception as e:
            print(f"  ⚠️ FSS 상세 실패 {post['title']}: {e}")

    return results


def crawl_guidance(out_dir, since_date, history, page):
    return _crawl_fss_board(GUIDANCE_URL, out_dir, since_date, history, page, "admnstgudc")


def crawl_supervision(out_dir, since_date, history, page):
    return _crawl_fss_board(SUPERVISION_URL, out_dir, since_date, history, page, "admnstgudcDtls")


def crawl(out_dir, since_date, history, page):
    """FSS 전체 (행정지도 + 감독행정)."""
    results = []
    print(f"\n[{SOURCE}] 행정지도 크롤링...")
    results.extend(crawl_guidance(out_dir, since_date, history, page))
    print(f"\n[{SOURCE}] 감독행정 크롤링...")
    results.extend(crawl_supervision(out_dir, since_date, history, page))
    return results
