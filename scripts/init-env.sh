#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env.integration"

if [ -f "$ENV_FILE" ]; then
    echo "$ENV_FILE이(가) 이미 존재합니다. 덮어쓰시겠습니까? (y/N)"
    read -r answer
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
        echo "취소되었습니다."
        exit 0
    fi
fi

cat > "$ENV_FILE" << 'EOF'
# =============================================================================
# reg-detection 통합 환경 변수
# =============================================================================
# 이 파일은 nanobot + deskrpg + PostgreSQL 공용 설정입니다.

# ── PostgreSQL ──
# 반드시 실제 비밀번호로 변경하세요
POSTGRES_PASSWORD=change-me

# ── JWT (deskrpg) ──
# 반드시 실제 랜덤 문자열로 변경하세요
# (e.g., openssl rand -hex 32 명령어 활용)
JWT_SECRET=change-me-to-a-random-64-char-string

# ── Cookie ──
COOKIE_SECURE=false

# ── deskrpg 이미지 ──
# 기본: docker-compose가 ./deskrpg를 빌드(우리 fork). nanobot 통합 분기 패치 자동 포함.
# 외부 이미지를 강제하고 싶을 때만 아래 줄 uncomment (CI 캐시·임시 디버깅용).
# DESKRPG_IMAGE=dandacompany/deskrpg:latest

# ── nanobot 모델 ──
# ~/.nanobot/config.json 에서 설정하는 것이 일반적입니다.
# 여기서는 nanobot-api가 사용할 기본 모델 참조용
NANOBOT_MODEL=

# ── OpenRouter API key (PR 2a — 팀 잔여 위젯용) ──
# 무료 메타데이터 endpoint(/auth/key) 호출에만 사용. inference 호출은 nanobot이 담당.
# 미설정 시 위젯에서 '팀 잔여' 줄만 hide되고 다른 기능엔 영향 없음.
# 값은 ~/.nanobot/config.json의 providers.openrouter.apiKey와 동일.
OPENROUTER_API_KEY=

EOF

chmod 600 "$ENV_FILE"
echo "$ENV_FILE 생성 완료."
echo ""
echo "⚠️  JWT_SECRET을 반드시 실제 값으로 변경하세요."
