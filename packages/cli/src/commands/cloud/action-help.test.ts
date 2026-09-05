/**
 * The per-action `--help` pages, held to the specs they describe.
 *
 * A help page that lists flags is only worth having if it is the SAME list the
 * command parses. `rebase cloud projects create --help` printed the generic
 * index — no flags at all — so `--name`, `--subdomain` and `--type` were found
 * by reading `dist/index.es.js.map` on a real first deploy. A page that lists
 * them but drifts is the same problem one release later, and worse, because it
 * looks authoritative.
 *
 * So the pairing below is the guard: every entry in `ACTION_HELP` is matched to
 * the `arg` spec its command actually parses, and both directions are checked.
 * A flag added to a command with no line in its page fails here, on the commit
 * that adds it.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ACTION_HELP, GLOBAL_SPEC_KEYS, printActionHelp } from "./action-help";
import { CREATE_PROJECT_FLAGS } from "./projects";
import { CREATE_DATABASE_FLAGS } from "./databases";
import { DEPLOY_FLAGS } from "./deploy";
import { ENV_SET_FLAGS } from "./env";

/**
 * Which spec backs which page.
 *
 * `null` means "this command declares no spec of its own" — `status` takes only
 * the global flags, and `logs` parses permissively inside its handler. Spelled
 * out rather than omitted so that the completeness check below can tell a
 * command with nothing to declare from one somebody forgot.
 */
const SPECS: Record<string, Record<string, unknown> | null> = {
    projects: null,
    clusters: null,
    "projects create": CREATE_PROJECT_FLAGS,
    "projects delete": {},
    "db create": CREATE_DATABASE_FLAGS,
    "db backup": { "--yes": Boolean },
    "db pitr": { "--target": String, "--yes": Boolean },
    deploy: DEPLOY_FLAGS,
    deployments: null,
    "deployments list": { "--limit": Number, "--all": Boolean },
    "domains add": {},
    "domains remove": {},
    "env set": ENV_SET_FLAGS,
    "env pull": { "--output": String, "--out": "--output" },
    "storage create": {},
    "storage attach": {
        "--bucket": String,
        "--access-key-id": String,
        "--secret-access-key": String,
        "--endpoint": String,
        "--region": String,
        "--force-path-style": Boolean
    },
    webhooks: null,
    "webhooks create": { "--name": String, "--table": String, "--url": String, "--events": String },
    "webhooks delete": {},
    billing: {},
    logs: null,
    status: null,
    "clusters verify": null,
    "clusters add": {
        "--name": String,
        "--provider": String,
        "--region": String,
        "--kubeconfig": String,
        "--base-domain": String,
        "--ingress-address": String,
        "--platform-capacity": Boolean,
        "--backup-bucket": String,
        "--backup-endpoint": String,
        "--backup-access-key-id": String,
        "--backup-secret-access-key": String
    }
};

/** `--name, -n <name>` → `--name`. The page spells flags for a reader. */
function documentedNames(entry: { flags: Array<[string, string]> }): Set<string> {
    const names = new Set<string>();
    for (const [spelling] of entry.flags) {
        for (const token of spelling.split(",")) {
            const flag = token.trim().split(/\s/)[0];
            if (flag.startsWith("-")) names.add(flag);
        }
    }
    return names;
}

/** Spec keys a page has to document: not the globals, not the aliases. */
function documentableKeys(spec: Record<string, unknown>): string[] {
    return Object.entries(spec)
        .filter(([key, value]) => !GLOBAL_SPEC_KEYS.has(key) && typeof value !== "string")
        .map(([key]) => key);
}

/**
 * Every command that names itself, read out of the source.
 *
 * `parseCloudArgs({ command: "cloud storage attach", … })` is a command
 * declaring, in one place, that it parses its own line — so it is also the list
 * of commands whose line a reader needs described. Derived rather than
 * hand-listed, because a hand-listed one is exactly what was missing: thirteen
 * commands had their own flag spec and no page, `--help` fell through to their
 * group's index, and nothing failed. `storage attach`'s six flags were read out
 * of `dist/index.es.js` by somebody deploying a real project.
 */
