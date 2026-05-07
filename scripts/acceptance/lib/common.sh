# scripts/acceptance/lib/common.sh
#
# Shared helpers sourced by the three acceptance scripts. Provides:
#
#   setup_dataplane [--no-publish]
#       Boot a fresh `datafetch server` against a tmp $DATAFETCH_HOME.
#       Optionally publishes the finqa-2024 mount against live Atlas.
#       Captures the server PID for teardown.
#
#   teardown
#       Idempotent. Kills the server, removes the tmp dir, kills any
#       lingering tmux sessions named `dft-*`. Wired via `trap teardown EXIT`.
#
#   dft <args...>
#       Wraps the CLI. Prefers `datafetch` on PATH, falls back to
#       `node $REPO_ROOT/bin/datafetch.mjs` (which is what Phase 6's
#       `pnpm link --global` will eventually expose).
#
#   agent_cmd <prompt>
#       Builds the canonical headless client-agent invocation. Defaults to the
#       Codex CLI driver; set DF_AGENT_DRIVER=claude to use Claude Code.
#
#   wait_for_tmux <session-name> <timeout-seconds>
#       Polls until the named tmux session has exited (i.e. the wrapped
#       command has finished). Fails on timeout.
#
#   assert_file_exists <path> [<label>]
#   assert_file_glob   <glob> [<label>]
#   assert_eq          <expected> <actual> [<label>]
#   assert_json_field  <file> <jq-path> <expected> [<label>]
#       Print `[PASS] ...` or `[FAIL] ...`; FAIL bumps a global FAIL_COUNT
#       so the calling script can summarise.
#
#   step <description>
#       Logs `[step] <description>` to stderr.
#
# Environment expectations (callers may set):
#   ATLAS_URI         — required for setup_dataplane unless --no-publish
#   ATLAS_DB_NAME     — defaults to "atlasfs_hackathon"
#   DF_AGENT_DRIVER   — codex (default) or claude
#   DF_TEST_MODEL     — model override for the selected agent driver
#   DF_CLAUDE_BARE    — 1 forces `claude --bare`; auto uses bare only when
#                       an Anthropic API env key is present
#   ANTHROPIC_KEY     — optional for DF_AGENT_DRIVER=claude; local Claude login
#                       also works when available
#   ANTHROPIC_API_KEY — alternative to ANTHROPIC_KEY for API-key auth
#   DF_TEST_PORT      — server port (default 8090)
#   DEBUG             — set to 1 for verbose tmux pane dumps on failure

# ---- Repo root detection ----------------------------------------------------
# Use BASH_SOURCE so the resolution works whether sourced or run.
LIB_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$LIB_DIR/../../.." && pwd )"

# Server port (override with DF_TEST_PORT).
DF_PORT="${DF_TEST_PORT:-8090}"

# Failure counter consumed by the per-script summary.
FAIL_COUNT=0
PASS_COUNT=0

# Will be populated by setup_dataplane.
DATAFETCH_HOME=""
SERVER_PID=""
SERVER_LOG=""

load_acceptance_env_file() {
  if [[ "${ATLASFS_SKIP_ENV_FILE:-0}" == "1" || ! -f "$REPO_ROOT/.env" ]]; then
    return 0
  fi
  if [[ -z "${ATLAS_URI:-}" ]]; then
    local atlas_uri
    atlas_uri="$(
      cd "$REPO_ROOT" && node -e '
        if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
        const value = process.env.ATLAS_URI || process.env.MONGODB_URI || "";
        if (value) process.stdout.write(value);
      ' 2>/dev/null || true
    )"
    if [[ -n "$atlas_uri" ]]; then
      export ATLAS_URI="$atlas_uri"
    fi
  fi
  if [[ -z "${ATLAS_DB_NAME:-}" ]]; then
    local atlas_db_name
    atlas_db_name="$(
      cd "$REPO_ROOT" && node -e '
        if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
        const value = process.env.ATLAS_DB_NAME || "";
        if (value) process.stdout.write(value);
      ' 2>/dev/null || true
    )"
    if [[ -n "$atlas_db_name" ]]; then
      export ATLAS_DB_NAME="$atlas_db_name"
    fi
  fi
}

load_acceptance_env_file

