#!/bin/bash
#
# claude-tmux-bridge Universal Hook Script
#
# This script handles hook events from multiple AI coding assistants:
# - Claude Code (via PreToolUse, PostToolUse, Stop, etc. hooks)
# - OpenAI Codex (via notify hook)
#
# It transforms the events to a common format and:
# 1. Appends to events.jsonl for persistence
# 2. POSTs to the bridge server for real-time updates
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

# Data directory - can be overridden via environment
BRIDGE_DATA_DIR="${CLAUDE_TMUX_BRIDGE_DATA_DIR:-$HOME/.claude-tmux-bridge}"
EVENTS_FILE="${BRIDGE_DATA_DIR}/data/events.jsonl"
SERVER_URL="${CLAUDE_TMUX_BRIDGE_SERVER:-http://localhost:4003}"
DEBUG="${CLAUDE_TMUX_BRIDGE_DEBUG:-}"

# =============================================================================
# Utility Functions
# =============================================================================

debug_log() {
  if [ -n "$DEBUG" ]; then
    echo "[claude-bridge-hook] $*" >&2
  fi
}

# Find jq - required for JSON processing
find_jq() {
  # Check common locations
  for path in \
    /usr/bin/jq \
    /usr/local/bin/jq \
    /opt/homebrew/bin/jq \
    /opt/local/bin/jq \
    "$HOME/.local/bin/jq" \
    "$HOME/bin/jq"
  do
    if [ -x "$path" ]; then
      echo "$path"
      return 0
    fi
  done

  # Check PATH
  if command -v jq >/dev/null 2>&1; then
    command -v jq
    return 0
  fi

  return 1
}

# Find curl - optional for real-time updates
find_curl() {
  for path in \
    /usr/bin/curl \
    /usr/local/bin/curl \
    /opt/homebrew/bin/curl
  do
    if [ -x "$path" ]; then
      echo "$path"
      return 0
    fi
  done

  if command -v curl >/dev/null 2>&1; then
    command -v curl
    return 0
  fi

  return 1
}

# =============================================================================
# Main Script
# =============================================================================

main() {
  # Find required tools
  JQ=$(find_jq) || {
    echo "Error: jq not found. Please install jq." >&2
    exit 1
  }

  CURL=$(find_curl) || CURL=""

  debug_log "jq: $JQ"
  debug_log "curl: ${CURL:-not found}"

  # Ensure data directory exists
  mkdir -p "${BRIDGE_DATA_DIR}/data"

  # Read JSON from stdin
  input=$(cat)
  debug_log "Input: $input"

  # Detect which agent called us based on environment and input
  # Claude Code sets CLAUDE_CODE_HOOK_NAME
  # Codex may set CODEX_HOOK or similar
  hook_name="${CLAUDE_CODE_HOOK_NAME:-${CODEX_HOOK:-notify}}"
  debug_log "Hook name: $hook_name"

  # Capture terminal info from environment
  tmux_pane="${TMUX_PANE:-}"
  tmux_socket="${TMUX:-}"
  terminal_tty=$(tty 2>/dev/null || echo "")

  debug_log "TMUX_PANE: $tmux_pane"
  debug_log "TMUX: $tmux_socket"
  debug_log "TTY: $terminal_tty"

  # Extract session ID and cwd from input
  session_id=$($JQ -r '.session_id // .thread_id // empty' <<< "$input" 2>/dev/null || echo "")
  cwd=$($JQ -r '.cwd // empty' <<< "$input" 2>/dev/null || echo "$PWD")

  # Detect agent type
  agent="claude"
  if [ -n "${CODEX_HOOK:-}" ] || $JQ -e '.thread_id' <<< "$input" >/dev/null 2>&1; then
    agent="codex"
  fi

  debug_log "Agent: $agent"
  debug_log "Session ID: $session_id"
  debug_log "CWD: $cwd"

  # Generate unique event ID and timestamp
  event_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "evt-$(date +%s)-$$")
  timestamp=$(date +%s%3N 2>/dev/null || echo "$(date +%s)000")

  # Map hook name to event type
  event_type=""
  case "$hook_name" in
    PreToolUse)     event_type="pre_tool_use" ;;
    PostToolUse)    event_type="post_tool_use" ;;
    Stop)           event_type="stop" ;;
    SubagentStop)   event_type="subagent_stop" ;;
    SessionStart)   event_type="session_start" ;;
    SessionEnd)     event_type="session_end" ;;
    UserPromptSubmit) event_type="user_prompt_submit" ;;
    Notification)   event_type="notification" ;;
    notify)
      # Codex notify - extract event type from payload
      codex_type=$($JQ -r '.event_type // "notification"' <<< "$input" 2>/dev/null || echo "notification")
      case "$codex_type" in
        tool_start)     event_type="pre_tool_use" ;;
        tool_end)       event_type="post_tool_use" ;;
        response)       event_type="stop" ;;
        session_start)  event_type="session_start" ;;
        session_end)    event_type="session_end" ;;
        *)              event_type="notification" ;;
      esac
      ;;
    *)              event_type="notification" ;;
  esac

  debug_log "Event type: $event_type"

  # Build the event JSON
  event=$($JQ -n \
    --arg id "$event_id" \
    --arg timestamp "$timestamp" \
    --arg type "$event_type" \
    --arg sessionId "$session_id" \
    --arg agent "$agent" \
    --arg cwd "$cwd" \
    --arg tmuxPane "$tmux_pane" \
    --arg tmuxSocket "$tmux_socket" \
    --arg tty "$terminal_tty" \
    --argjson raw "$input" \
    '{
      id: $id,
      timestamp: ($timestamp | tonumber),
      type: $type,
      sessionId: $sessionId,
      agent: $agent,
      cwd: $cwd,
      terminal: (
        if ($tmuxPane != "" or $tmuxSocket != "" or $tty != "") then
          {
            tmuxPane: (if $tmuxPane != "" then $tmuxPane else null end),
            tmuxSocket: (if $tmuxSocket != "" then $tmuxSocket else null end),
            tty: (if $tty != "" then $tty else null end)
          }
        else null end
      )
    } + $raw'
  )

  debug_log "Event: $event"

  # Append to events file (atomic append)
  echo "$event" >> "$EVENTS_FILE"

  # POST to server for real-time updates (fire and forget)
  if [ -n "$CURL" ]; then
    $CURL -s -X POST \
      -H "Content-Type: application/json" \
      -d "$event" \
      --max-time 2 \
      "${SERVER_URL}/event" >/dev/null 2>&1 &
  fi

  debug_log "Event processed successfully"
}

# Run main function
main "$@"
