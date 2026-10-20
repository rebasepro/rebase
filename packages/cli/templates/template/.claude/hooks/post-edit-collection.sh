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
        process.stdout.write(String(toolInput.file_path || toolInput.notebook_path || ""));
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

{
    echo "rebase verify failed after editing ${file#"${CLAUDE_PROJECT_DIR:-}/"}:"
    echo ""
    echo "$output"
    echo ""
    echo "Each problem names its file, the path inside the collection config, and the fix."
    echo "Fix them in config/collections/ before moving on; run \`rebase verify\` for the full report."
} >&2
exit 2
