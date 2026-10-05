/**
 * A flag's value is never the action.
 *
 * The dispatcher names the action as the first word after the group, and `arg`
 * only consumes a flag's value when the flag is declared — so every value flag
 * the dispatcher did not know about left its value standing in the action's
 * place. Lines each command's help offers were refused as unknown commands:
 *
 *   rebase cloud deployments --limit 5               → action "5"
 *   rebase cloud debug --host staging.example.com    → action "staging.example.com"
 *   rebase cloud debug --since 2h logs               → action "2h"
 *   rebase cloud projects --name shop create         → action "shop"
 *   rebase cloud cron --host staging.example.com     → action "staging.example.com"
 *
 * The dispatcher now declares every value flag of the family
 * (`CLOUD_VALUE_FLAGS`). That list is only as good as its completeness, so the
 * first block below rebuilds it from the specs the commands themselves declare
 * and holds the two together in both directions.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./debug", () => ({ debugCommand: vi.fn(), printDebugHelp: vi.fn() }));
vi.mock("./cron", () => ({ cronCommand: vi.fn() }));
vi.mock("./tokens", () => ({ tokensCommand: vi.fn() }));
vi.mock("./deployments", () => ({ deploymentsListCommand: vi.fn(), rollbackCommand: vi.fn(), cancelCommand: vi.fn() }));
vi.mock("./projects", () => ({ listProjects: vi.fn(), createProject: vi.fn(), projectInfo: vi.fn(), deleteProject: vi.fn() }));
vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return { ...actual, initOutputMode: vi.fn() };
});
vi.mock("./resources", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./resources")>();
    return { ...actual, storageCommand: vi.fn(), computeCommand: vi.fn() };
});

const { cloudCommand, positionals, CLOUD_VALUE_FLAGS } = await import("./index");
const { GLOBAL_CLOUD_FLAGS } = await import("./context");
const { COMPUTE_SET_FLAGS, storageCommand, computeCommand } = await import("./resources");
const { debugCommand } = await import("./debug");
const { cronCommand } = await import("./cron");
const { tokensCommand } = await import("./tokens");
const { deploymentsListCommand } = await import("./deployments");
const { createProject } = await import("./projects");

const argv = (...words: string[]) => ["node", "rebase", "cloud", ...words];

/* ── the list, held to the specs ─────────────────────────────────── */

type Declared = Map<string, Set<string>>;

/**
 * Every flag a module in this directory declares, and what it is declared as:
 * `String`, `Number`, `Boolean`, `[String]`, or `alias:--target`.
 *
 * Read from the source because most specs are literals written at the call
 * (`spec: { "--target": String }`), which no import can reach. `index.ts` is
 * left out: it holds the list under test, and reading it would compare the
 * list with itself. `COMPUTE_SET_FLAGS` is added by import, because it is
 * built from `DIAL_FLAGS` in code rather than written as a literal.
 */
function declaredFlags(): Declared {
    const declared: Declared = new Map();
    const add = (flag: string, kind: string) => {
        if (!declared.has(flag)) declared.set(flag, new Set());
        declared.get(flag)!.add(kind);
    };
    for (const file of fs.readdirSync(__dirname)) {
        if (!file.endsWith(".ts") || file.includes(".test.") || file === "index.ts") continue;
        const source = fs.readFileSync(path.join(__dirname, file), "utf8");
        const entry = /"(-{1,2}[A-Za-z][\w-]*)"\s*:\s*(String|Number|Boolean|\[String\]|\[Number\]|"(-{1,2}[A-Za-z][\w-]*)")/g;
        for (const match of source.matchAll(entry)) {
            add(match[1], match[3] ? `alias:${match[3]}` : match[2]);
        }
    }
    for (const [flag, type] of Object.entries(COMPUTE_SET_FLAGS)) {
        add(flag, type === Boolean ? "Boolean" : "String");
    }
    return declared;
}

const VALUE_KINDS = new Set(["String", "Number", "[String]", "[Number]"]);

function takesValue(declared: Declared, flag: string): boolean {
    const kinds = [...(declared.get(flag) ?? [])];
    return kinds.some(kind => VALUE_KINDS.has(kind)
        || (kind.startsWith("alias:") && takesValue(declared, kind.slice("alias:".length))));
}

