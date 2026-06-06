import os
import sys
import json
import re
import time
import urllib.parse
from pathlib import Path
import subprocess
from playwright.sync_api import sync_playwright
import struct

# Configuration
RAW_DIR = Path("raw_sources_260604")
WIKI_DIR = Path("wiki_raw_260604")
HISTORY_FILE = Path("crawler_history_260604.json")

RAW_DIR.mkdir(exist_ok=True)
WIKI_DIR.mkdir(exist_ok=True)

# Load History
if HISTORY_FILE.exists():
    with open(HISTORY_FILE, "r", encoding="utf-8") as f:
        history = json.load(f)
else:
    history = {}


def save_history():
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def clean_filename(name):
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    return name.strip()


def extract_hwp_text_pure(file_path):
    """Pure Python HWP (v5) text extractor using olefile and zlib."""
    import olefile
    import zlib

    if not olefile.isOleFile(file_path):
        return None

    try:
        ole = olefile.OleFileIO(file_path)
        sections = []
        for path in ole.listdir():
            if len(path) >= 2 and path[0] == "BodyText" and path[1].startswith("Section"):
                sections.append(path)
        sections.sort()

        paragraphs = []
        for section in sections:
            stream = ole.openstream(section)
            data = stream.read()
            try:
                decompressed = zlib.decompress(data, -15)
            except Exception:
                try:
                    decompressed = zlib.decompress(data)
                except Exception:
                    decompressed = data

            offset = 0
            length = len(decompressed)
            while offset < length:
                if offset + 4 > length:
                    break
                header = struct.unpack_from("<I", decompressed, offset)[0]
                offset += 4

                tag_id = header & 0x3FF
                level = (header >> 10) & 0x3FF
                size = (header >> 20) & 0xFFF

                if size == 0xFFF:
                    if offset + 4 > length:
                        break
                    size = struct.unpack_from("<I", decompressed, offset)[0]
                    offset += 4

                if offset + size > length:
                    break

                record_data = decompressed[offset : offset + size]
                offset += size

                if tag_id == 67:  # HWPTAG_PARA_TEXT
                    try:
                        text_str = record_data.decode("utf-16le", errors="ignore")
                        # Clean control characters and structural noise
                        clean_chars = []
                        i = 0
                        while i < len(text_str):
                            c = text_str[i]
                            val = ord(c)
                            if 1 <= val <= 31:
                                if val in [9, 10, 13]:
                                    clean_chars.append(c)
                            elif 0x4E00 <= val <= 0x9FFF:
                                # Filter out structural junk double-bytes if they match section headers
                                if val not in [0x6364, 0x7365, 0x746F, 0x6F63, 0x6C20, 0x7462, 0x6E70, 0x6770]:
                                    clean_chars.append(c)
                            else:
                                clean_chars.append(c)
                            i += 1
                        paragraph_text = "".join(clean_chars).strip()
                        if paragraph_text:
                            paragraphs.append(paragraph_text)
                    except Exception:
                        pass
        return "\n\n".join(paragraphs)
    except Exception as e:
        print(f"  [Convert] Pure python HWP extraction failed: {e}")
        return None


def extract_hwpx_text_pure(file_path):
    """Pure Python HWPX text extractor using zipfile and xml parsing."""
    import zipfile
    import xml.etree.ElementTree as ET

    try:
        with zipfile.ZipFile(file_path) as z:
            text_parts = []
            section_files = sorted(
                [
                    f
                    for f in z.namelist()
                    if f.startswith("Contents/section") and f.endswith(".xml")
                ]
            )
            for sf in section_files:
                xml_content = z.read(sf)
                root = ET.fromstring(xml_content)
                for elem in root.iter():
                    if elem.tag.endswith("}t") or elem.tag == "t":
                        if elem.text:
                            text_parts.append(elem.text.strip())
            return "\n\n".join([p for p in text_parts if p])
    except Exception as e:
        print(f"  [Convert] Pure python HWPX extraction failed: {e}")
        return None


def convert_hwp_to_md(hwp_path, md_path, frontmatter):
    """Converts HWP/HWPX files to Markdown using hwp2md tool, falling back to pure Python."""
    # Attempt hwp2md first
    try:
        temp_md = Path("temp_hwp_output.md")
        if temp_md.exists():
            temp_md.unlink()

        print(f"  [Convert] Converting {hwp_path.name} using hwp2md...")
        result = subprocess.run(
            ["hwp2md", "convert", str(hwp_path), str(temp_md)],
            capture_output=True,
            text=True,
        )

        if temp_md.exists():
            with open(temp_md, "r", encoding="utf-8") as f:
                content = f.read()
            temp_md.unlink()

            with open(md_path, "w", encoding="utf-8") as f:
                f.write(frontmatter + "\n\n" + content)
            print(f"  [Convert] Successfully converted and saved to {md_path.name}")
            return True
        else:
            print(f"  [Convert] hwp2md was not successful. Using pure-Python fallback...")
    except Exception as e:
        print(f"  [Convert] hwp2md failed or not found ({e}). Using pure-Python fallback...")

    # Python-based fallbacks
    extracted_text = None
    if hwp_path.suffix.lower() == ".hwp":
        extracted_text = extract_hwp_text_pure(hwp_path)
    elif hwp_path.suffix.lower() == ".hwpx":
        extracted_text = extract_hwpx_text_pure(hwp_path)

    if extracted_text:
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(frontmatter + "\n\n" + extracted_text)
        print(f"  [Convert] Successfully extracted text using pure Python and saved to {md_path.name}")
        return True

    # Ultimate fallback: Reference file
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(
            frontmatter
            + f"\n\n(HWP/HWPX file downloaded to raw_sources. Conversion failed or pending manual review.)"
        )
    return False


