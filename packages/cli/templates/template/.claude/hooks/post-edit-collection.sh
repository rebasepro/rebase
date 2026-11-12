#!/usr/bin/env bash
# Rebase guardrail for Claude Code, installed by `rebase init` and `rebase skills --hooks`.
#
# After Claude Code edits a table — a file under backend/schema/, or the
# directory rebase.json names in `apps.<backend>.tables` — or a customization
# under frontend/src/cms/, this runs `rebase verify --quiet` and hands any
# problem straight back to the agent: a table the server would refuse, a `rls`
# that does not compile, a migration the tables have moved past. Exit code 2 is
# how a PostToolUse hook talks to the agent: Claude Code shows it what this
# prints on stderr, and the agent fixes it before going on.
#
# The file keeps the name it shipped with (post-edit-collection.sh): it is the
# name `rebase skills --hooks` recognises in a project that already has it, and
# the name its settings entry points at.
#
# Edits anywhere else return at once. Safe to delete; `rebase skills --hooks`
# puts it back.
set -u

input="$(cat)"

# The edited file, from the tool call Claude Code passes on stdin, and the
# tables directory, from rebase.json (`apps.<backend>.tables`, by default
# `backend/schema`) — the runtime and `rebase verify` read the tables from
# there, so a project that moved them is still checked. Node rather than jq:
# every Rebase project has Node, not every machine has jq.
parsed="$(printf '%s' "$input" | node -e '
let raw = "";
process.stdin.on("data", chunk => { raw += chunk; });
process.stdin.on("end", () => {
    let tables = "backend/schema";
    try {
        const manifest = JSON.parse(require("fs").readFileSync(require("path").join(process.env.CLAUDE_PROJECT_DIR || ".", "rebase.json"), "utf8"));
        const backend = Object.values(manifest.apps || {}).find(app => app && app.type === "backend");
        if (backend && typeof backend.tables === "string" && backend.tables) tables = backend.tables.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    } catch {
        // No rebase.json, or one this cannot read: the conventional layout.
    }
    let file = "";
    try {
        const toolInput = JSON.parse(raw).tool_input || {};
        // Forward slashes on every OS: on Windows the path arrives as
        // C:\Users\me\shop\backend\schema\posts.ts, which the case below never matched.
        file = String(toolInput.file_path || toolInput.notebook_path || "").replace(/\\/g, "/");
    } catch {
        // Not a tool call this hook understands: nothing to check.
    }
    process.stdout.write(tables + "\n" + file);
});
')"
tables_dir="${parsed%%$'\n'*}"
file="${parsed#*$'\n'}"

case "$file" in
    */"$tables_dir"/* | "$tables_dir"/* | */frontend/src/cms/* | frontend/src/cms/*) ;;
    *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# The project's own CLI, pinned with the rest of its @rebasepro packages.
#
# Not installed yet is the state `rebase init --yes` leaves, and it is not a
# problem in the schema the agent just edited, so it never blocks the
# edit. There is no `npx` fallback: `npx --no rebase` with nothing installed
# exits 1 ("could not determine executable to run"), which read as a failed
# verify and told the agent to fix tables that were fine.
if [ ! -x node_modules/.bin/rebase ]; then
    echo "Rebase guardrail skipped: this project's dependencies are not installed (no node_modules/.bin/rebase). Run the install — pnpm install, or your package manager's — to check the schema after each edit." >&2
    exit 0
fi
output="$(node_modules/.bin/rebase verify --quiet 2>&1)"
status=$?

if [ "$status" -eq 0 ]; then
    exit 0
fi

# A project pinned to a CLI from before `rebase verify` answers "Unknown
# command", and a CLI whose interpreter is missing cannot run at all (127).
# Neither is a problem in the schema the agent just edited, so neither
# blocks the edit: say why the check was skipped, and go on.
case "$output" in
    *"Unknown command"*verify*)
        echo "Rebase guardrail skipped: this project's @rebasepro/cli predates \`rebase verify\`. Upgrade it with \`rebase upgrade\` to check the schema after each edit." >&2
        exit 0
        ;;
esac
if [ "$status" -eq 127 ]; then
    echo "Rebase guardrail skipped: this project's rebase CLI could not be run. Reinstall the dependencies to check the schema after each edit." >&2
    exit 0
fi

{
    project_dir="${CLAUDE_PROJECT_DIR:-}"
    echo "rebase verify failed after editing ${file#"${project_dir//\\//}/"}:"
    echo ""
    echo "$output"
    echo ""
    echo "Each problem names its file, the table and column, and the fix."
    echo "Fix them in ${tables_dir}/ or frontend/src/cms/ before moving on; run \`rebase verify\` for the full report."
} >&2
exit 2
