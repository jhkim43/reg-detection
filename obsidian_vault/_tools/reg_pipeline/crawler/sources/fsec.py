"""금융보안원 (FSEC) — 가이드라인 + 보도자료.

URLs:
  guidelines: https://www.fsec.or.kr/bbs/222
  press:      https://www.fsec.or.kr/bbs/69

가이드라인: 페이지네이션 openSearch(i) JS → 상세 진입 → 첨부파일 다운
보도자료: "더보기" 버튼으로 확장 → 본문 텍스트만 .md로 저장
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
)

SOURCE = "fsec"
PRESS_URL = "https://www.fsec.or.kr/bbs/69"
GUIDE_URL = "https://www.fsec.or.kr/bbs/222"


def crawl_press(
    out_dir: Path,
    since_date: str | None,
    history: CrawlHistory,
    page,
    max_expand: int = 10,
) -> list[CrawlResult]:
    """보도자료 크롤링 (본문 텍스트만 .md로)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[CrawlResult] = []

    page.goto(PRESS_URL, wait_until="networkidle", timeout=60000)
    time.sleep(2)

    # "더보기" 클릭으로 페이지 확장
    for _ in range(max_expand):
        more_btns = page.query_selector_all("button.btnMore, .btnMore, .more")
        clicked = False
        for btn in more_btns:
            try:
                if btn.is_visible():
                    btn.click()
                    time.sleep(1.5)
                    clicked = True
                    break
            except Exception:
                continue
        if not clicked:
            break

    items = page.query_selector_all('xpath=//div[contains(@class, "board")]//li')
    for item in items:
        try:
            text = item.inner_text().strip()
            if len(text) < 20:
                continue

            date = parse_date(text)
            if not is_after(date, since_date):
                continue

            # 제목 추출 (첫 줄)
            lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
            title = re.sub(r"^제목\s*[:：]\s*", "", lines[0], flags=re.IGNORECASE)
            history_key = f"{SOURCE}_press_{date}_{clean_filename(title, 50)}"
            if history.has(history_key):
                continue

            out_name = make_filename(date, title, ".md")
            out_path = out_dir / out_name
            out_path.write_text(f"# {title}\n\n{text}", encoding="utf-8")

            history.add(history_key)
            results.append(CrawlResult(
                source=SOURCE,
                title=title,
                date=date,
                url=PRESS_URL,
                out_path=out_path,
            ))
        except Exception as e:
            print(f"  ⚠️ FSEC press 항목 처리 실패: {e}")
            continue

    return results


def crawl_guidelines(
    out_dir: Path,
    since_date: str | None,
    history: CrawlHistory,
    page,
    max_pages: int = 5,
) -> list[CrawlResult]:
    """가이드라인 — 첨부파일 다운로드."""
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[CrawlResult] = []

    page.goto(GUIDE_URL, wait_until="domcontentloaded", timeout=60000)
    time.sleep(2)

    for page_num in range(1, max_pages + 1):
        if page_num > 1:
            try:
                page.evaluate(f"openSearch({page_num})")
                time.sleep(2)
            except Exception:
                break

        items = page.query_selector_all(".boardGallery li")
        if not items:
            break

        # 상세 진입 ID 수집
        tasks: list[tuple[str, str]] = []
        for item in items:
            date_el = item.query_selector(".date")
            date = parse_date(date_el.inner_text() if date_el else "")
            if not is_after(date, since_date):
                continue
            onclick = item.get_attribute("onclick") or ""
            m = re.search(r"(\d+)", onclick)
            if m:
                tasks.append((m.group(1), date))

        for bbs_id, date in tasks:
            try:
                page.evaluate(f"moveToBbsDetail({bbs_id})")
                page.wait_for_load_state("domcontentloaded", timeout=15000)
                time.sleep(1.5)

                # 첨부파일 링크
                links = page.query_selector_all(
                    "a[onclick*='downloadFile'], a[href*='/uploadFile1/']"
                )
                for link in links:
                    file_name = link.inner_text().strip()
                    if not file_name:
                        continue
                    safe_name = clean_filename(file_name)
                    out_name = f"{date}_{safe_name}" if date else safe_name
                    out_path = out_dir / out_name

                    history_key = f"{SOURCE}_guide_{date}_{safe_name}"
                    if history.has(history_key) or out_path.exists():
                        continue

                    try:
                        with page.expect_download(timeout=15000) as dl_info:
                            link.click()
                        download = dl_info.value
                        download.save_as(str(out_path))
                        history.add(history_key)
                        results.append(CrawlResult(
                            source=SOURCE,
                            title=safe_name,
                            date=date,
                            url=GUIDE_URL,
                            out_path=out_path,
                        ))
                    except Exception as e:
                        print(f"  ⚠️ FSEC guide 다운 실패: {e}")
                        continue

                page.go_back()
                page.wait_for_load_state("domcontentloaded", timeout=10000)
                time.sleep(1)
            except Exception as e:
                print(f"  ⚠️ FSEC guide bbs_id={bbs_id} 실패: {e}")
                page.goto(GUIDE_URL)
                time.sleep(2)
                if page_num > 1:
                    try:
                        page.evaluate(f"openSearch({page_num})")
                    except Exception:
                        pass

    return results


def crawl(
    out_dir: Path,
    since_date: str | None,
    history: CrawlHistory,
    page,
) -> list[CrawlResult]:
    """FSEC 전체 (가이드라인 + 보도자료)."""
    results = []
    print(f"\n[{SOURCE}] 가이드라인 크롤링...")
    results.extend(crawl_guidelines(out_dir, since_date, history, page))
    print(f"\n[{SOURCE}] 보도자료 크롤링...")
    results.extend(crawl_press(out_dir, since_date, history, page))
    return results