def save_pdf_entry(pdf_path, md_path, frontmatter):
    """Creates a basic Markdown file in Obsidian pointing to the downloaded PDF."""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(
            frontmatter
            + f"\n\nPDF 문서가 다운로드되었습니다.\n\n파일 경로: `raw_sources/{pdf_path.name}`"
        )
    print(f"  [Obsidian] PDF entry created: {md_path.name}")


# --- Crawler Implementations ---


def crawl_fss_guidance(page, limit_pages=10):
    """1. 금융감독원 행정지도"""
    print("\n=== Start: 금융감독원 행정지도 ===")
    base_url = "https://www.fss.or.kr"
    posts = []

    for cur_page in range(1, limit_pages + 1):
        list_url = f"{base_url}/fss/job/admnstgudc/list.do?menuNo=200492&pageIndex={cur_page}"
        print(f"  Scraping pageIndex={cur_page} from {list_url}")
        page.goto(list_url)
        try:
            page.wait_for_selector("tbody", timeout=10000)
        except Exception:
            print(f"    Timeout waiting for list on page {cur_page}. Stopping.")
            break

        rows = page.query_selector_all("tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 5:
                continue
            title_link = row.query_selector("td.title a")
            if not title_link:
                continue

            title = title_link.inner_text().strip()
            href = title_link.get_attribute("href")
            date_str = tds[3].inner_text().strip().replace("-", "")  # 시행일

            full_url = href if href.startswith("http") else (base_url + href if href.startswith("/") else base_url + "/fss/job/admnstgudc/" + href)
            page_posts.append(
                {
                    "title": title,
                    "url": full_url,
                    "date": date_str,
                    "id": f"fss_guide_{date_str}_{clean_filename(title)}",
                }
            )
        print(f"    Found {len(page_posts)} articles on page {cur_page}.")
        if not page_posts:
            break
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue

        print(f"  Processing: {post['title']} ({post['date']})")
        try:
            page.goto(post["url"])
            page.wait_for_selector(".bd-view")

                                                                # Find download links
            download_links = page.query_selector_all(
                "a[href*='download'], a[href*='download'] span, .b-file a"
            )
            downloaded_files = []

            processed_hrefs = set()

            for dl in download_links:
                href_attr = dl.get_attribute("href") or ""
                if "javascript" in href_attr and "down" not in href_attr.lower():
                    continue
                if href_attr in processed_hrefs:
                    continue

                processed_hrefs.add(href_attr)

                # Wait for download event
                try:
                    with page.expect_download(timeout=10000) as download_info:
                        dl.click()
                    download = download_info.value
                    filename = clean_filename(
                        f"{post['date']}_{download.suggested_filename}"
                    )
                    save_path = RAW_DIR / filename
                    download.save_as(save_path)
                    downloaded_files.append(save_path)
                    print(f"    Downloaded attachment: {filename}")
                except Exception as ex:
                    # Retry by clicking if standard download expectation fails
                    pass

            # Create Obsidian Note
            frontmatter = f"---\ntitle: \"{post['title']}\"\ndate: {post['date']}\nsource: \"금융감독원 행정지도\"\nsource_url: \"{post['url']}\"\n---"

            for file_path in downloaded_files:
                suffix = file_path.suffix.lower()
                md_name = f"{post['date']}_{file_path.stem}.md"
                md_path = WIKI_DIR / md_name

                if suffix in [".hwp", ".hwpx"]:
                    convert_hwp_to_md(file_path, md_path, frontmatter)
                elif suffix == ".pdf":
                    save_pdf_entry(file_path, md_path, frontmatter)

            # Record in history
            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()

        except Exception as e:
            print(f"  Error processing post {post['title']}: {e}")

        # Short cooldown
        time.sleep(1)


def crawl_fss_supervision(page, limit_pages=10):
    """2. 금융감독원 감독행정"""
    print("\n=== Start: 금융감독원 감독행정 ===")
    base_url = "https://www.fss.or.kr"
    posts = []

    for cur_page in range(1, limit_pages + 1):
        list_url = f"{base_url}/fss/job/admnstgudcDtls/list.do?menuNo=200494&pageIndex={cur_page}"
        print(f"  Scraping pageIndex={cur_page} from {list_url}")
        page.goto(list_url)
        try:
            page.wait_for_selector("tbody", timeout=10000)
        except Exception:
            print(f"    Timeout waiting for list on page {cur_page}. Stopping.")
            break

        rows = page.query_selector_all("tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 5:
                continue
            title_link = row.query_selector("td.title a")
            if not title_link:
                continue

            title = title_link.inner_text().strip()
            href = title_link.get_attribute("href")
            date_str = tds[3].inner_text().strip().replace("-", "")  # 등록일/시행일

            full_url = href if href.startswith("http") else (base_url + href if href.startswith("/") else base_url + "/fss/job/admnstgudcDtls/" + href)
            page_posts.append(
                {
                    "title": title,
                    "url": full_url,
                    "date": date_str,
                    "id": f"fss_super_{date_str}_{clean_filename(title)}",
                }
            )
        print(f"    Found {len(page_posts)} articles on page {cur_page}.")
        if not page_posts:
            break
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue

        print(f"  Processing: {post['title']} ({post['date']})")
        try:
            page.goto(post["url"])
            page.wait_for_selector(".bd-view")

            # Attachment handling
            download_links = page.query_selector_all(".b-file a, a[href*='download']")
            downloaded_files = []

            for dl in download_links:
                href_attr = dl.get_attribute("href") or ""
                if "javascript" in href_attr:
                    continue

                try:
                    with page.expect_download(timeout=10000) as download_info:
                        dl.click()
                    download = download_info.value
                    filename = clean_filename(
                        f"{post['date']}_{download.suggested_filename}"
                    )
                    save_path = RAW_DIR / filename
                    download.save_as(save_path)
                    downloaded_files.append(save_path)
                    print(f"    Downloaded attachment: {filename}")
                except Exception as ex:
                    pass

            frontmatter = f"---\ntitle: \"{post['title']}\"\ndate: {post['date']}\nsource: \"금융감독원 감독행정\"\nsource_url: \"{post['url']}\"\n---"

            for file_path in downloaded_files:
                suffix = file_path.suffix.lower()
                md_name = f"{post['date']}_{file_path.stem}.md"
                md_path = WIKI_DIR / md_name

                if suffix in [".hwp", ".hwpx"]:
                    convert_hwp_to_md(file_path, md_path, frontmatter)
                elif suffix == ".pdf":
                    save_pdf_entry(file_path, md_path, frontmatter)

            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()

        except Exception as e:
            print(f"  Error processing post {post['title']}: {e}")

        time.sleep(1)


def crawl_pipc_guidelines(page, limit_pages=10):
    """3. 개인정보보호위원회 안내서"""
    print("\n=== Start: 개인정보보호위원회 안내서 ===")
    base_url = "https://www.pipc.go.kr"
    posts = []

    for cur_page in range(1, limit_pages + 1):
        list_url = f"{base_url}/np/cop/bbs/selectBoardList.do?bbsId=BS217&mCode=D010030000&pageIndex={cur_page}"
        print(f"  Scraping pageIndex={cur_page} from {list_url}")
        page.goto(list_url)
        try:
            page.wait_for_selector("table.board, tbody", timeout=15000)
        except Exception:
            print(f"    Timeout waiting for list on page {cur_page}. Stopping.")
            break

        rows = page.query_selector_all("table.board tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 4:
                continue

            title_link = row.query_selector("td.subject a, td.title a, td a[href*='selectBoardArticle.do']")
            if not title_link:
                continue

            title = title_link.inner_text().strip()
            href = title_link.get_attribute("href") or ""

            date_str = ""
            for td in tds:
                text = td.inner_text().strip()
                if re.match(r"\d{4}-\d{2}-\d{2}", text):
                    date_str = text.replace("-", "")
                    break

            if not date_str:
                date_str = time.strftime("%Y%m%d")

            full_url = href if href.startswith("http") else (base_url + href if href.startswith("/") else (base_url + "/np/cop/bbs/" + href[2:] if href.startswith("./") else base_url + "/np/cop/bbs/" + href))
            page_posts.append(
                {
                    "title": title,
                    "url": full_url,
                    "date": date_str,
                    "id": f"pipc_{date_str}_{clean_filename(title)}",
                }
            )
        print(f"    Found {len(page_posts)} articles on page {cur_page}.")
        if not page_posts:
            break
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue

        print(f"  Processing: {post['title']} ({post['date']})")
        try:
            page.goto(post["url"])
            page.wait_for_selector("table", timeout=15000)

            # Look for attachment links
            download_links = page.query_selector_all("a[onclick*='downFile'], a[onclick*='FileDown'], a:has-text('다운로드')")
            downloaded_files = []

            for dl in download_links:
                try:
                    with page.expect_download(timeout=10000) as download_info:
                        dl.click()
                    download = download_info.value
                    filename = clean_filename(
                        f"{post['date']}_{download.suggested_filename}"
                    )
                    save_path = RAW_DIR / filename
                    download.save_as(save_path)
                    downloaded_files.append(save_path)
                    print(f"    Downloaded attachment: {filename}")
                except Exception as ex:
                    pass

            frontmatter = f"---\ntitle: \"{post['title']}\"\ndate: {post['date']}\nsource: \"개인정보보호위원회 안내서\"\nsource_url: \"{post['url']}\"\n---"

            if not downloaded_files:
                # Web fallback page creation
                md_name = f"{post['date']}_{clean_filename(post['title'])}.md"
                md_path = WIKI_DIR / md_name
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(
                        frontmatter
                        + f"\n\n본문내용이 가이드라인으로 웹상에 존재하거나 다운로드된 파일이 없습니다."
                    )
                print(f"    Created text-only Obsidian note: {md_name}")
            else:
                for file_path in downloaded_files:
                    suffix = file_path.suffix.lower()
                    md_name = f"{post['date']}_{file_path.stem}.md"
                    md_path = WIKI_DIR / md_name

                    if suffix in [".hwp", ".hwpx"]:
                        convert_hwp_to_md(file_path, md_path, frontmatter)
                    elif suffix == ".pdf":
                        save_pdf_entry(file_path, md_path, frontmatter)

            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()

        except Exception as e:
            print(f"  Error processing post {post['title']}: {e}")

        time.sleep(1)


def crawl_fsec_guidelines(page, limit_pages=10):
    """4. 금융보안원 가이드라인"""
    print("\n=== Start: 금융보안원 가이드라인 ===")
    base_url = "https://www.fsec.or.kr"
    posts = []

    for cur_page in range(1, limit_pages + 1):
        if cur_page == 1:
            list_url = f"{base_url}/bbs/222"
            print(f"  Scraping page 1 from {list_url}")
            page.goto(list_url)
            time.sleep(4)
        else:
            print(f"  Navigating to page {cur_page} via openSearch({cur_page})")
            try:
                page.evaluate(f"openSearch({cur_page})")
                time.sleep(4)
            except Exception as e:
                print(f"    Failed to run openSearch({cur_page}): {e}")
                break
        try:
            page.wait_for_selector("table, tbody", timeout=15000)
        except Exception:
            print(f"    Timeout waiting for list on page {cur_page}. Stopping.")
            break

        rows = page.query_selector_all("tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 4:
                continue

            title_link = row.query_selector("td.subj a, td a")
            if not title_link:
                continue

            title = title_link.inner_text().strip()
            href = title_link.get_attribute("href") or ""

            date_str = ""
            for td in tds:
                text = td.inner_text().strip()
                if re.match(r"\d{4}-\d{2}-\d{2}", text):
                    date_str = text.replace("-", "")
                    break

            if not date_str:
                date_str = time.strftime("%Y%m%d")

            full_url = href if href.startswith("http") else (base_url + href if href.startswith("/") else base_url + "/bbs/222" + href)
            page_posts.append(
                {
                    "title": title,
                    "url": full_url,
                    "date": date_str,
                    "id": f"fsec_{date_str}_{clean_filename(title)}",
                }
            )
        print(f"    Found {len(page_posts)} articles on page {cur_page}.")
        if not page_posts:
            break
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue

        print(f"  Processing: {post['title']} ({post['date']})")
        try:
            # Let's click the post or navigate
            page.goto(post["url"])
            page.wait_for_selector(".board_view, .file_area, .view_cont")

            # File download selector
            download_links = page.query_selector_all(
                ".file_area a, a[href*='download'], a[href*='file']"
            )
            downloaded_files = []

            for dl in download_links:
                try:
                    with page.expect_download(timeout=10000) as download_info:
                        dl.click()
                    download = download_info.value
                    filename = clean_filename(
                        f"{post['date']}_{download.suggested_filename}"
                    )
                    save_path = RAW_DIR / filename
                    download.save_as(save_path)
                    downloaded_files.append(save_path)
                    print(f"    Downloaded attachment: {filename}")
                except Exception as ex:
                    pass

            frontmatter = f"---\ntitle: \"{post['title']}\"\ndate: {post['date']}\nsource: \"금융보안원 가이드라인\"\nsource_url: \"{post['url']}\"\n---"

            if not downloaded_files:
                md_name = f"{post['date']}_{clean_filename(post['title'])}.md"
                md_path = WIKI_DIR / md_name
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(
                        frontmatter
                        + f"\n\n첨부파일이 없거나 웹페이지 형태로 제공됩니다."
                    )
                print(f"    Created text-only Obsidian note: {md_name}")
            else:
                for file_path in downloaded_files:
                    suffix = file_path.suffix.lower()
                    md_name = f"{post['date']}_{file_path.stem}.md"
                    md_path = WIKI_DIR / md_name

                    if suffix in [".hwp", ".hwpx"]:
                        convert_hwp_to_md(file_path, md_path, frontmatter)
                    elif suffix == ".pdf":
                        save_pdf_entry(file_path, md_path, frontmatter)

            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()

        except Exception as e:
            print(f"  Error processing post {post['title']}: {e}")

        time.sleep(1)


def crawl_fss_no_action(page, limit_pages=10):
    """5. 금융감독원 비조치의견서 (Web-only, no downloading of documents, text scraped directly)"""
    print("\n=== Start: 금융감독원 비조치의견서 ===")
    posts = []

    for cur_page in range(1, limit_pages + 1):
        list_url = f"https://better.fsc.go.kr/fsc_new/replyCase/OpinionList.do?stNo=11&muNo=86&muGpNo=75&curPage={cur_page}"
        print(f"  Scraping curPage={cur_page} from {list_url}")
        page.goto(list_url)
        time.sleep(4)
        try:
            page.wait_for_selector("table, tbody", timeout=15000)
        except Exception:
            print(f"    Timeout waiting for list on page {cur_page}. Stopping.")
            break

        rows = page.query_selector_all("tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 4:
                continue

            title_link = row.query_selector("td.subjectw a, td.subject a, td.align_l a, td a")
            if not title_link:
                continue

            title = title_link.inner_text().strip()
            href = title_link.get_attribute("href") or ""
            onclick = title_link.get_attribute("onclick") or ""

            case_id = ""
            if "fn_detail" in onclick:
                match = re.search(r"fn_detail\s*\(\s*['\"]([^'\"]+)['\"]", onclick)
                if match:
                    case_id = match.group(1)

            if not case_id and "opinion_seq" in href:
                match = re.search(r"opinion_seq=([^&]+)", href)
                if match:
                    case_id = match.group(1)

            if not case_id:
                case_id = str(hash(title))

            date_str = tds[3].inner_text().strip().replace("-", "")

            page_posts.append(
                {
                    "title": title,
                    "date": date_str,
                    "case_id": case_id,
                    "id": f"fss_noaction_{date_str}_{case_id}",
                    "row_element": row,
                }
            )
        print(f"    Found {len(page_posts)} articles on page {cur_page}.")
        if not page_posts:
            break
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue

        print(f"  Processing: {post['title']} ({post['date']})")
        try:
            # We need to click the row to open details
            # Navigate back to list first to make sure click target is valid
            page.goto(list_url)
            page.wait_for_selector(".tbl_list_type2, tbody")

            # Click the post by matching case_id or text
            item_clicked = False
            items = page.query_selector_all("tbody tr td a")
            for item in items:
                item_onclick = item.get_attribute("onclick") or ""
                if (
                    post["case_id"] in item_onclick
                    or post["title"] in item.inner_text()
                ):
                    item.click()
                    item_clicked = True
                    break

            if not item_clicked:
                print(f"    Failed to find click target for {post['title']}")
                continue

            page.wait_for_selector(".view_type1, table")

            # Scrape details text
            # We extract key fields from tables:
            th_elements = page.query_selector_all("th")
            details = {}
            for th in th_elements:
                label = th.inner_text().strip()
                # Find matching td (usually adjacent to th in tables)
                td = page.evaluate_handle(
                    "element => element.nextElementSibling", th
                ).as_element()
                if td:
                    value = td.inner_text().strip()
                    details[label] = value

            # Build markdown note
            frontmatter_dict = {
                "title": post["title"],
                "date": post["date"],
                "source": "금융감독원 비조치의견서",
                "case_id": post["case_id"],
                "law": details.get("관련법령", ""),
                "reply_date": details.get("회신일", ""),
            }

            frontmatter_str = "---\n"
            for k, v in frontmatter_dict.items():
                frontmatter_str += f'{k}: "{v}"\n'
            frontmatter_str += "---"

            content_md = f"""# {post['title']}

## 1. 관련 법령 및 규정
{details.get('관련법령', 'N/A')}

## 2. 요청 요지
{details.get('요청요지', 'N/A')}

## 3. 회신 내용
{details.get('회신요지', 'N/A')}
"""

            md_name = f"{post['date']}_비조치의견서_{post['case_id']}.md"
            md_path = WIKI_DIR / md_name
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(frontmatter_str + "\n\n" + content_md)

            print(f"    Saved Obsidian Web Entry: {md_name}")

            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()

        except Exception as e:
            print(f"  Error processing post {post['title']}: {e}")

        time.sleep(1)




def crawl_law_latest(page, limit_pages=10):
    """6. 국가법령정보센터 내 최신법령"""
    print("\n=== Start: 국가법령정보센터 내 최신법령 ===")
    posts = []
    
    SECURITY_IT_KEYWORDS = [
        "정보", "보안", "개인정보", "데이터", "통신", "망", "암호", "인증", "인프라", 
        "가상자산", "클라우드", "ai", "인공지능", "컴플라이언스", "해킹", "침해", 
        "신용정보", "가명정보", "내부통제", "isms", "csap", "취약점", "랜섬웨어", 
        "악성코드", "보안관제", "가상화", "접근통제", "인증보안", "오픈소스"
    ]

    for cur_page in range(1, limit_pages + 1):
        list_url = f"https://www.law.go.kr/lsSc.do?menuId=1&subMenuId=23&tabMenuId=121&pageIndex={cur_page}"
        print(f"  Scraping pageIndex={cur_page} from {list_url}")
        try:
            page.goto(list_url, timeout=20000)
            time.sleep(4)
            page.wait_for_selector("table tbody tr", timeout=10000)
        except Exception as e:
            print(f"    Timeout or error loading Law page {cur_page}. Stopping: {e}")
            break

        rows = page.query_selector_all("table tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 5:
                continue
                
            title_link = row.query_selector("a")
            if not title_link:
                continue
                
            title = title_link.inner_text().strip()
            
            # Filter IT/Security keywords to avoid polluting with unrelated laws
            if not any(kw in title.lower() for kw in SECURITY_IT_KEYWORDS):
                continue
                
            date_str = tds[2].inner_text().strip().replace(".", "").replace(" ", "")  # 공포일
            law_type = tds[3].inner_text().strip() # 대통령령 / 법률 / 부령 등
            law_num = tds[4].inner_text().strip() # 공포번호
            
            href = title_link.get_attribute("href") or ""
            full_url = "https://www.law.go.kr" + href if href.startswith("/") else list_url
            
            page_posts.append({
                "title": title,
                "url": full_url,
                "date": date_str,
                "law_type": law_type,
                "law_num": law_num,
                "id": f"law_latest_{date_str}_{clean_filename(title)}",
                "content": f"국가법령정보센터 최신법령 공포 알림입니다.\n\n- 법령명: {title}\n- 유형: {law_type}\n- 공포일: {date_str}\n- 공포번호: {law_num}"
            })
            
        print(f"    Found {len(page_posts)} relevant IT/Security articles on page {cur_page}.")
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue
            
        print(f"  Saving Law Entry: {post['title']}")
        try:
            frontmatter = f'---\ntitle: "{post["title"]}"\ndate: {post["date"]}\nsource: "국가법령정보센터 내 최신법령"\nsource_url: "{post["url"]}"\n---'
            content_md = f"# {post['title']}\n\n{post['content']}"
            
            md_name = f"{post['date']}_법령_{clean_filename(post['title'])}.md"
            md_path = WIKI_DIR / md_name
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(frontmatter + "\n\n" + content_md)
                
            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()
        except Exception as e:
            print(f"  Error saving law entry: {e}")


def crawl_adm_rules(page, limit_pages=10):
    """7. 국가법령정보센터 내 최신행정규칙"""
    print("\n=== Start: 국가법령정보센터 내 최신행정규칙 ===")
    posts = []
    
    SECURITY_IT_KEYWORDS = [
        "정보", "보안", "개인정보", "데이터", "통신", "망", "암호", "인증", "인프라", 
        "가상자산", "클라우드", "ai", "인공지능", "컴플라이언스", "해킹", "침해", 
        "신용정보", "가명정보", "내부통제", "isms", "csap", "취약점", "랜섬웨어", 
        "악성코드", "보안관제", "가상화", "접근통제", "인증보안", "오픈소스"
    ]

    for cur_page in range(1, limit_pages + 1):
        list_url = f"https://www.law.go.kr/admRulSc.do?menuId=5&subMenuId=45&tabMenuId=203&pageIndex={cur_page}"
        print(f"  Scraping pageIndex={cur_page} from {list_url}")
        try:
            page.goto(list_url, timeout=20000)
            time.sleep(4)
            page.wait_for_selector("table tbody tr", timeout=10000)
        except Exception as e:
            print(f"    Timeout or error loading Administrative Rules page {cur_page}. Stopping: {e}")
            break

        rows = page.query_selector_all("table tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 5:
                continue
                
            title_link = row.query_selector("a")
            if not title_link:
                continue
                
            title = title_link.inner_text().strip()
            
            if not any(kw in title.lower() for kw in SECURITY_IT_KEYWORDS):
                continue
                
            date_str = tds[2].inner_text().strip().replace(".", "").replace(" ", "")  # 발령일
            rule_type = tds[3].inner_text().strip() # 고시 / 훈령 / 예규 등
            rule_num = tds[4].inner_text().strip() # 발령번호
            
            href = title_link.get_attribute("href") or ""
            full_url = "https://www.law.go.kr" + href if href.startswith("/") else list_url
            
            page_posts.append({
                "title": title,
                "url": full_url,
                "date": date_str,
                "rule_type": rule_type,
                "rule_num": rule_num,
                "id": f"law_rule_{date_str}_{clean_filename(title)}",
                "content": f"국가법령정보센터 최신행정규칙 발령 알림입니다.\n\n- 행정규칙명: {title}\n- 유형: {rule_type}\n- 발령일: {date_str}\n- 발령번호: {rule_num}"
            })
            
        print(f"    Found {len(page_posts)} relevant IT/Security rules on page {cur_page}.")
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue
            
        print(f"  Saving Administrative Rule: {post['title']}")
        try:
            frontmatter = f'---\ntitle: "{post["title"]}"\ndate: {post["date"]}\nsource: "국가법령정보센터 내 최신행정규칙"\nsource_url: "{post["url"]}"\n---'
            content_md = f"# {post['title']}\n\n{post['content']}"
            
            md_name = f"{post['date']}_행정규칙_{clean_filename(post['title'])}.md"
            md_path = WIKI_DIR / md_name
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(frontmatter + "\n\n" + content_md)
                
            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()
        except Exception as e:
            print(f"  Error saving rule entry: {e}")


def crawl_pipc_press(page, limit_pages=10):
    """8. 개인정보보호위원회 보도자료"""
    print("\n=== Start: 개인정보보호위원회 보도자료 ===")
    posts = []
    
    SECURITY_IT_KEYWORDS = [
        "정보", "보안", "개인정보", "데이터", "통신", "망", "암호", "인증", "인프라", 
        "가상자산", "클라우드", "ai", "인공지능", "컴플라이언스", "해킹", "침해", 
        "신용정보", "가명정보", "내부통제", "isms", "csap", "취약점", "랜섬웨어", 
        "악성코드", "보안관제", "가상화", "접근통제", "인증보안", "오픈소스"
    ]

    for cur_page in range(1, limit_pages + 1):
        list_url = f"https://www.pipc.go.kr/np/cop/bbs/selectBoardList.do?bbsId=BS074&mCode=C020010000&pageIndex={cur_page}"
        print(f"  Scraping pageIndex={cur_page} from {list_url}")
        try:
            page.goto(list_url, timeout=20000)
            time.sleep(4)
            page.wait_for_selector("table.board, tbody", timeout=15000)
        except Exception as e:
            print(f"    Timeout or error loading PIPC Press page {cur_page}. Stopping: {e}")
            break

        rows = page.query_selector_all("table.board tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 4:
                continue
                
            title_link = row.query_selector("td.subject a, td a")
            if not title_link:
                continue
                
            title = title_link.inner_text().strip()
            
            if not any(kw in title.lower() for kw in SECURITY_IT_KEYWORDS):
                continue
                
            date_str = ""
            for td in tds:
                text = td.inner_text().strip()
                if re.match(r"\d{4}-\d{2}-\d{2}", text):
                    date_str = text.replace("-", "")
                    break
                    
            if not date_str:
                date_str = time.strftime("%Y%m%d")
                
            href = title_link.get_attribute("href") or ""
            full_url = "https://www.pipc.go.kr" + href if href.startswith("/") else list_url
            
            page_posts.append({
                "title": title,
                "url": full_url,
                "date": date_str,
                "id": f"pipc_press_{date_str}_{clean_filename(title)}"
            })
            
        print(f"    Found {len(page_posts)} relevant IT/Security press releases on page {cur_page}.")
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue
            
        print(f"  Processing PIPC Press: {post['title']}")
        try:
            page.goto(post["url"], timeout=20000)
            time.sleep(3)
            
            body_elem = page.query_selector("table, .board_read, .board_view")
            body_text = body_elem.inner_text().strip() if body_elem else "(보도자료 상세 본문 로드 불가)"
            
            frontmatter = f'---\ntitle: "{post["title"]}"\ndate: {post["date"]}\nsource: "개인정보보호위원회 보도자료"\nsource_url: "{post["url"]}"\n---'
            content_md = f"# {post['title']}\n\n{body_text}"
            
            md_name = f"{post['date']}_보도자료_{clean_filename(post['title'])}.md"
            md_path = WIKI_DIR / md_name
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(frontmatter + "\n\n" + content_md)
                
            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()
        except Exception as e:
            print(f"  Error processing PIPC press entry: {e}")


def crawl_fsec_press(page, limit_pages=10):
    """9. 금융보안원 보도자료"""
    print("\n=== Start: 금융보안원 보도자료 ===")
    posts = []
    
    SECURITY_IT_KEYWORDS = [
        "정보", "보안", "개인정보", "데이터", "통신", "망", "암호", "인증", "인프라", 
        "가상자산", "클라우드", "ai", "인공지능", "컴플라이언스", "해킹", "침해", 
        "신용정보", "가명정보", "내부통제", "isms", "csap", "취약점", "랜섬웨어", 
        "악성코드", "보안관제", "가상화", "접근통제", "인증보안", "오픈소스"
    ]

    for cur_page in range(1, limit_pages + 1):
        if cur_page == 1:
            list_url = f"https://www.fsec.or.kr/bbs/69"
            print(f"  Scraping page 1 from {list_url}")
            try:
                page.goto(list_url, timeout=20000)
                time.sleep(4)
            except Exception as e:
                print(f"    Error loading FSEC Press page 1: {e}")
                break
        else:
            print(f"  Navigating to page {cur_page} via openSearch({cur_page})")
            try:
                page.evaluate(f"openSearch({cur_page})")
                time.sleep(4)
            except Exception as e:
                print(f"    Failed to run openSearch({cur_page}): {e}")
                break
                
        try:
            page.wait_for_selector("table, tbody", timeout=15000)
        except Exception:
            print(f"    Timeout waiting for list on page {cur_page}. Stopping.")
            break

        rows = page.query_selector_all("tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if len(tds) < 4:
                continue
                
            title_link = row.query_selector("td.subj a, td a")
            if not title_link:
                continue
                
            title = title_link.inner_text().strip()
            
            if not any(kw in title.lower() for kw in SECURITY_IT_KEYWORDS):
                continue
                
            date_str = ""
            for td in tds:
                text = td.inner_text().strip()
                if re.match(r"\d{4}-\d{2}-\d{2}", text):
                    date_str = text.replace("-", "")
                    break
                    
            if not date_str:
                date_str = time.strftime("%Y%m%d")
                
            href = title_link.get_attribute("href") or ""
            full_url = "https://www.fsec.or.kr" + href if href.startswith("/") else list_url
            
            page_posts.append({
                "title": title,
                "url": full_url,
                "date": date_str,
                "id": f"fsec_press_{date_str}_{clean_filename(title)}"
            })
            
        print(f"    Found {len(page_posts)} relevant IT/Security press releases on page {cur_page}.")
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue
            
        print(f"  Processing FSEC Press: {post['title']}")
        try:
            page.goto(post["url"], timeout=20000)
            time.sleep(3)
            
            body_elem = page.query_selector(".board_read, .board_view, table")
            body_text = body_elem.inner_text().strip() if body_elem else "(보도자료 상세 본문 로드 불가)"
            
            frontmatter = f'---\ntitle: "{post["title"]}"\ndate: {post["date"]}\nsource: "금융보안원 보도자료"\nsource_url: "{post["url"]}"\n---'
            content_md = f"# {post['title']}\n\n{body_text}"
            
            md_name = f"{post['date']}_보도자료_{clean_filename(post['title'])}.md"
            md_path = WIKI_DIR / md_name
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(frontmatter + "\n\n" + content_md)
                
            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()
        except Exception as e:
            print(f"  Error processing FSEC press entry: {e}")


def crawl_fsc_datasets(page, limit_pages=10):
    """10. 금융위원회 보도자료 (공공데이터포털 데이터셋)"""
    print("\n=== Start: 금융위원회 공공데이터 ===")
    posts = []
    
    SECURITY_IT_KEYWORDS = [
        "정보", "보안", "개인정보", "데이터", "통신", "망", "암호", "인증", "인프라", 
        "가상자산", "클라우드", "ai", "인공지능", "컴플라이언스", "해킹", "침해", 
        "신용정보", "가명정보", "내부통제", "isms", "csap", "취약점", "랜섬웨어", 
        "악성코드", "보안관제", "가상화", "접근통제", "인증보안", "오픈소스"
    ]

    for cur_page in range(1, limit_pages + 1):
        list_url = f"https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=%EA%B8%88%EC%9C%B5%EC%9D%98%EC%9B%90%ED%9A%8C&currentPage={cur_page}"
        print(f"  Scraping pageIndex={cur_page} from {list_url}")
        try:
            page.goto(list_url, timeout=20000)
            time.sleep(4)
            page.wait_for_selector(".result-list, tbody", timeout=15000)
        except Exception as e:
            print(f"    Timeout or error loading Open Data portal page {cur_page}. Stopping: {e}")
            break

        rows = page.query_selector_all(".result-list li, tbody tr")
        page_posts = []
        for row in rows:
            title_link = row.query_selector("dt a, td.title a, td a")
            if not title_link:
                continue
                
            title = title_link.inner_text().strip()
            
            if not any(kw in title.lower() for kw in SECURITY_IT_KEYWORDS):
                continue
                
            date_str = time.strftime("%Y%m%d")
            
            href = title_link.get_attribute("href") or ""
            full_url = "https://www.data.go.kr" + href if href.startswith("/") else list_url
            
            page_posts.append({
                "title": title,
                "url": full_url,
                "date": date_str,
                "id": f"fsc_dataset_{date_str}_{clean_filename(title)}"
            })
            
        print(f"    Found {len(page_posts)} relevant IT/Security datasets on page {cur_page}.")
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue
            
        print(f"  Processing FSC Dataset: {post['title']}")
        try:
            page.goto(post["url"], timeout=20000)
            time.sleep(3)
            
            body_elem = page.query_selector(".detail-contents, table")
            body_text = body_elem.inner_text().strip() if body_elem else "(공공데이터 상세 기술내용 로드 불가)"
            
            frontmatter = f'---\ntitle: "{post["title"]}"\ndate: {post["date"]}\nsource: "금융위원회 공공데이터"\nsource_url: "{post["url"]}"\n---'
            content_md = f"# {post['title']}\n\n{body_text}"
            
            md_name = f"{post['date']}_보도자료_{clean_filename(post['title'])}.md"
            md_path = WIKI_DIR / md_name
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(frontmatter + "\n\n" + content_md)
                
            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()
        except Exception as e:
            print(f"  Error processing FSC dataset entry: {e}")


def crawl_fsc_press(page, limit_pages=10):
    """11. 금융위원회 보도자료"""
    print("\n=== Start: 금융위원회 보도자료 ===")
    base_url = "https://www.fsc.go.kr"
    posts = []
    
    SECURITY_IT_KEYWORDS = [
        "정보", "보안", "개인정보", "데이터", "통신", "망", "암호", "인증", "인프라", 
        "가상자산", "클라우드", "ai", "인공지능", "컴플라이언스", "해킹", "침해", 
        "신용정보", "가명정보", "내부통제", "isms", "csap", "취약점", "랜섬웨어", 
        "악성코드", "보안관제", "가상화", "접근통제", "인증보안", "오픈소스"
    ]

    for cur_page in range(1, limit_pages + 1):
        list_url = f"{base_url}/no010101?srchCtgry=&curPage={cur_page}&srchKey=&srchText=&srchBeginDt=&srchEndDt="
        print(f"  Scraping pageIndex={cur_page} from {list_url}")
        try:
            page.goto(list_url, timeout=20000)
            time.sleep(2)
            page.wait_for_selector("table tbody", timeout=15000)
        except Exception as e:
            print(f"    Timeout or error loading FSC Press page {cur_page}. Stopping: {e}")
            break

        rows = page.query_selector_all("table tbody tr")
        page_posts = []
        for row in rows:
            tds = row.query_selector_all("td")
            if not tds or len(tds) < 3:
                continue
                
            title_link = row.query_selector("td.subject a, td.title a, td a")
            if not title_link:
                continue
                
            title = title_link.inner_text().strip()
            
            if not any(kw in title.lower() for kw in SECURITY_IT_KEYWORDS):
                continue
                
            # 검증 반영: re.match 대신 re.search를 사용하여 앞뒤 공백 및 숨은 특수문자 무시
            date_str = ""
            for td in tds:
                text = td.inner_text().strip()
                match = re.search(r"\d{4}-\d{2}-\d{2}", text)
                if match:
                    date_str = match.group(0).replace("-", "")
                    break
                    
            if not date_str:
                date_str = time.strftime("%Y%m%d")
                
            href = title_link.get_attribute("href") or ""
            full_url = base_url + href if href.startswith("/") else (href if href.startswith("http") else f"{base_url}/no010101{href}")
            
            page_posts.append({
                "title": title,
                "url": full_url,
                "date": date_str,
                "id": f"fsc_press_{date_str}_{clean_filename(title)}"
            })
            
        print(f"    Found {len(page_posts)} relevant IT/Security press releases on page {cur_page}.")
        posts.extend(page_posts)

    for post in posts:
        if post["id"] in history:
            print(f"  Skipping already crawled: {post['title']}")
            continue
            
        print(f"  Processing FSC Press: {post['title']}")
        try:
            page.goto(post["url"], timeout=20000)
            time.sleep(2)
            
            # 본문 대기 및 첨부파일 찾기
            page.wait_for_selector(".board-view, .view-area, .b-cont, table", timeout=15000)
            
            download_links = page.query_selector_all("a[href*='download'], a.btn-down, a[title*='다운로드'], .file-list a")
            downloaded_files = []

            for dl in download_links:
                href_attr = dl.get_attribute("href") or ""
                if "javascript" in href_attr and "down" not in href_attr.lower():
                    continue

                try:
                    with page.expect_download(timeout=10000) as download_info:
                        dl.click()
                    download = download_info.value
                    filename = clean_filename(f"{post['date']}_{download.suggested_filename}")
                    save_path = RAW_DIR / filename
                    download.save_as(save_path)
                    downloaded_files.append(save_path)
                    print(f"    Downloaded attachment: {filename}")
                except Exception as ex:
                    pass

            frontmatter = f'---\ntitle: "{post["title"]}"\ndate: {post["date"]}\nsource: "금융위원회 보도자료"\nsource_url: "{post["url"]}"\n---'
            
            if not downloaded_files:
                md_name = f"{post['date']}_보도자료_{clean_filename(post['title'])}.md"
                md_path = WIKI_DIR / md_name
                # 본문 추출 셀렉터 보완 적용
                body_elem = page.query_selector(".b-cont, .board-cont, .view-con, .board_view, .board-view")
                body_text = body_elem.inner_text().strip() if body_elem else "(보도자료 본문 로드 불가 혹은 첨부파일 없음)"
                
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(frontmatter + "\n\n" + body_text)
                print(f"    Created text-only Obsidian note: {md_name}")
            else:
                for file_path in downloaded_files:
                    suffix = file_path.suffix.lower()
                    md_name = f"{post['date']}_{file_path.stem}.md"
                    md_path = WIKI_DIR / md_name

                    if suffix in [".hwp", ".hwpx"]:
                        convert_hwp_to_md(file_path, md_path, frontmatter)
                    elif suffix == ".pdf":
                        save_pdf_entry(file_path, md_path, frontmatter)

            history[post["id"]] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_history()

        except Exception as e:
            print(f"  Error processing FSC press entry {post['title']}: {e}")

        time.sleep(1)

def run_all_crawlers(limit_pages=10):
    with sync_playwright() as p:
        print("Launching headless browser...")
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800}
        )

        # 1. FSS Guidance (행정지도)
        try:
            page = context.new_page()
            crawl_fss_guidance(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in FSS Guidance crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
                
        # 2. FSS Supervision (감독행정)
        try:
            page = context.new_page()
            crawl_fss_supervision(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in FSS Supervision crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
                
        # 3. PIPC Guidelines (개인정보위 안내서)
        try:
            page = context.new_page()
            crawl_pipc_guidelines(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in PIPC Guidelines crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
                
        # 4. FSEC Guidelines (금융보안원 가이드라인)
        try:
            page = context.new_page()
            crawl_fsec_guidelines(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in FSEC Guidelines crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
                
        # 5. FSC No-Action (비조치의견서)
        try:
            page = context.new_page()
            crawl_fss_no_action(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in FSC No-Action crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
            
        # --- New Daily Scrapers (IT/Security and Privacy Focused) ---
        # 6. Law Center Latest Laws (최신법령)
        try:
            page = context.new_page()
            crawl_law_latest(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in Law Center Latest Laws crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
                
        # 7. Law Center Administrative Rules (최신행정규칙)
        try:
            page = context.new_page()
            crawl_adm_rules(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in Law Center Administrative Rules crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
                
        # 8. PIPC Press (개인정보위 보도자료)
        try:
            page = context.new_page()
            crawl_pipc_press(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in PIPC Press crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
                
        # 9. FSEC Press (금융보안원 보도자료)
        try:
            page = context.new_page()
            crawl_fsec_press(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in FSEC Press crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
        """        
        # 10. FSC Datasets (금융위 공공데이터)
        try:
            page = context.new_page()
            crawl_fsc_datasets(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in FSC Datasets crawler: {e}")
        finally:
            page.close()
            time.sleep(3)
        """

        # 11. FSC Press (금융위원회 보도자료)
        try:
            page = context.new_page()
            crawl_fsc_press(page, limit_pages=limit_pages)
        except Exception as e:
            print(f"[Scraper Error] Error in FSC Press crawler: {e}")
        finally:
            page.close()
                
        browser.close()
        print("\nBrowser closed. Crawling completed successfully.")


if __name__ == "__main__":
    run_all_crawlers()
