#!/bin/bash
# Zeabur starts the container as root even though the base image declares a
# non-root user. Fix ownership of the writable paths, then re-run this script
# as open-design, which supervises the daemon (and the Claude Code / OpenCode
# processes it spawns).
#
# Exit diagnostics: Zeabur keeps only ~100 log lines and nothing survives a
# restart except the $OD_DATA_DIR volume. So the daemon runs as a child of
# this script (tini -> this script -> daemon) instead of being exec'd: we
# forward SIGTERM/SIGINT/HUP to it, wait, and append its exit code/signal plus
# the last 200 lines of its output to $OD_DATA_DIR/diagnostics/
# container-exits.log, then exit with the same code so a crash still looks
# like a crash. Output is still mirrored to the container's stdout.
#
# Optional persistence: set CLAUDE_CONFIG_DIR / CODEX_HOME / XDG_DATA_HOME (OpenCode
# keeps its sessions there) / OD_USER_STATE_DIR
# to paths on the $OD_DATA_DIR volume; the root phase pre-creates them with the
# right owner and re-copies the baked CLAUDE.md / AGENTS.md into the first two
# each boot.

if [ "$(id -u)" = "0" ]; then
  set -e
  export HOME=/home/open-design
  # Create the persistent agent/user-state dirs (and any missing parents) first,
  # so the recursive chown of $OD_DATA_DIR below covers them when they live
  # under it; dirs outside it only get their leaf chowned afterwards.
  for dir in "${CLAUDE_CONFIG_DIR:-}" "${CODEX_HOME:-}" "${XDG_DATA_HOME:-}" "${OD_USER_STATE_DIR:-}"; do
    [ -n "$dir" ] && mkdir -p "$dir"
  done
  for dir in "$OD_DATA_DIR" /app/.od "$HOME"; do
    [ -n "$dir" ] || continue
    mkdir -p "$dir"
    chown -R open-design:open-design "$dir"
  done
  for dir in "${CLAUDE_CONFIG_DIR:-}" "${CODEX_HOME:-}" "${XDG_DATA_HOME:-}" "${OD_USER_STATE_DIR:-}"; do
    [ -n "$dir" ] && chown open-design:open-design "$dir"
  done
  # With CLAUDE_CONFIG_DIR set (pointed at the volume so settings, --resume
  # transcripts and memory survive restarts), Claude Code reads CLAUDE.md from
  # there instead of ~/.claude: refresh it from the image copy on every boot so
  # image updates take effect.
  if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ -f "$HOME/.claude/CLAUDE.md" ]; then
    cp -f "$HOME/.claude/CLAUDE.md" "$CLAUDE_CONFIG_DIR/CLAUDE.md"
    chown open-design:open-design "$CLAUDE_CONFIG_DIR/CLAUDE.md"
  fi
  if [ -n "${CODEX_HOME:-}" ] && [ -f "$HOME/.codex/AGENTS.md" ]; then
    cp -f "$HOME/.codex/AGENTS.md" "$CODEX_HOME/AGENTS.md"
    chown open-design:open-design "$CODEX_HOME/AGENTS.md"
  fi
  exec su-exec open-design /bin/bash "$0" "$@"
fi

diag=${OD_DATA_DIR:+$OD_DATA_DIR/diagnostics}
if [ -z "$diag" ] || ! mkdir -p "$diag/node-reports" 2>/dev/null || [ ! -w "$diag" ]; then
  exec "$@"
fi

exits=$diag/container-exits.log
tail_log=$diag/daemon-tail.log
running=$diag/.running
max_exits_bytes=$((5 * 1024 * 1024))
max_tail_bytes=$((2 * 1024 * 1024))
tail_lines=200

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
size_of() { stat -c %s "$1" 2>/dev/null || echo 0; }
# cgroup v2 memory facts: the oom_kill counter tells a container-level OOM
# kill apart from a V8 "heap limit" abort.
mem_facts() {
  local max=/sys/fs/cgroup/memory.max ev=/sys/fs/cgroup/memory.events
  [ -r "$max" ] && printf 'memory.max=%s ' "$(cat "$max")"
  [ -r "$ev" ] && printf 'oom_kill=%s' "$(awk '$1=="oom_kill"{print $2}' "$ev")"
}
last_lines() { cat "$tail_log.1" "$tail_log" 2>/dev/null | tail -n "$tail_lines"; }
record() {  # record <header>, followed by the daemon's last output lines
  {
    echo "==== $1"
    echo "---- last $tail_lines lines of daemon output"
    last_lines
    echo "==== end"
  } >>"$exits"
}

if [ "$(size_of "$exits")" -gt "$max_exits_bytes" ]; then
  mv -f "$exits" "$exits.1"
fi

# The previous run never reached its exit record (the whole container was
# killed, e.g. a cgroup OOM kill or a forced restart): salvage its output.
if [ -e "$running" ]; then
  record "$(now) previous run (booted $(cat "$running")) ended without an exit record; $(mem_facts)"
fi
rm -f "$tail_log" "$tail_log.1"
# Keep only the newest Node fatal-error reports.
ls -1t "$diag"/node-reports/*.json 2>/dev/null | tail -n +6 | while read -r old; do rm -f "$old"; done

boot=$(now)
echo "$boot" >"$running"
echo "$boot boot pid=$$ $(mem_facts) cmd=$*" >>"$exits"

# A V8 fatal error (e.g. "Reached heap limit") writes a JSON report here.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--report-on-fatalerror --report-directory=$diag/node-reports"

# Mirror the daemon's stdout+stderr to the container log and the tail file.
fifo=$(mktemp -u "${TMPDIR:-/tmp}/od-daemon-out.XXXXXX")
mkfifo "$fifo"
tee -a "$tail_log" <"$fifo" &
tee_pid=$!

# Keep the tail file small: once it passes the cap, keep its last lines in
# .1 and truncate (tee appends, so it continues at the new end).
(
  while sleep 30; do
    if [ "$(size_of "$tail_log")" -gt "$max_tail_bytes" ]; then
      tail -n "$tail_lines" "$tail_log" >"$tail_log.1"
      : >"$tail_log"
    fi
  done
) &
trimmer_pid=$!

"$@" >"$fifo" 2>&1 &
child=$!

forward() { kill -s "$1" "$child" 2>/dev/null; }
trap 'forward TERM' TERM
trap 'forward INT' INT
trap 'forward HUP' HUP

started=$(date +%s)
# `wait` returns early whenever a trapped signal arrives; keep waiting until
# the daemon is really gone, then read its stored status.
while kill -0 "$child" 2>/dev/null; do
  wait "$child"
done
wait "$child"
code=$?

wait "$tee_pid" 2>/dev/null
kill "$trimmer_pid" 2>/dev/null
rm -f "$fifo"

if [ "$code" -gt 128 ]; then
  how="signal=$(kill -l $((code - 128)) 2>/dev/null || echo $((code - 128)))"
else
  how="signal=none"
fi
report=$(find "$diag/node-reports" -name '*.json' -newer "$running" 2>/dev/null | head -n 1)
record "$(now) exit code=$code $how uptime=$(($(date +%s) - started))s booted=$boot $(mem_facts)${report:+ node-report=$report}"
rm -f "$running"

exit "$code"
