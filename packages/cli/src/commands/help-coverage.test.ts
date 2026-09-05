/**
 * A command that the dispatch answers but no `--help` mentions does not exist.
 *
 * Not as a figure of speech: `db pull`, `db stop`, `db reset`, `db branch` and
 * `schema stale` all worked, and the only way to learn any of them was to read
 * the source. `rebase --help` is the index of the product; a command missing
 * from it is a feature shipped to nobody, and the ones missing here were the
 * recovery commands — the ones you go looking for at the moment you are least
 * able to go source-diving for them.
 *
 * The guard is written the other way round from the drift it catches: the
 * commands come out of the **dispatch**, not out of a list somebody remembered
 * to update. A `case` added without a help line fails here.
 *
 * The cloud family has its own coverage test — `cloud/cloud-help.test.ts` — and
 * a dispatcher shaped nothing like these (groups, then actions, with a JSON
 * mode), so it is not swept in from here.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entry } from "../cli";
import { apiKeysCommand } from "./api-keys";
import { appsCommand } from "./apps";
import { authCommand } from "./auth";
import { dbCommand } from "./db";
import { schemaCommand } from "./schema";
import { skillsCommand } from "./skills";
import { telemetryCommand } from "./telemetry";

const here = path.dirname(fileURLToPath(import.meta.url));

let printed: string[];

beforeEach(() => {
    printed = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Everything a help page printed, with the colour taken back out. */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;
function helpText(): string {
    return printed.join("\n").replace(ANSI, "");
}

/**
 * The names a dispatcher actually answers, read out of its own source.
 *
 * Scoped to one function, because these files hold other switches: `apps.ts`
 * switches on an app's `type` in `describeApp`, and a whole-file scan would
 * demand help lines for "backend" and "static". The function body runs to the
 * first `\n}` at column zero, which is how every one of these is formatted.
 */
function dispatchedNames(relativeFile: string, functionName: string): string[] {
    const source = fs.readFileSync(path.join(here, relativeFile), "utf8");
    const start = source.indexOf(`function ${functionName}(`);
    expect(start, `${functionName} not found in ${relativeFile}`).toBeGreaterThan(-1);
    const end = source.indexOf("\n}\n", start);
    const body = source.slice(start, end === -1 ? undefined : end);

    const names = new Set<string>();
    for (const match of body.matchAll(/case "([a-z][a-z0-9-]*)":/g)) names.add(match[1]);
    for (const match of body.matchAll(/subcommand === "([a-z][a-z0-9-]*)"/g)) names.add(match[1]);
    // `help` and the literal `--help` are the page itself, never a command.
    names.delete("help");
    return [...names];
}

describe("every command the dispatch answers appears in a help page", () => {
    it("rebase --help lists every top-level command", async () => {
        // `namespacedCommands` is the dispatch — `cli.ts` tests membership of it
        // before the switch — so this is the real list, not a copy of one.
        const source = fs.readFileSync(path.join(here, "..", "cli.ts"), "utf8");
        const declared = source.match(/const namespacedCommands = \[([^\]]+)\]/);
        expect(declared).not.toBeNull();
        const commands = [...declared![1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
        expect(commands.length).toBeGreaterThan(10);

        await entry(["node", "rebase", "--help"]);
        const help = helpText();

        for (const command of commands) {
            expect(help, `rebase --help does not mention "${command}"`).toContain(command);
        }
    });

    it("rebase db --help lists every db subcommand", async () => {
        // Split between two files: `db.ts` keeps `stop`, `reset`, `pull` and
        // `branch` (they write per-checkout CLI state), and the driver owns the
        // rest. A help page that knew only about one half is how `db pull`
        // stayed invisible.
        const cliSide = dispatchedNames("db.ts", "dbCommand");
        const driverSource = path.join(here, "..", "..", "..", "server-postgres", "src", "cli.ts");
        expect(fs.existsSync(driverSource), "the driver CLI moved; this guard needs its new path").toBe(true);
        const validActions = fs.readFileSync(driverSource, "utf8")
            .match(/const VALID_ACTIONS = \[([^\]]+)\]/);
        expect(validActions).not.toBeNull();
        const driverSide = [...validActions![1].matchAll(/"([^"]+)"/g)].map(m => m[1]);

        await dbCommand("--help", ["node", "rebase", "db", "--help"]);
        const help = helpText();

        for (const action of new Set([...cliSide, ...driverSide])) {
            expect(help, `rebase db --help does not mention "${action}"`).toContain(action);
        }
    });

    it("rebase schema --help lists every schema subcommand", async () => {
        const driverSource = fs.readFileSync(
            path.join(here, "..", "..", "..", "server-postgres", "src", "cli.ts"),
            "utf8"
        );
        const start = driverSource.indexOf("function schemaCommand(");
        const body = driverSource.slice(start, driverSource.indexOf("\n}\n", start));
        const actions = [...body.matchAll(/subcommand === "([a-z][a-z0-9-]*)"/g)].map(m => m[1]);
        expect(actions).toContain("stale");

        await schemaCommand("--help", ["node", "rebase", "schema", "--help"]);
        const help = helpText();

        for (const action of new Set(actions)) {
            expect(help, `rebase schema --help does not mention "${action}"`).toContain(action);
        }
    });

    it.each([
        ["auth", "auth.ts", "authCommand", authCommand],
        ["apps", "apps.ts", "appsCommand", appsCommand],
        ["skills", "skills.ts", "skillsCommand", skillsCommand],
        ["api-keys", "api-keys.ts", "apiKeysCommand", apiKeysCommand]
    ] as const)("rebase %s --help lists every subcommand", async (family, file, fn, command) => {
        const names = dispatchedNames(file, fn);
        expect(names.length, `no subcommands found in ${fn}`).toBeGreaterThan(0);

        await command("--help", ["node", "rebase", family, "--help"]);
        const help = helpText();

        for (const name of names) {
            expect(help, `rebase ${family} --help does not mention "${name}"`).toContain(name);
        }
    });

    it("rebase telemetry --help lists every subcommand", async () => {
        // Its dispatcher takes only `rawArgs`, so it does not fit the table.
        const names = dispatchedNames("telemetry.ts", "telemetryCommand");
        await telemetryCommand(["node", "rebase", "telemetry", "--help"]);
        const help = helpText();

        for (const name of names) {
            expect(help, `rebase telemetry --help does not mention "${name}"`).toContain(name);
        }
    });
});
