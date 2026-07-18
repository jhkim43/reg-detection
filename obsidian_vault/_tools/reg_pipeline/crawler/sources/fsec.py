"""금융보안원 (FSEC) — 가이드라인 + 보도자료.

URLs:
  guidelines: https://www.fsec.or.kr/bbs/222
  press:      https://www.fsec.or.kr/bbs/69

공통 패턴:
  1) 목록에서 onclick="moveToBbsDetail(N)" 추출
  2) 각 상세 진입 → 본문 .md 저장 + 첨부파일(PDF/HWP) 다운로드
  3) since_date 이후만 + history 중복 방지
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
    select_best_attachment_per_stem,
    has_allowed_extension,
)

SOURCE = "fsec"
PRESS_URL = "https://www.fsec.or.kr/bbs/69"
GUIDE_URL = "https://www.fsec.or.kr/bbs/222"


def _extract_title_and_date(text: str) -> tuple[str, str]:
    """목록 항목 inner_text → (title, date YYYYMMDD)."""
    # 텍스트 패턴: "제목 | N기획부YYYY-MM-DD | 본문..."
    parts = [p.strip() for p in text.split("|") if p.strip()]
    title = parts[0] if parts else text.strip()[:80]
    date = parse_date(text)
    return title, date


def _save_detail(
    page,
    out_dir: Path,
    source: str,
    title: str,
    date: str,
    kind: str,
    list_url: str,
) -> list[CrawlResult]:
    """상세 페이지 진입한 상태에서 본문 + 첨부 저장."""
    results: list[CrawlResult] = []

    # 1) 본문 저장
    body = ""
    for sel in [".board_view", ".view_cont", ".bd-view", ".content", ".bbs_view"]:
        body_el = page.query_selector(sel)
        if body_el:
            body = body_el.inner_text().strip()
            if body and len(body) > 30:
                break

    if body:
        body_name = make_filename(date, title, ".md")
        body_path = out_dir / body_name
        if not body_path.exists():
            body_path.write_text(f"# {title}\n\n{body}", encoding="utf-8")
            results.append(CrawlResult(
                source=source, title=title, date=date,
                url=list_url, out_path=body_path,
            ))

    # 2) 첨부파일 후보 수집 (전부)
    attach_selectors = [
        "a[onclick*='downloadFile']",
        "a[href*='/uploadFile1/']",
        ".file_area a",
        ".attach a",
        ".bbsFile a",
    ]
    # FSEC는 href·onclick이 동일하고 fileNo만 attribute에 다름.
    # → dedup은 filename(inner_text) 기준으로
    candidates: list[dict] = []
    seen_names = set()
    for sel in attach_selectors:
        for link in page.query_selector_all(sel):
            try:
                file_name = link.inner_text().strip()
                if not file_name or len(file_name) < 3:
                    continue
                # 허용 확장자만 수집 (PDF/JSON/HWP/HWPX/DOCX/DOC)
                if not has_allowed_extension(file_name):
                    continue
                if file_name in seen_names:
                    continue
                seen_names.add(file_name)
                candidates.append({
                    "link": link,
                    "name": file_name,
                })
            except Exception:
                continue

    # 같은 stem 그룹에서 PDF > Word > HWP 우선순위로 1개만 선택
    selected = select_best_attachment_per_stem(candidates)

    for cand in selected:
        try:
            safe = clean_filename(cand["name"], max_len=120)
            attach_name = f"{date}_{safe}" if date else safe
            attach_path = out_dir / attach_name
            if attach_path.exists():
                continue
            with page.expect_download(timeout=15000) as dl_info:
                cand["link"].click()
            download = dl_info.value
            download.save_as(str(attach_path))
            results.append(CrawlResult(
                source=source, title=safe, date=date,
                url=list_url, out_path=attach_path,
            ))
        except Exception:
            continue

    return results


def _crawl_fsec_board(
    list_url: str,
    out_dir: Path,
    since_date: str | None,
    history: CrawlHistory,
    page,
    kind: str,
    max_expand: int = 8,
    max_pages: int = 5,
) -> list[CrawlResult]:
    """FSEC 게시판 통합 크롤러 (보도자료/가이드라인).

    Args:
        kind: 'press' | 'guide' (history key 구분)
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[CrawlResult] = []

    page.goto(list_url, wait_until="networkidle", timeout=60000)
    time.sleep(2)

    # "더보기" 또는 페이지네이션
    if kind == "press":
        # 보도자료: "더보기" 확장
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

    # 목록 항목 (onclick="moveToBbsDetail(N)" 패턴)
    items = page.query_selector_all("[class*=board] li, .boardGallery li")
    posts: list[dict] = []
    for item in items:
        try:
            onclick = item.get_attribute("onclick") or ""
            m = re.search(r"moveToBbsDetail\((\d+)\)", onclick)
            if not m:
                continue
            bbs_id = m.group(1)

            text = item.inner_text().strip()
            if len(text) < 20:
                continue

            title, date = _extract_title_and_date(text)
            if not is_after(date, since_date):
                continue
            history_key = f"{SOURCE}_{kind}_{date}_{bbs_id}"
            if history.has(history_key):
                continue

            posts.append({
                "title": title, "date": date, "bbs_id": bbs_id,
                "history_key": history_key,
            })
        except Exception:
            continue

    # 각 상세 진입
    for post in posts:
        try:
            page.evaluate(f"moveToBbsDetail({post['bbs_id']})")
            page.wait_for_load_state("domcontentloaded", timeout=15000)
            time.sleep(1.5)

            detail_results = _save_detail(
                page=page,
                out_dir=out_dir,
                source=SOURCE,
                title=post["title"],
                date=post["date"],
                kind=kind,
                list_url=list_url,
            )
            results.extend(detail_results)
            history.add(post["history_key"])

            # 목록으로 돌아가기
            try:
                page.go_back(timeout=8000)
                page.wait_for_load_state("domcontentloaded", timeout=8000)
                time.sleep(0.8)
            except Exception:
                page.goto(list_url, wait_until="domcontentloaded", timeout=15000)
                time.sleep(1)
        except Exception as e:
            print(f"  ⚠️ FSEC {kind} bbs_id={post['bbs_id']} 실패: {e}")
            try:
                page.goto(list_url, wait_until="domcontentloaded", timeout=15000)
                time.sleep(1.5)
            except Exception:
                pass

    return results


def crawl_press(out_dir, since_date, history, page):
    return _crawl_fsec_board(PRESS_URL, out_dir, since_date, history, page, "press")


def crawl_guidelines(out_dir, since_date, history, page):
    return _crawl_fsec_board(GUIDE_URL, out_dir, since_date, history, page, "guide")


def crawl(out_dir, since_date, history, page):
    """FSEC 전체 (가이드라인 + 보도자료)."""
    results = []
    print(f"\n[{SOURCE}] 가이드라인 크롤링...")
    results.extend(crawl_guidelines(out_dir, since_date, history, page))
    print(f"\n[{SOURCE}] 보도자료 크롤링...")
    results.extend(crawl_press(out_dir, since_date, history, page))
    return results
