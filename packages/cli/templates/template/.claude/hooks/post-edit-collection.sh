#!/usr/bin/env bash
# Rebase guardrail for Claude Code, installed by `rebase init` and `rebase skills --hooks`.
#
# After Claude Code edits a file under config/collections/, this runs
# `rebase verify --quiet` and hands any problem straight back to the agent:
# an option that does not exist, a UI widget written outside `admin: { ... }`,
# a collection with no `securityRules`, a migration the collections have moved
# past. Exit code 2 is how a PostToolUse hook talks to the agent: Claude Code
# shows it what this prints on stderr, and the agent fixes it before going on.
#
# Edits anywhere else return at once. Safe to delete; `rebase skills --hooks`
# puts it back.
set -u

input="$(cat)"

# The edited file, from the tool call Claude Code passes on stdin. Node rather
# than jq: every Rebase project has Node, not every machine has jq.
file="$(printf '%s' "$input" | node -e '
let raw = "";
process.stdin.on("data", chunk => { raw += chunk; });
process.stdin.on("end", () => {
    try {
        const toolInput = JSON.parse(raw).tool_input || {};
        // Forward slashes on every OS: on Windows the path arrives as
        // C:\Users\me\shop\config\collections\posts.ts, which the case below never matched.
        process.stdout.write(String(toolInput.file_path || toolInput.notebook_path || "").replace(/\\/g, "/"));
    } catch {
        // Not a tool call this hook understands: nothing to check.
    }
});
')"

case "$file" in
    */config/collections/* | config/collections/*) ;;
    *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# The project's own CLI, pinned with the rest of its @rebasepro packages.
if [ -x node_modules/.bin/rebase ]; then
    output="$(node_modules/.bin/rebase verify --quiet 2>&1)"
else
    output="$(npx --no rebase verify --quiet 2>&1)"
fi
status=$?

if [ "$status" -eq 0 ]; then
    exit 0
fi

# A project pinned to a CLI from before `rebase verify` answers "Unknown
# command", and one with no CLI installed cannot run it at all. Neither is a
# problem in the collections the agent just edited, so neither blocks the edit:
# say why the check was skipped, and go on.
case "$output" in
    *"Unknown command"*verify*)
        echo "Rebase guardrail skipped: this project's @rebasepro/cli predates \`rebase verify\`. Upgrade it with \`rebase upgrade\` to check collections after each edit." >&2
        exit 0
        ;;
esac
if [ "$status" -eq 127 ]; then
    echo "Rebase guardrail skipped: no rebase CLI found in this project. Install @rebasepro/cli to check collections after each edit." >&2
    exit 0
fi

{
    project_dir="${CLAUDE_PROJECT_DIR:-}"
    echo "rebase verify failed after editing ${file#"${project_dir//\\//}/"}:"
    echo ""
    echo "$output"
    echo ""
    echo "Each problem names its file, the path inside the collection config, and the fix."
    echo "Fix them in config/collections/ before moving on; run \`rebase verify\` for the full report."
} >&2
exit 2
