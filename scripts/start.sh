#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== reg-detection: 시작 중 ==="
docker compose -f docker-compose-integration.yml up -d --build
echo ""
echo "=== 기동 완료 ==="
echo "  deskrpg : http://localhost:3102"
echo "  nanobot-gw : port 18790"
echo "  nanobot-api : port 8900"
