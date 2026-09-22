/**
 * Tests for `docs-verify/check-doc-commands.mjs` and the CLI surface it reads
 * (`docs-verify/cli-commands.mjs`).
 *
 * The check accepted commands the CLI rejects, in four ways:
 *
 *   - Subcommands were every `case "x":` anywhere in a command's module, so an
 *     inner switch counted too: `rebase apps backend` (a `switch (app.type)`
 *     case) and `rebase cloud list` (a case of `cloud projects`) passed, and
 *     both exit 1.
 *   - `telemetry` dispatches subcommands and was not in the map at all.
 *   - A command whose spec declares no flags was "not flag-checked", and the
 *     `generate-sdk` spec lives in `cli.ts`, which was never read — so
 *     `rebase generate-sdk --ouput` passed.
 *   - A fence indented under a list item was never read as commands.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkDocCommands } from "../docs-verify/check-doc-commands.mjs";
import { loadCliCommands, loadCliFlags } from "../docs-verify/cli-commands.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const CLI = `
const namespacedCommands = ["apps", "cloud", "telemetry", "generate-sdk", "dev"];
async function dispatch(command) {
    switch (command) {
        case "generate-sdk": {
            const { flags } = parseCommandArgs({
                spec: { "--output": String, "-o": "--output" },
                rawArgs: args
            });
            switch (flags["--output"]) {
                case "stdout":
                    break;
            }
            break;
        }
        case "apps":
            await apps(args);
            break;
    }
}
`;

const APPS = `
export async function apps(rawArgs) {
    const args = arg({ "--json": Boolean }, { argv: rawArgs });
    switch (subcommand) {
        case "list":
            return list();
        case "init":
            return init();
    }
}
function describe(app) {
    switch (app.type) {
        case "backend":
            return "a backend";
        case "static":
            return "a static site";
    }
}
`;

const CLOUD = `
export async function cloud(rawArgs) {
    switch (group) {
        case "projects":
        case "project":
            return projects(rawArgs);
        case "deploy":
            return deploy(rawArgs);
    }
}
async function projects(rawArgs) {
    switch (action) {
        case "list":
            return list();
        case "create":
            return create();
    }
}
`;

const TELEMETRY = `
export async function telemetry(rawArgs) {
    const { positionals } = parseCommandArgs({ spec: {}, rawArgs, command: "telemetry" });
    switch (subcommand) {
        case "status":
        case undefined:
            return status();
        case "enable":
            return enable();
    }
}
`;

const DEV = `
export async function dev(rawArgs) {
    const args = arg({ "--port": Number, "-P": "--port" }, { argv: rawArgs });
}
`;

function fixture(doc) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-commands-"));
    const files = {
        "packages/cli/src/cli.ts": CLI,
        "packages/cli/src/commands/apps.ts": APPS,
        "packages/cli/src/commands/cloud/index.ts": CLOUD,
        "packages/cli/src/commands/telemetry.ts": TELEMETRY,
        "packages/cli/src/commands/dev.ts": DEV,
        "tooling/rebase-agent-skills/guide.md": doc
    };
    for (const [file, contents] of Object.entries(files)) {
        fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), contents);
    }
    return root;
}

const findingsFor = (doc) =>
    checkDocCommands(fixture(doc)).findings
        .filter(f => f.file === "tooling/rebase-agent-skills/guide.md")
        .map(f => `${f.line}: ${f.message.split(" — ")[0]}`);

test("commands the CLI dispatches pass", () => {
    assert.deepEqual(findingsFor(
        "```bash\n" +
        "rebase apps list --json\n" +
        "rebase cloud projects list\n" +
        "rebase cloud deploy\n" +
        "rebase telemetry enable\n" +
        "rebase generate-sdk -o ./sdk\n" +
        "rebase dev -P 3005\n" +
        "```\n"
    ), []);
});

test("a case of an inner switch is not a subcommand", () => {
    assert.deepEqual(findingsFor(
        "```bash\n" +
        "rebase apps backend\n" +
        "rebase cloud list\n" +
        "rebase cloud create my-app\n" +
        "```\n"
    ), [
        "2: `rebase apps backend` is not a subcommand of `apps`",
        "3: `rebase cloud list` is not a subcommand of `cloud`",
        "4: `rebase cloud create` is not a subcommand of `cloud`"
    ]);
});

test("telemetry's subcommands and flags are checked", () => {
    assert.deepEqual(findingsFor(
        "```bash\n" +
        "rebase telemetry frobnicate\n" +
        "rebase telemetry status --frobnicate\n" +
        "```\n"
    ), [
        "2: `rebase telemetry frobnicate` is not a subcommand of `telemetry`",
        "3: `rebase telemetry` does not accept `--frobnicate`"
    ]);
});

test("generate-sdk's flags are read from cli.ts", () => {
    assert.deepEqual(findingsFor("```bash\nrebase generate-sdk --ouput ./sdk\n```\n"), [
        "2: `rebase generate-sdk` does not accept `--ouput`"
    ]);
});

test("a fence indented under a list item is read", () => {
    assert.deepEqual(findingsFor(
        "1. Start it:\n" +
        "\n" +
        "   ```bash\n" +
        "   rebase dev --bogus\n" +
        "   rebase nosuchcommand\n" +
        "   ```\n"
    ), [
        "4: `rebase dev` does not accept `--bogus`",
        "5: `rebase nosuchcommand` is not a CLI command"
    ]);
});

test("the real CLI's surface is read the same way", () => {
    const { top, sub } = loadCliCommands(ROOT);
    const flags = loadCliFlags(ROOT);
    assert.ok(top.has("telemetry"));
    assert.ok(sub.get("telemetry")?.has("enable"), "telemetry dispatches subcommands");
    assert.ok(!sub.get("apps")?.has("backend"), "`backend` is an app type, not a subcommand");
    assert.ok(!sub.get("cloud")?.has("list"), "`list` belongs to `cloud projects`, not `cloud`");
    assert.ok(sub.get("cloud")?.has("deploy"));
    assert.ok(flags.get("generate-sdk")?.has("--output"), "generate-sdk's spec is in cli.ts");
    assert.ok(flags.has("telemetry"), "a spec with no flags still says which flags are accepted: none");
});
