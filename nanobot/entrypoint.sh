#!/bin/sh
dir="$HOME/.nanobot"
if [ -d "$dir" ] && [ ! -w "$dir" ]; then
    owner_uid=$(stat -c %u "$dir" 2>/dev/null || stat -f %u "$dir" 2>/dev/null)
    cat >&2 <<EOF
Error: $dir is not writable (owned by UID $owner_uid, running as UID $(id -u)).

Fix (pick one):
  Host:   sudo chown -R 1000:1000 ~/.nanobot
  Docker: docker run --user \$(id -u):\$(id -g) ...
  Podman: podman run --userns=keep-id ...
EOF
    exit 1
fi

# Development mode with auto-reload on file changes
if [ "$DEV_MODE" = "1" ]; then
    echo "Development mode enabled: auto-reloading on /app/nanobot changes"
    watchmedo auto-restart -R -d /app/nanobot -p '*.py' -- nanobot "$@"
else
    exec nanobot "$@"
fi
