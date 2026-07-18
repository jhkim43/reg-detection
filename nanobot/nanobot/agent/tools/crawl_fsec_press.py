import time
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

def sanitize_filename(title):
    return re.sub(r'[\\/*?:"<>|]', "", title).replace(" ", "_")[:50]

def crawl_press_releases():
    output_dir = Path("raw_sources_260604")
    output_dir.mkdir(exist_ok=True)
    
    # 캐시: 이미 존재하는 파일들
    existing_files = {f.name for f in output_dir.glob("fsec_260604_*.md")}
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("https://www.fsec.or.kr/bbs/69", wait_until="networkidle")
        time.sleep(3)

        # 1. 확장 (최대 10번)
        for _ in range(10):
            more_btns = page.query_selector_all("button.btnMore, .btnMore, .more")
            clicked = False
            for btn in more_btns:
                if btn.is_visible():
                    try:
                        btn.click()
                        time.sleep(2)
                        clicked = True
                        break
                    except: continue
            if not clicked: break

        # 2. 아이템 추출
        items = page.query_selector_all('xpath=//div[contains(@class, "board")]//li')
        saved_count = 0
        
        for item in items:
            text = item.inner_text().strip()
            if len(text) < 10: continue
            
            # Extract date using regex
            date_match = re.search(r'(\d{4}-\d{2}-\d{2})', text)
            date_str = date_match.group(1) if date_match else "00000000"
            date_fmt = date_str.replace("-", "")

            title = [line.strip() for line in text.split('\n') if line.strip()][0]
            title = re.sub(r'^제목\s*[:：]\s*', '', title, flags=re.IGNORECASE)
            
            clean_title = sanitize_filename(title)
            filename = f"fsec_{date_fmt}_{clean_title}.md"
            
            if filename in existing_files: continue
                
            filepath = output_dir / filename
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"# {title}\n\n{text}")
            saved_count += 1
            
        print(f"보도자료 크롤링 완료: {saved_count}개 파일 저장됨.")
        browser.close()

if __name__ == "__main__":
    crawl_press_releases()