# ---- Logging ----------------------------------------------------------------

step() {
  printf '[step] %s\n' "$*" >&2
}

debug() {
  if [[ "${DEBUG:-0}" == "1" ]]; then
    printf '[debug] %s\n' "$*" >&2
  fi
}

# ---- CLI wrapper ------------------------------------------------------------
# Prefer `datafetch` on PATH (post Phase 6 `pnpm link --global`), fall back to
# the launcher shim under bin/. We avoid `pnpm tsx src/cli.ts` because pnpm
# adds noise to stderr and requires cwd=$REPO_ROOT.

dft() {
  if command -v datafetch >/dev/null 2>&1; then
    datafetch "$@"
  else
    node "$REPO_ROOT/bin/datafetch.mjs" "$@"
  fi
}

# ---- Anthropic env normalisation -------------------------------------------
# `claude --bare` strictly reads ANTHROPIC_API_KEY. If only ANTHROPIC_KEY is
# set (the convention in this repo's .env), copy it across.

normalise_anthropic_env() {
  if [[ -z "${ANTHROPIC_API_KEY:-}" && -n "${ANTHROPIC_KEY:-}" ]]; then
    export ANTHROPIC_API_KEY="$ANTHROPIC_KEY"
  fi
}

# ---- Server lifecycle -------------------------------------------------------

# Wait until `curl http://localhost:$port/health` returns 200, or fail after
# `timeout` seconds. Polls every 0.5s.
_wait_for_health() {
  local port="$1"
  local timeout="${2:-30}"
  local elapsed=0
  while (( elapsed < timeout * 2 )); do
    if curl -sf "http://localhost:$port/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
    elapsed=$((elapsed + 1))
  done
  printf '[FAIL] server did not become healthy on port %s within %ss\n' "$port" "$timeout" >&2
  return 1
}

