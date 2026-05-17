#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== reg-detection: 컨테이너 상태 ==="
docker compose -f docker-compose-integration.yml ps
