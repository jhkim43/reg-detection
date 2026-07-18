FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# Corporate proxy/firewall이 deb.debian.org을 차단하는 환경 대응 (KAIST 미러로 swap).
# bookworm-slim은 /etc/apt/sources.list.d/debian.sources (deb822) 또는 /etc/apt/sources.list
# 둘 중 하나를 쓰므로 양쪽 모두 best-effort swap.
RUN (sed -i 's|deb.debian.org|ftp.kr.debian.org|g; s|security.debian.org|ftp.kr.debian.org|g' \
        /etc/apt/sources.list.d/debian.sources 2>/dev/null || true) && \
    (sed -i 's|deb.debian.org|ftp.kr.debian.org|g; s|security.debian.org|ftp.kr.debian.org|g' \
        /etc/apt/sources.list 2>/dev/null || true)

RUN apt-get update && \
    apt-get install -y --no-install-recommends procps vim curl ca-certificates tzdata && \
    rm -rf /var/lib/apt/lists/* && \
    ln -fs /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    dpkg-reconfigure -f noninteractive tzdata

# reg_pipeline 의존성 — Java (opendataloader-pdf), LibreOffice (HWP/DOC/DOCX→PDF),
# Playwright Chromium용 system libs
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        default-jdk-headless \
        libreoffice-core libreoffice-writer \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
        libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 \
        libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
        fonts-noto-cjk && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (cached layer)
COPY pyproject.toml README.md LICENSE ./
RUN mkdir -p nanobot && touch nanobot/__init__.py && \
    uv pip install --system --no-cache . && \
    uv pip install --system watchdog

# reg_pipeline Python deps (Playwright 브라우저는 entrypoint에서 install)
RUN uv pip install --system --no-cache \
        playwright \
        pypdf \
        opendataloader-pdf \
        pyyaml \
        sentence-transformers \
        openai \
        olefile

# Copy the full source and install
COPY nanobot/ nanobot/
RUN uv pip install --system --no-cache -e .

WORKDIR /app

# Create non-root user and config directory
RUN useradd -m -u 1000 -s /bin/bash nanobot && \
    mkdir -p /home/nanobot/.nanobot && \
    chown -R nanobot:nanobot /home/nanobot /app && \
    chmod 755 /home/nanobot

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

# Playwright Chromium 다운로드 (nanobot user의 ~/.cache/ms-playwright/에 저장)
USER nanobot
ENV HOME=/home/nanobot
RUN playwright install chromium 2>&1 | tail -5 || echo "(playwright install warning — proceeding)"

# Gateway default port
EXPOSE 18790

ENTRYPOINT ["entrypoint.sh"]
CMD ["status"]