function commandsThatParseTheirOwnLine(): string[] {
    const dir = __dirname;
    const found = new Set<string>();
    for (const file of fs.readdirSync(dir)) {
        // Not action-help.ts: its own entries carry the same literal, so
        // including it would make the check compare the list with itself.
        if (!file.endsWith(".ts") || file.includes(".test.") || file === "action-help.ts") continue;
        const source = fs.readFileSync(path.join(dir, file), "utf8");
        for (const match of source.matchAll(/command:\s*"cloud ([^"]+)"/g)) {
            found.add(match[1]);
        }
    }
    return [...found].sort();
}

describe("ACTION_HELP", () => {
    it("has a page for every command that parses its own line", () => {
        const missing = commandsThatParseTheirOwnLine().filter(command => !ACTION_HELP[command]);
        expect(
            missing,
            `no --help page for: ${missing.join(", ")}. A command with its own flags and no page ` +
            "falls through to its group's index, which lists sibling actions and not one flag."
        ).toEqual([]);
    });

    it("finds the commands it is checking, so an empty sweep cannot pass", () => {
        // Without this, a rename of `parseCloudArgs`'s `command` field would
        // make the check above vacuous and silent.
        expect(commandsThatParseTheirOwnLine().length).toBeGreaterThan(10);
    });

    it("pairs every page with a spec, or with an explicit null", () => {
        // Without this, adding a page and forgetting the pairing would silently
        // exempt it from every check below.
        expect(Object.keys(SPECS).sort()).toEqual(Object.keys(ACTION_HELP).sort());
    });

    it.each(Object.keys(ACTION_HELP))("%s documents every flag its command parses", (key) => {
        const spec = SPECS[key];
        if (!spec) return;
        const documented = documentedNames(ACTION_HELP[key]);
        for (const flag of documentableKeys(spec)) {
            expect(documented, `${key} does not document ${flag}`).toContain(flag);
        }
    });

    it.each(Object.keys(ACTION_HELP))("%s documents no flag its command would reject", (key) => {
        const spec = SPECS[key];
        if (!spec) return;
        // The other direction, and the one that catches a renamed flag: a page
        // naming a flag the parser does not declare sends the reader to a
        // command that exits on `ARG_UNKNOWN_OPTION`.
        for (const flag of documentedNames(ACTION_HELP[key])) {
            expect(
                Object.keys(spec).includes(flag) || GLOBAL_SPEC_KEYS.has(flag),
                `${key} documents ${flag}, which its spec does not declare`
            ).toBe(true);
        }
    });

    it.each(Object.keys(ACTION_HELP))("%s carries a usage line and at least one example", (key) => {
        const entry = ACTION_HELP[key];
        expect(entry.usage.startsWith("cloud ")).toBe(true);
        expect(entry.examples.length).toBeGreaterThan(0);
        // Every example is a runnable line, not a fragment — this is what a
        // reader copies, and `check-doc-commands.mjs` checks the same shape for
        // the markdown.
        for (const example of entry.examples) expect(example.startsWith("rebase cloud ")).toBe(true);
    });

    it("says, on the two commands that hide it, where a managed database comes from", () => {
        // The fact the whole ticket turns on: nothing is provisioned until the
        // first deploy, so `db test` failing before then is not a fault, and
        // polling for readiness never terminates.
        const notes = [...(ACTION_HELP["db create"].notes ?? []), ...(ACTION_HELP["projects create"].notes ?? [])]
            .join(" ");
        expect(notes.toLowerCase()).toContain("first deploy");
    });
});

describe("printActionHelp", () => {
    it("prints the flags rather than the index page", () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        try {
            printActionHelp(ACTION_HELP["projects create"]);
            const printed = log.mock.calls.map(c => String(c[0])).join("\n");
            expect(printed).toContain("--subdomain");
            expect(printed).toContain("--db <managed|byodb|none>");
        } finally {
            log.mockRestore();
        }
    });
});
