import time
import re
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright

def sanitize_filename(filename):
    return re.sub(r'[\\/*?:"<>|]', "", filename).replace(" ", "_")[:50]

def crawl_guidelines():
    base_dir = Path("raw_sources_260604") / "guidelines"
    base_dir.mkdir(parents=True, exist_ok=True)
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("https://www.fsec.or.kr/bbs/222", wait_until="domcontentloaded")
        time.sleep(3)
        
        # Loop through pages using openSearch(i)
        # We start at page 1 (default) and go until no items are found
        page_num = 1
        while True:
            print(f"--- Processing page {page_num} ---")
            if page_num > 1:
                page.evaluate(f"openSearch({page_num})")
                time.sleep(3)
            
            items = page.query_selector_all('.boardGallery li')
            if not items:
                print("No items found, stopping.")
                break
            
            # Extract jobs from current page
            page_tasks = []
            for item in items:
                date_el = item.query_selector('.date')
                date_str = date_el.inner_text().strip() if date_el else "00000000"
                date_fmt = date_str.replace("-", "")
                
                onclick = item.get_attribute('onclick')
                match = re.search(r'(\d+)', onclick) if onclick else None
                if match:
                    page_tasks.append((match.group(1), date_fmt))
            
            # Process detail pages
            for bbs_id, date_fmt in page_tasks:
                try:
                    page.evaluate(f"moveToBbsDetail({bbs_id})")
                    page.wait_for_load_state("domcontentloaded")
                    time.sleep(2)
                    
                    # Find ALL download links
                    # Look for links that trigger downloadFile or directly link to files
                    download_links = page.query_selector_all('a[onclick*="downloadFile"]')
                    
                    if not download_links:
                        # Fallback for direct links
                        download_links = page.query_selector_all('a[href*="/uploadFile1/"]')
                        
                    for link in download_links:
                        file_name = link.inner_text().strip()
                        if not file_name: continue
                            
                        # If onclick exists, use it to get fileNo/filePage, but usually we just need the URL/ID
                        # Sometimes href is javascript:void(0), so we rely on what the onclick does
                        # Actually for this site, downloadFile(id, page) is the standard
                        
                        # Let's try to simulate click and wait for download
                        safe_filename = sanitize_filename(file_name)
                        save_name = f"fsec_guideline_{date_fmt}_{safe_filename}"
                        save_path = base_dir / save_name
                        
                        if not save_path.exists():
                            with page.expect_download() as download_info:
                                link.click()
                            download = download_info.value
                            download.save_as(save_path)
                            print(f"Saved: {save_name}")
                        else:
                            print(f"Exists: {save_name}")
                            
                    page.go_back()
                    page.wait_for_load_state("domcontentloaded")
                    time.sleep(2)
                except Exception as e:
                    print(f"Error on ID {bbs_id}: {e}")
                    page.goto("https://www.fsec.or.kr/bbs/222") # Reset on error
                    time.sleep(2)
                    # We might need to re-run openSearch(page_num) here if we reset
                    if page_num > 1:
                        page.evaluate(f"openSearch({page_num})")
                        time.sleep(2)
            
            page_num += 1
            if page_num > 10: break # Safety break

        browser.close()

if __name__ == "__main__":
    crawl_guidelines()