# setup_dataplane [--no-publish]
#
# Creates a fresh tmp $DATAFETCH_HOME, boots `datafetch server` in the
# background, optionally publishes finqa-2024 against live Atlas. Sets
# DATAFETCH_HOME, SERVER_PID, SERVER_LOG; exports DATAFETCH_HOME and
# DATAFETCH_SERVER_URL for child commands.
setup_dataplane() {
  local publish_mount=1
  for arg in "$@"; do
    case "$arg" in
      --no-publish) publish_mount=0 ;;
    esac
  done

  DATAFETCH_HOME="$(mktemp -d -t df-acceptance-XXXX)"
  export DATAFETCH_HOME
  export DATAFETCH_SERVER_URL="http://localhost:$DF_PORT"

  # Ensure the live harness uses the repo-local CLI under test. A global
  # `datafetch` may be linked to an older checkout, which makes agent E2E
  # results drift from the branch being validated.
  mkdir -p "$DATAFETCH_HOME/bin"
  ln -sf "$REPO_ROOT/bin/datafetch.mjs" "$DATAFETCH_HOME/bin/datafetch"
  export PATH="$DATAFETCH_HOME/bin:$PATH"
  mkdir -p "$DATAFETCH_HOME/zsh"
  printf 'export PATH=%q:$PATH\n' "$DATAFETCH_HOME/bin" > "$DATAFETCH_HOME/zsh/.zshenv"
  printf 'export PATH=%q:$PATH\n' "$DATAFETCH_HOME/bin" > "$DATAFETCH_HOME/zsh/.zlogin"
  export ZDOTDIR="$DATAFETCH_HOME/zsh"
  debug "prepended $DATAFETCH_HOME/bin (symlink to bin/datafetch.mjs) to PATH"

  step "tmp DATAFETCH_HOME=$DATAFETCH_HOME (port=$DF_PORT)"

  # Pre-flight Atlas env when we're going to publish.
  if (( publish_mount )); then
    if [[ -z "${ATLAS_URI:-}" ]]; then
      printf '[FAIL] setup_dataplane: ATLAS_URI is required (or pass --no-publish)\n' >&2
      return 1
    fi
  fi

  SERVER_LOG="$DATAFETCH_HOME/server.log"
  step "booting server (log: $SERVER_LOG)"
  # We use `setsid`-equivalent to put the server in its own process group so
  # teardown can `kill -- -<pgid>` and reap any grandchildren (the
  # bin/datafetch.mjs shim spawns a node child for the tsx loader). If
  # `setsid` isn't available (macOS doesn't ship it by default), we fall
  # back to a subshell + tracking the leaf pid via lsof.
  (
    cd "$REPO_ROOT"
    export DATAFETCH_HOME="$DATAFETCH_HOME"
    if command -v datafetch >/dev/null 2>&1; then
      exec datafetch server --port "$DF_PORT" --base-dir "$DATAFETCH_HOME" \
        > "$SERVER_LOG" 2>&1
    else
      exec node "$REPO_ROOT/bin/datafetch.mjs" server --port "$DF_PORT" \
        --base-dir "$DATAFETCH_HOME" > "$SERVER_LOG" 2>&1
    fi
  ) &
  SERVER_PID=$!
  debug "server pid=$SERVER_PID"

  if ! _wait_for_health "$DF_PORT" 30; then
    printf '[FAIL] server log:\n' >&2
    tail -n 40 "$SERVER_LOG" >&2 || true
    return 1
  fi
  step "server healthy on http://localhost:$DF_PORT"

  # Publish the mount through the running server's /v1/mounts route. Doing
  # this in-process via the CLI's `datafetch publish` subcommand spins up a
  # *second* runtime in the publish process; the runtime registry isn't
  # shared so the server's snippet runtime doesn't see any mounts. The
  # HTTP publish keeps everything in one process and registers the mount in
  # the runtime registry that /v1/snippets actually consults.
  if (( publish_mount )); then
    local atlas_db="${ATLAS_DB_NAME:-atlasfs_hackathon}"
    step "publishing finqa-2024 (HTTP, db=$atlas_db)"
    local publish_log="$DATAFETCH_HOME/publish.log"
    # /v1/mounts streams SSE; we just need the final exit status. The
    # `--no-buffer` keeps curl from waiting on stdin.
    if ! curl -sN -X POST "http://localhost:$DF_PORT/v1/mounts" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"finqa-2024\",\"source\":{\"kind\":\"atlas\",\"uri\":$(printf '%s' "$ATLAS_URI" | jq -Rs .),\"db\":\"$atlas_db\"}}" \
        > "$publish_log" 2>&1; then
      printf '[FAIL] /v1/mounts publish failed; last 30 lines:\n' >&2
      tail -n 30 "$publish_log" >&2 || true
      return 1
    fi
    # Confirm by GET /v1/mounts — if the mount isn't registered, fail loud.
    if ! curl -sf "http://localhost:$DF_PORT/v1/mounts" \
          | jq -e '.mounts | map(.mountId) | index("finqa-2024") != null' >/dev/null; then
      printf '[FAIL] mount finqa-2024 not in /v1/mounts after publish\n' >&2
      tail -n 30 "$publish_log" >&2 || true
      return 1
    fi
    step "mount finqa-2024 registered"
  fi
}

