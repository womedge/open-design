#!/bin/sh
# Zeabur starts the container as root even though the base image declares a
# non-root user. Fix ownership of the writable paths, then run the daemon
# (and the Claude Code / OpenCode processes it spawns) as open-design.
set -e

if [ "$(id -u)" = "0" ]; then
  export HOME=/home/open-design
  for dir in "$OD_DATA_DIR" /app/.od "$HOME"; do
    [ -n "$dir" ] || continue
    mkdir -p "$dir"
    chown -R open-design:open-design "$dir"
  done
  exec su-exec open-design "$@"
fi

exec "$@"
