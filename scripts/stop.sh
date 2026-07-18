#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== reg-detection: 중지 중 ==="
docker compose --env-file .env.integration -f docker-compose-integration.yml down
echo "=== 중지 완료 ==="
