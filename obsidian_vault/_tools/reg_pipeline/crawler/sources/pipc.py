"""개인정보보호위원회 (PIPC) — 안내서 + 보도자료."""

from __future__ import annotations

import re
import time
from pathlib import Path

from ..base import (
    CrawlResult,
    CrawlHistory,
    clean_filename,
    is_after,
    make_filename,
    parse_date,
    download_attachments_with_priority,
)

# PIPC onclick 패턴: javascript:fn_egov_downFile('FILE_xxx','N','pdf')
# 마지막 인용 인자가 확장자
_PIPC_EXT_RE = re.compile(r"['\"](\w{2,5})['\"]\s*\)\s*$")

SOURCE = "pipc"
BASE = "https://www.pipc.go.kr"
GUIDE_URL = f"{BASE}/np/cop/bbs/selectBoardList.do?bbsId=BS217&mCode=D010030000"
PRESS_URL = f"{BASE}/np/cop/bbs/selectBoardList.do?bbsId=BS074&mCode=C020010000"


def _crawl_pipc_board(
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
            page.wait_for_selector("table.board tbody tr, table tbody tr", timeout=10000)
        except Exception:
            break

        rows = page.query_selector_all("table.board tbody tr, table tbody tr")
        page_posts: list[dict] = []
        for row in rows:
            try:
                title_link = row.query_selector(
                    "td.subject a, td.title a, td a[href*='selectBoardArticle.do']"
                )
                if not title_link:
                    continue
                title = title_link.inner_text().strip()
                href = title_link.get_attribute("href") or ""
                full_url = href if href.startswith("http") else (
                    BASE + href if href.startswith("/") else
                    BASE + "/np/cop/bbs/" + href.lstrip("./")
                )
                # 날짜 — 행 내 임의 셀에서 추출
                date = ""
                for td in row.query_selector_all("td"):
                    d = parse_date(td.inner_text().strip())
                    if d:
                        date = d
                        break
                if not is_after(date, since_date):
                    continue
                hist_key = f"{SOURCE}_{kind}_{date}_{clean_filename(title, 50)}"
                if history.has(hist_key):
                    continue
                page_posts.append({
                    "title": title,
                    "date": date,
                    "url": full_url,
                    "hist_key": hist_key,
                })
            except Exception:
                continue

        if not page_posts:
            break
        posts.extend(page_posts)

    # 상세 페이지 진입 — 첨부파일 다운
    for post in posts:
        try:
            page.goto(post["url"], timeout=15000)
            page.wait_for_selector("table", timeout=10000)
            time.sleep(1)

            # PDF > Word > HWP 우선순위 + 확장자 필터
            # PIPC anchor text는 "다운로드"이므로 onclick에서 확장자 추출
            attach_results = download_attachments_with_priority(
                page=page,
                out_dir=out_dir,
                source=SOURCE,
                title=post["title"],
                date=post["date"],
                list_url=post["url"],
                attach_selectors=[
                    "a[onclick*='downFile']",
                    "a[onclick*='FileDown']",
                ],
                ext_from_onclick=_PIPC_EXT_RE,
                fallback_stem=clean_filename(post["title"], 80),
                dedup_by="onclick",
            )
            results.extend(attach_results)
            downloaded = len(attach_results)

            # 첨부 없으면 본문만 .md로
            if downloaded == 0:
                out_path = out_dir / make_filename(post["date"], post["title"], ".md")
                if not out_path.exists():
                    body = ""
                    try:
                        content_el = page.query_selector(".board_view, .view_cont, .content")
                        if content_el:
                            body = content_el.inner_text().strip()
                    except Exception:
                        pass
                    out_path.write_text(
                        f"# {post['title']}\n\n{body}", encoding="utf-8"
                    )
                    results.append(CrawlResult(
                        source=SOURCE,
                        title=post["title"],
                        date=post["date"],
                        url=post["url"],
                        out_path=out_path,
                    ))

            history.add(post["hist_key"])
            time.sleep(0.8)
        except Exception as e:
            print(f"  ⚠️ PIPC 상세 실패 {post['title']}: {e}")

    return results


def crawl_guidelines(out_dir, since_date, history, page):
    return _crawl_pipc_board(GUIDE_URL, out_dir, since_date, history, page, "guide")


def crawl_press(out_dir, since_date, history, page):
    return _crawl_pipc_board(PRESS_URL, out_dir, since_date, history, page, "press")


def crawl(out_dir, since_date, history, page):
    """PIPC 전체 (안내서 + 보도자료)."""
    results = []
    print(f"\n[{SOURCE}] 안내서 크롤링...")
    results.extend(crawl_guidelines(out_dir, since_date, history, page))
    print(f"\n[{SOURCE}] 보도자료 크롤링...")
    results.extend(crawl_press(out_dir, since_date, history, page))
    return results
