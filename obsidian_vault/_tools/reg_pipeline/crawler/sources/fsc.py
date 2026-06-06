"""금융위원회 (FSC) — 비조치의견서 + 보도자료.

비조치의견서는 better.fsc.go.kr (FSC 운영) 도메인.
"""

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

SOURCE = "fsc"
NO_ACTION_URL = "https://better.fsc.go.kr/fsc_new/replyCase/OpinionList.do?stNo=11&muNo=86&muGpNo=75"
PRESS_URL = "https://www.fsc.go.kr/no010101"


def crawl_no_action(
    out_dir: Path,
    since_date: str | None,
    history: CrawlHistory,
    page,
    max_pages: int = 5,
) -> list[CrawlResult]:
    """비조치의견서 (better.fsc.go.kr)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[CrawlResult] = []
    posts: list[dict] = []

    for page_num in range(1, max_pages + 1):
        url = f"{NO_ACTION_URL}&curPage={page_num}"
        try:
            page.goto(url, timeout=20000)
            page.wait_for_selector("tbody tr", timeout=10000)
            time.sleep(1)
        except Exception:
            break

        rows = page.query_selector_all("tbody tr")
        any_added = False
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 4:
                continue
            title_link = row.query_selector(
                "td.subjectw a, td.subject a, td.align_l a, td a"
            )
            if not title_link:
                continue
            try:
                title = title_link.inner_text().strip()
                onclick = title_link.get_attribute("onclick") or ""
                case_id = ""
                m = re.search(r"fn_detail\s*\(\s*['\"]([^'\"]+)['\"]", onclick)
                if m:
                    case_id = m.group(1)
                date = parse_date(tds[3].inner_text().strip())
                if not is_after(date, since_date):
                    continue
                hist_key = f"{SOURCE}_noaction_{date}_{case_id or clean_filename(title, 50)}"
                if history.has(hist_key):
                    continue
                posts.append({
                    "title": title, "date": date, "case_id": case_id,
                    "hist_key": hist_key, "list_url": url,
                })
                any_added = True
            except Exception:
                continue
        if not any_added:
            break

    # 상세 — 행 클릭 후 텍스트 스크랩
    for post in posts:
        try:
            page.goto(post["list_url"])
            page.wait_for_selector("tbody")
            time.sleep(0.8)
            items = page.query_selector_all("tbody tr td a")
            clicked = False
            for item in items:
                if post["case_id"] and post["case_id"] in (item.get_attribute("onclick") or ""):
                    item.click()
                    clicked = True
                    break
                if not post["case_id"] and post["title"] in item.inner_text():
                    item.click()
                    clicked = True
                    break
            if not clicked:
                continue

            page.wait_for_selector(".view_type1, table", timeout=10000)
            time.sleep(0.5)

            details: dict[str, str] = {}
            ths = page.query_selector_all("th")
            for th in ths:
                try:
                    label = th.inner_text().strip()
                    td = page.evaluate_handle(
                        "el => el.nextElementSibling", th
                    ).as_element()
                    if td:
                        details[label] = td.inner_text().strip()
                except Exception:
                    continue

            body = f"""# {post['title']}

## 관련 법령
{details.get('관련법령', '')}

## 요청 요지
{details.get('요청요지', '')}