# teardown — always safe to call.
teardown() {
  # Disable bash's "Terminated: 15" message for backgrounded jobs we kill.
  # `disown` removes the child from the shell's job table so SIGTERM is
  # silent; we'd lose `wait` capability but we don't use it.
  if [[ -n "${SERVER_PID:-}" ]]; then
    debug "killing server pid=$SERVER_PID"
    disown "$SERVER_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi

  # Belt-and-braces: the bin/datafetch.mjs shim spawns a `node --import tsx
  # ...` grandchild that may survive the parent's SIGTERM. Reap whatever's
  # still bound to our port. `lsof -t` is silent + scriptable.
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -tiTCP:"$DF_PORT" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      debug "reaping leftover listeners on port $DF_PORT: $pids"
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
      sleep 1
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi

  # Reap any tmux sessions we left behind.
  if command -v tmux >/dev/null 2>&1; then
    while IFS= read -r sess; do
      [[ -z "$sess" ]] && continue
      debug "killing tmux session $sess"
      tmux kill-session -t "$sess" 2>/dev/null || true
    done < <(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^dft-' || true)
  fi

  if [[ -n "${DATAFETCH_HOME:-}" && -d "$DATAFETCH_HOME" ]]; then
    if [[ "${DEBUG:-0}" == "1" ]]; then
      debug "leaving DATAFETCH_HOME=$DATAFETCH_HOME for inspection"
    else
      rm -rf "$DATAFETCH_HOME"
    fi
    DATAFETCH_HOME=""
  fi
}

# ---- Skill check ------------------------------------------------------------
# We do NOT auto-install the skill into the dev's actual home; the operator
# must have run `datafetch install-skill` once. If the skill is missing, the
# test fails fast with a clear hint.

require_skill_installed() {
  local skill="${DATAFETCH_SKILL_PATH:-$HOME/.claude/skills/datafetch/SKILL.md}"
  if [[ ! -f "$skill" ]]; then
    printf '[FAIL] skill not installed at %s\n' "$skill" >&2
    printf '       run `datafetch install-skill` first or set DATAFETCH_SKILL_PATH\n' >&2
    return 1
  fi
  step "skill present: $skill"
}

# ---- Agent driver invocation -------------------------------------------------
# Builds the canonical headless invocation. Caller passes the prompt as $1.
# Stdout is the model's text response; stderr is the agent's own logging.

agent_driver() {
  printf '%s' "${DF_AGENT_DRIVER:-codex}"
}

agent_driver_preflight() {
  case "$(agent_driver)" in
    codex)
      if ! command -v codex >/dev/null 2>&1; then
        printf '[FAIL] required tool not on PATH for DF_AGENT_DRIVER=codex: codex\n' >&2
        return 1
      fi
      ;;
    claude)
      normalise_anthropic_env
      if ! command -v claude >/dev/null 2>&1; then
        printf '[FAIL] required tool not on PATH for DF_AGENT_DRIVER=claude: claude\n' >&2
        return 1
      fi
      if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
        printf '[warn] DF_AGENT_DRIVER=claude has no Anthropic env key; relying on Claude Code local login\n' >&2
      fi
      ;;
    *)
      printf '[FAIL] unsupported DF_AGENT_DRIVER=%s (expected codex or claude)\n' "$(agent_driver)" >&2
      return 1
      ;;
  esac
}

agent_system_prompt() {
  # Inject the datafetch SKILL.md into the system prompt. Headless agent
  # modes do not reliably auto-discover our worktree skill, so without this
  # the model may never read the contract we are testing.
  #
  # NOTE: We intentionally do NOT inject the typed `df.d.ts` manifest into
  # the system prompt. Earlier experiment showed it had the opposite of the
  # intended effect: with the full typed surface in context, the agent
  # constructed plausible inputs from JSDoc/examples and bypassed the
  # substrate entirely (no `df.db.*` calls). The manifest is still
  # generated on disk at $DATAFETCH_HOME/df.d.ts; the agent can `cat` it
  # on demand. Forcing it preemptively into context invites hallucination.
  local skill_path="${DATAFETCH_SKILL_PATH:-$HOME/.claude/skills/datafetch/SKILL.md}"
  local skill_content=""
  if [[ -f "$skill_path" ]]; then
    skill_content=$(cat "$skill_path")
  else
    printf '[warn] skill not found at %s; running without skill context\n' "$skill_path" >&2
  fi
  local context="Active datafetch session: ${SESSION_ID:-}. Datafetch home: ${DATAFETCH_HOME:-}. Datafetch server URL: ${DATAFETCH_SERVER_URL:-http://localhost:8080}. Agent working directory: ${DF_AGENT_CWD:-$REPO_ROOT}. The datafetch CLI is on PATH. Use this server URL; do not hard-code localhost:8080 when the URL above differs."
  printf '%s\n\n%s\n' "$skill_content" "$context"
}

agent_cmd() {
  case "$(agent_driver)" in
    codex) codex_cmd "$1" ;;
    claude) claude_cmd "$1" ;;
    *)
      printf '[FAIL] unsupported DF_AGENT_DRIVER=%s (expected codex or claude)\n' "$(agent_driver)" >&2
      return 1
      ;;
  esac
}