describe("CLOUD_VALUE_FLAGS", () => {
    const declared = declaredFlags();
    const globals = new Set(Object.keys(GLOBAL_CLOUD_FLAGS));

    it("finds the specs it is checking, so an empty sweep cannot pass", () => {
        expect(declared.size).toBeGreaterThan(60);
        expect(takesValue(declared, "--limit")).toBe(true);
        expect(takesValue(declared, "--previous")).toBe(false);
    });

    it("names every flag a command declares with a value, and nothing else", () => {
        const expected = [...declared.keys()].filter(flag => !globals.has(flag) && takesValue(declared, flag)).sort();
        expect(
            Object.keys(CLOUD_VALUE_FLAGS).sort(),
            "CLOUD_VALUE_FLAGS in index.ts is out of step with the commands' specs. A value flag missing " +
            "from it leaves its value in the action's place; a boolean in it swallows the action."
        ).toEqual(expected);
    });

    it("points each short spelling where the commands point it", () => {
        for (const [flag, value] of Object.entries(CLOUD_VALUE_FLAGS)) {
            if (typeof value === "string") expect(declared.get(flag)).toContain(`alias:${value}`);
        }
    });

    it("can be one list, because no flag takes a value in one command and none in another", () => {
        const both = [...declared.keys()].filter(flag => {
            const kinds = [...declared.get(flag)!];
            return kinds.includes("Boolean") && kinds.some(kind => VALUE_KINDS.has(kind));
        });
        expect(both, "a flag that is a boolean somewhere and takes a value elsewhere").toEqual([]);
    });
});

/* ── what positionals() reads ────────────────────────────────────── */

describe("positionals", () => {
    it.each([
        [["deployments", "--limit", "5"], ["deployments"]],
        [["deployments", "--limit=5"], ["deployments"]],
        [["--limit", "5", "deployments"], ["deployments"]],
        [["debug", "--host", "staging.example.com"], ["debug"]],
        [["debug", "--since", "2h", "logs"], ["debug", "logs"]],
        [["projects", "-n", "shop", "create"], ["projects", "create"]],
        [["compute", "--cpu", "2", "set"], ["compute", "set"]],
        [["storage", "--bucket", "b", "attach"], ["storage", "attach"]],
        // A boolean takes nothing with it.
        [["debug", "--previous", "logs"], ["debug", "logs"]],
        // The globals, as before.
        [["-p", "acme", "env", "list"], ["env", "list"]]
    ])("reads %j as %j", (words, expected) => {
        // The words, as the dispatcher reads them: a flag `arg` did not consume
        // — an undeclared boolean — stays in the list, and is skipped when the
        // action is named.
        expect(positionals(argv(...words)).filter(word => !word.startsWith("-"))).toEqual(expected);
    });

    it("does not throw on a value flag left without its value — the command says so", () => {
        expect(positionals(argv("deployments", "--limit"))[0]).toBe("deployments");
    });
});

/* ── through the dispatcher ──────────────────────────────────────── */

describe("the dispatcher", () => {
    beforeEach(() => vi.clearAllMocks());
    const exit = vi.spyOn(process, "exit");
    afterEach(() => exit.mockReset());

    it.each([
        ["debug --host <h>", ["debug", "--host", "staging.example.com"], debugCommand, undefined],
        ["debug --since 2h logs", ["debug", "--since", "2h", "logs"], debugCommand, "logs"],
        ["cron --host <h>", ["cron", "--host", "staging.example.com"], cronCommand, undefined],
        ["tokens --can deploy create", ["tokens", "--can", "deploy", "create"], tokensCommand, "create"],
        ["compute --cpu 2 set", ["compute", "--cpu", "2", "set"], computeCommand, "set"],
        ["storage --bucket b attach", ["storage", "--bucket", "b", "attach"], storageCommand, "attach"]
    ])("hands `%s` to its group with the right action", async (_label, words, handler, action) => {
        await cloudCommand(words[0], argv(...words));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(vi.mocked(handler).mock.calls[0][0]).toBe(action);
    });

    it("runs `deployments --limit 5` as the list it is", async () => {
        await cloudCommand("deployments", argv("deployments", "--limit", "5"));
        expect(deploymentsListCommand).toHaveBeenCalledTimes(1);
    });

    it("runs `projects --name shop create` as the create it is", async () => {
        await cloudCommand("projects", argv("projects", "--name", "shop", "create"));
        expect(createProject).toHaveBeenCalledTimes(1);
    });

    it("finds the action's own --help page past a value flag", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        await cloudCommand("projects", argv("projects", "--name", "shop", "create", "--help"));
        const printed = log.mock.calls.map(call => String(call[0])).join("\n");
        log.mockRestore();
        expect(printed).toContain("rebase cloud projects create");
        expect(createProject).not.toHaveBeenCalled();
    });
});
