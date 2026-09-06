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
import { doctorCommand, DOCTOR_FLAGS } from "./doctor";
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

    /**
     * The third level, and the one `db branch` needed: the page is written by
     * hand in `db.ts` while the actions are dispatched by the driver, so the
     * two drift silently. `rebase db branch --help` went two releases without
     * `prune`, which the dispatch answers and `backend/branching.md` teaches.
     *
     * `switch` is the exception in the other direction — the CLI answers it
     * before the driver is spawned — so the expected set is the union.
     */
    it("rebase db branch --help lists every action the dispatch answers", async () => {
        const driverSource = fs.readFileSync(
            path.join(here, "..", "..", "..", "server-postgres", "src", "cli.ts"),
            "utf8"
        );
        const start = driverSource.indexOf("async function branchCommand(");
        expect(start, "branchCommand moved; this guard needs its new name").toBeGreaterThan(-1);
        const body = driverSource.slice(start, driverSource.indexOf("\n}\n", start));
        const actions = [...body.matchAll(/case "([a-z][a-z0-9-]*)":/g)].map(m => m[1]);
        expect(actions, "the driver dispatch was not read").toContain("prune");

        await dbCommand("branch", ["node", "rebase", "db", "branch", "--help"]);
        const help = helpText();

        // `switch` is answered CLI-side (`db.ts`), so it is in the page and not
        // in the driver's switch. Both belong on the one help page.
        for (const action of new Set([...actions, "switch"])) {
            expect(help, `rebase db branch --help does not mention "${action}"`).toContain(action);
        }
    });

    it("rebase db branch --help lists every flag its specs declare", async () => {
        const driverSource = fs.readFileSync(
            path.join(here, "..", "..", "..", "server-postgres", "src", "cli.ts"),
            "utf8"
        );
        const declared = driverSource.match(/const BRANCH_FLAGS = \{([\s\S]*?)\n\} as const;/);
        expect(declared, "BRANCH_FLAGS moved; this guard needs its new shape").not.toBeNull();
        // Long flags only: a short alias is documented next to the long one it
        // resolves to, not on a line of its own.
        const flags = [...declared![1].matchAll(/"(--[a-z-]+)":\s*(?!")/g)].map(m => m[1]);
        expect(flags).toContain("--older-than");

        await dbCommand("branch", ["node", "rebase", "db", "branch", "--help"]);
        const help = helpText();

        // `--force` is read straight off the line rather than through the spec
        // (`rawArgs.includes("--force")`), which is exactly why it has to be
        // named here: nothing else in the tree records that it exists.
        for (const flag of new Set([...flags, "--force"])) {
            expect(help, `rebase db branch --help does not mention "${flag}"`).toContain(flag);
        }
    });

    it("rebase doctor --help lists every flag its spec declares", async () => {
        // The command's one flag is the documented CI gate — `cli/index.md`
        // calls `rebase doctor --policies` "the form to use as a CI gate" — and
        // the page had no Options section at all, so the only way to find it was
        // to read the driver.
        await doctorCommand(["node", "rebase", "doctor", "--help"]);
        const help = helpText();

        const longFlags = Object.entries(DOCTOR_FLAGS)
            .filter(([name, spec]) => name.startsWith("--") && typeof spec !== "string")
            .map(([name]) => name);
        expect(longFlags).toContain("--policies");

        for (const flag of longFlags) {
            expect(help, `rebase doctor --help does not mention "${flag}"`).toContain(flag);
        }
    });
});