codex_cmd() {
  local prompt="$1"
  local sys_prompt
  sys_prompt="$(agent_system_prompt)"
  local full_prompt="${sys_prompt}

User task:
${prompt}"

  local model="${DF_TEST_MODEL:-gpt-5.3-codex-spark}"
  local reasoning="${DF_TEST_REASONING_EFFORT:-medium}"
  local sandbox="${DF_CODEX_SANDBOX:-danger-full-access}"
  local approval="${DF_CODEX_APPROVAL:-never}"
  local workdir="${DF_AGENT_CWD:-$REPO_ROOT}"
  local args=(
    --model "$model"
    --sandbox "$sandbox"
    --ask-for-approval "$approval"
    --cd "$workdir"
    -c "model_reasoning_effort=\"$reasoning\""
  )
  if [[ "$workdir" != "$REPO_ROOT" ]]; then
    args+=(--add-dir "$REPO_ROOT")
  fi
  if [[ -n "${DATAFETCH_HOME:-}" ]]; then
    args+=(--add-dir "$DATAFETCH_HOME")
  fi

  codex "${args[@]}" exec --skip-git-repo-check -- "$full_prompt"
}

# We deliberately avoid `eval` here. `claude` is invoked directly so the
# allowedTools strings are passed as separate argv entries (the way the
# parser wants them).

claude_cmd() {
  local prompt="$1"
  normalise_anthropic_env

  local sys_prompt
  sys_prompt="$(agent_system_prompt)"

  # Default to Haiku 4.5 for cost; override with DF_TEST_MODEL. `--bare`
  # intentionally skips OAuth/keychain reads, so only use it for API-key auth
  # unless DF_CLAUDE_BARE=1 explicitly forces it.
  local claude_args=(--print)
  if [[ "${DF_CLAUDE_BARE:-auto}" == "1" ]] ||
     [[ "${DF_CLAUDE_BARE:-auto}" == "auto" && -n "${ANTHROPIC_API_KEY:-}" ]]; then
    claude_args+=(--bare)
  fi

  # Note: Bash() patterns sit on separate argv entries. The `--` before the
  # prompt prevents Claude Code's flag parser from eating an arg starting
  # with `-` or `--` as the prompt's first word.
  claude "${claude_args[@]}" \
    --model "${DF_TEST_MODEL:-claude-haiku-4-5}" \
    --allowedTools \
      'Bash(datafetch *)' \
      'Bash(cat *)' \
      'Bash(ls *)' \
      'Bash(head *)' \
      'Bash(jq *)' \
      'Bash(grep *)' \
      'Bash(find *)' \
      'Bash(curl *)' \
      'Bash(echo *)' \
      'Bash(test *)' \
      'Bash(mkdir *)' \
    --append-system-prompt "$sys_prompt" \
    -- "$prompt"
}

# ---- Tmux helpers -----------------------------------------------------------
# tmux new-session -d returns immediately; we need to wait until the wrapped
# command exits. Cleanest trick: have the wrapped command `touch` a sentinel
# file when done, then poll for it. We also poll `tmux has-session` so that
# if Claude crashes outright (no sentinel) we still notice.

# wait_for_tmux <session> <timeout-seconds> [<sentinel-file>]
#
# If sentinel-file is provided, we succeed when the file exists OR the
# session has exited; otherwise we just wait for the session to exit.
wait_for_tmux() {
  local sess="$1"
  local timeout="$2"
  local sentinel="${3:-}"
  local elapsed=0
  while (( elapsed < timeout )); do
    if [[ -n "$sentinel" && -f "$sentinel" ]]; then
      return 0
    fi
    if ! tmux has-session -t "$sess" 2>/dev/null; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  printf '[FAIL] tmux session %s did not exit within %ss\n' "$sess" "$timeout" >&2
  return 1
}

# Dump the tmux pane (post-mortem) when DEBUG=1. Useful for diagnosing why
# Claude Code didn't drive the CLI as expected. Falls back to the captured
# log file when the pane is already gone.
dump_tmux_pane() {
  local sess="$1"
  local logfile="${2:-}"
  if [[ "${DEBUG:-0}" != "1" ]]; then
    return 0
  fi
  printf '\n[debug] === tmux pane / log for %s ===\n' "$sess" >&2
  if tmux has-session -t "$sess" 2>/dev/null; then
    tmux capture-pane -t "$sess" -p >&2 || true
  elif [[ -n "$logfile" && -f "$logfile" ]]; then
    cat "$logfile" >&2 || true
  fi
  printf '[debug] === end pane ===\n' >&2
}