## 회신 내용
{details.get('회신요지', '')}
"""
            out_path = out_dir / make_filename(post["date"], post["title"], ".md")
            if not out_path.exists():
                out_path.write_text(body, encoding="utf-8")
                results.append(CrawlResult(
                    source=SOURCE, title=post["title"], date=post["date"],
                    url=post["list_url"], out_path=out_path,
                ))
            history.add(post["hist_key"])
            time.sleep(0.6)
        except Exception as e:
            print(f"  ⚠️ FSC noaction 상세 실패: {e}")

    return results


def crawl_press(
    out_dir: Path,
    since_date: str | None,
    history: CrawlHistory,
    page,
    max_pages: int = 5,
) -> list[CrawlResult]:
    """금융위 보도자료.

    FSC 새 구조 (2026):
      - 목록 .subject 안 a 태그로 상세 진입 (/no010101/{ID})
      - 상세 페이지에 본문 + 첨부파일 (PDF/HWP/HWPX 함께)
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[CrawlResult] = []

    # 1) 목록 수집
    posts: list[dict] = []
    for page_num in range(1, max_pages + 1):
        url = f"{PRESS_URL}?srchCtgry=&curPage={page_num}&srchKey=&srchText=&srchBeginDt=&srchEndDt="
        try:
            page.goto(url, timeout=20000)
            page.wait_for_selector(".subject", timeout=10000)
            time.sleep(1)
        except Exception:
            break

        subjects = page.query_selector_all(".subject")
        any_added = False
        for subj in subjects:
            try:
                link = subj.query_selector("a")
                if not link:
                    continue
                title = link.inner_text().strip()
                href = link.get_attribute("href") or ""
                if not href or href.startswith("javascript"):
                    continue
                full_url = href if href.startswith("http") else f"https://www.fsc.go.kr{href}"

                # 같은 .cont 컨테이너 텍스트에서 날짜 추출 (첨부파일명에 YYMMDD 포함)
                cont = subj.evaluate_handle(
                    "e => e.closest('.cont') || e.parentElement"
                ).as_element()
                cont_text = (cont.inner_text() if cont else title)
                date = parse_date(cont_text)
                if not date:
                    # 6자리 패턴 (YYMMDD)
                    import re as _re
                    m = _re.search(r"\b(2[0-9])(\d{2})(\d{2})\b", cont_text)
                    if m:
                        date = "20" + m.group(1) + m.group(2) + m.group(3)
                if not is_after(date, since_date):
                    continue

                hist_key = f"{SOURCE}_press_{date}_{clean_filename(title, 50)}"
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

    # 2) 상세 진입 → 본문 + 첨부
    for post in posts:
        try:
            page.goto(post["url"], timeout=15000)
            page.wait_for_load_state("domcontentloaded", timeout=10000)
            time.sleep(1)

            # 첨부파일 (PDF > Word > HWP 우선순위)
            attach_results = download_attachments_with_priority(
                page=page, out_dir=out_dir,
                source=SOURCE, title=post["title"], date=post["date"],
                list_url=post["url"],
                attach_selectors=[
                    "a[href*='/comm/getFile']",
                    "a[href*='download']",
                    "a[onclick*='download']",
                    ".file_area a",
                ],
            )
            results.extend(attach_results)

            # 첨부가 없을 때만 본문 .md 저장 (PDF 있으면 변환 단계에서 처리)
            if not attach_results:
                body = ""
                for sel in [".bd-view", ".content", ".view", ".bbs_view", ".sub_cont"]:
                    body_el = page.query_selector(sel)
                    if body_el:
                        body = body_el.inner_text().strip()
                        if body and len(body) > 30:
                            break
                out_path = out_dir / make_filename(post["date"], post["title"], ".md")
                if not out_path.exists() and body:
                    out_path.write_text(f"# {post['title']}\n\n{body}", encoding="utf-8")
                    results.append(CrawlResult(
                        source=SOURCE, title=post["title"], date=post["date"],
                        url=post["url"], out_path=out_path,
                    ))
            history.add(post["hist_key"])
            time.sleep(0.6)
        except Exception as e:
            print(f"  ⚠️ FSC press 상세 실패 {post['title']}: {e}")

    return results


def crawl(out_dir, since_date, history, page):
    """FSC 일배치 (v1: 보도자료만).

    비조치의견서는 검색 트리거 필요 (JS 동적) → v2에서 추가.
    """
    print(f"\n[{SOURCE}] 보도자료 크롤링...")
    return crawl_press(out_dir, since_date, history, page)