# ---- Assertions -------------------------------------------------------------
# Each assertion prints PASS or FAIL with a label and bumps the appropriate
# counter. They never `exit`; the caller chooses whether to short-circuit.

assert_file_exists() {
  local path="$1"
  local label="${2:-file exists: $path}"
  if [[ -f "$path" ]]; then
    printf '[PASS] %s\n' "$label"
    PASS_COUNT=$((PASS_COUNT + 1))
    return 0
  fi
  printf '[FAIL] %s (path=%s)\n' "$label" "$path" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
  return 1
}

assert_file_glob() {
  local glob="$1"
  local label="${2:-glob matches at least one file: $glob}"
  # shellcheck disable=SC2086
  local matches
  matches=( $glob )
  if [[ -e "${matches[0]}" ]]; then
    printf '[PASS] %s (matched: %s)\n' "$label" "${matches[0]}"
    PASS_COUNT=$((PASS_COUNT + 1))
    return 0
  fi
  printf '[FAIL] %s\n' "$label" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
  return 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="${3:-eq: $expected == $actual}"
  if [[ "$expected" == "$actual" ]]; then
    printf '[PASS] %s\n' "$label"
    PASS_COUNT=$((PASS_COUNT + 1))
    return 0
  fi
  printf '[FAIL] %s (expected=%q actual=%q)\n' "$label" "$expected" "$actual" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
  # Return 0: PASS_COUNT/FAIL_COUNT are the source of truth and
  # `print_summary` reports the tally at the end. Returning non-zero
  # would abort under `set -euo pipefail` and skip later assertions —
  # which is the opposite of what a regression harness wants.
  return 0
}

assert_neq() {
  local unexpected="$1"
  local actual="$2"
  local label="${3:-neq: $actual != $unexpected}"
  if [[ "$unexpected" != "$actual" ]]; then
    printf '[PASS] %s\n' "$label"
    PASS_COUNT=$((PASS_COUNT + 1))
    return 0
  fi
  printf '[FAIL] %s (unexpected=%q actual=%q)\n' "$label" "$unexpected" "$actual" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
  return 0  # see assert_eq for why we don't propagate failure exit codes
}

assert_json_field() {
  local file="$1"
  local path="$2"
  local expected="$3"
  local label="${4:-json: $file $path == $expected}"
  if [[ ! -f "$file" ]]; then
    printf '[FAIL] %s (file missing: %s)\n' "$label" "$file" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return 1
  fi
  local actual
  actual=$(jq -r "$path" "$file" 2>/dev/null || echo "<jq-error>")
  if [[ "$expected" == "$actual" ]]; then
    printf '[PASS] %s\n' "$label"
    PASS_COUNT=$((PASS_COUNT + 1))
    return 0
  fi
  printf '[FAIL] %s (expected=%q actual=%q)\n' "$label" "$expected" "$actual" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
  return 1
}

assert_json_truthy() {
  local file="$1"
  local jq_expr="$2"
  local label="$3"
  if [[ -f "$file" ]] && jq -e "$jq_expr" "$file" >/dev/null 2>&1; then
    printf '[PASS] %s\n' "$label"
    PASS_COUNT=$((PASS_COUNT + 1))
    return 0
  fi
  printf '[FAIL] %s\n' "$label" >&2
  if [[ -f "$file" ]]; then jq . "$file" >&2 || true; fi
  FAIL_COUNT=$((FAIL_COUNT + 1))
  return 1
}

# Returns the path to the most recently modified trajectory file, or empty
# if none exist.
latest_trajectory() {
  local dir="$DATAFETCH_HOME/trajectories"
  if [[ ! -d "$dir" ]]; then
    return 0
  fi
  ls -t "$dir"/*.json 2>/dev/null | head -n 1
}

# Print the per-script summary line. Returns 0 iff FAIL_COUNT == 0.
print_summary() {
  local label="$1"
  if (( FAIL_COUNT == 0 )); then
    printf '[%s] PASS (%d assertions)\n' "$label" "$PASS_COUNT"
    return 0
  fi
  printf '[%s] FAIL (%d failed, %d passed)\n' "$label" "$FAIL_COUNT" "$PASS_COUNT" >&2
  return 1
}
