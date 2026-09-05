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
import { ACTION_HELP, printActionHelp } from "./action-help";
import { GLOBAL_SPEC_KEYS } from "./context";
import { CREATE_PROJECT_FLAGS } from "./projects";
import { CREATE_DATABASE_FLAGS } from "./databases";
import { DEPLOY_FLAGS } from "./deploy";
import { ENV_SET_FLAGS } from "./env";
import { RESOURCES_SET_FLAGS, BILLING_ACTIONS } from "./resources";
import { LOGIN_FLAGS } from "./auth";

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
    "db backup": {},
    "db pitr": { "--target": String },
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
    "webhooks create": { "--name": String, "--table": String, "--endpoint": String, "--events": String },
    "webhooks delete": {},
    billing: {},
    logs: null,
    status: null,
    "clusters verify": null,
    // The dials. `resources set` scans `rawArgs` rather than parsing a spec —
    // `--no-autoscale` is value-less — so `RESOURCES_SET_FLAGS` is the
    // description of that line, derived from `DIAL_FLAGS`.
    resources: null,
    "resources set": RESOURCES_SET_FLAGS,
    // Session, link and the operations whose only options are the global ones.
    // `{}` rather than `null` on purpose: it says "this command declares nothing
    // of its own", which turns the reverse check on — a page inventing a flag
    // here fails rather than being skipped.
    login: LOGIN_FLAGS,
    logout: {},
    whoami: null,
    link: {},
    unlink: null,
    use: null,
    open: null,
    rollback: {},
    cancel: {},
    start: {},
    stop: {},
    restart: {},
    metrics: null
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

/**
 * The action words a usage line offers — `cloud billing [setup|checkout]` →
 * `["setup", "checkout"]`.
 *
 * Only the bracketed group, so `cloud billing` itself and a `<slug>` placeholder
 * are not mistaken for actions.
 */
function actionWordsIn(usage: string): string[] {
    const group = /[[<]([a-z|-]+)[\]>]/.exec(usage);
    return group ? group[1].split("|") : [];
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
    const found = new Set<string>();
    for (const source of cloudSources()) {
        for (const match of source.matchAll(/command:\s*"cloud ([^"]+)"/g)) {
            found.add(match[1]);
        }
    }
    // A group page names itself the same way — `printGroupHelp({ command:
    // "cloud db", … })` — and IS the page for that word. Subtracted rather than
    // pattern-matched apart, so the two producers of the literal cannot be
    // told apart by regex luck.
    for (const group of commandsWithAGroupPage()) found.delete(group);
    return [...found].sort();
}

/** Every non-test module in this directory, minus the page file itself. */
function cloudSources(): string[] {
    const dir = __dirname;
    return fs.readdirSync(dir)
        // Not action-help.ts: its own entries carry the same literal, so
        // including it would make the check compare the list with itself.
        .filter(file => file.endsWith(".ts") && !file.includes(".test.") && file !== "action-help.ts")
        .map(file => fs.readFileSync(path.join(dir, file), "utf8"));
}

/** The commands answered by a rendered group page rather than an `ACTION_HELP` entry. */
function commandsWithAGroupPage(): string[] {
    const found = new Set<string>();
    for (const source of cloudSources()) {
        for (const match of source.matchAll(/printGroupHelp\(\{\s*command:\s*"cloud ?([^"]*)"/g)) {
            if (match[1]) found.add(match[1]);
        }
    }
    return [...found].sort();
}

/**
 * Every flag declared in a `spec:` handed to `parseCloudArgs`, from the source.
 *
 * Only that property, and deliberately not every `arg({…})` in the family: a
 * command that parses the raw line itself — `login`, `power`, `link` — MUST
 * declare `--project`, `-p` and `--yes`, because `arg` only consumes a flag
 * together with its value when the flag is in its spec, and an undeclared
 * `--project acme` would leave `acme` as a positional. Those declarations are
 * separate, permissive parses of the same line, not entries in a merge.
 *
 * A `spec:` is different. `parseCloudArgs` spreads it OVER the globals, so a key
 * that repeats one silently replaces it.
 */
function specFlagsBySource(): Array<{ file: string; flag: string }> {
    const found: Array<{ file: string; flag: string }> = [];
    for (const file of fs.readdirSync(__dirname)) {
        if (!file.endsWith(".ts") || file.includes(".test.")) continue;
        // context.ts DECLARES the globals; it is the one file allowed to.
        if (file === "context.ts") continue;
        const source = fs.readFileSync(path.join(__dirname, file), "utf8");
        for (const match of source.matchAll(/\bspec:\s*\{([^}]*)\}/g)) {
            for (const flag of match[1].matchAll(/"(-{1,2}[A-Za-z][\w-]*)"\s*:/g)) {
                found.push({ file,
flag: flag[1] });
            }
        }
    }
    // The specs hoisted into named constants, which the regex above cannot see
    // because they are not written at the call. `CREATE_DATABASE_FLAGS` is not
    // here: `db create` parses with `arg` directly, so it is in the first
    // category and has to declare `--project` for itself.
    for (const [name, spec] of [
        ["deploy.ts", DEPLOY_FLAGS],
        ["projects.ts", CREATE_PROJECT_FLAGS],
        ["env.ts", ENV_SET_FLAGS]
    ] as const) {
        for (const flag of Object.keys(spec)) found.push({ file: name,
flag });
    }
    return found;
}

describe("no command's spec redeclares a global flag", () => {
    /**
     * `parseCloudArgs` merges `GLOBAL_CLOUD_FLAGS` UNDER the command's own spec,
     * so a per-command key that repeats a global one wins the merge — and it
     * does not shadow the global's other readers, which go on reading the raw
     * line for themselves.
     *
     * `webhooks create --url` was the live instance. `resolveCloudUrl` reads
     * `--url` off the raw line for every command in this family, so
     * `webhooks create --name x --table y --url https://example.com/hook` sent
     * the customer's webhook endpoint to `requireClient` as the control plane to
     * authenticate against. The documented example could not create a webhook.
     * The flag is `--endpoint` now; this is the sweep for the class.
     */
    it("finds the specs it is checking, so an empty sweep cannot pass", () => {
        expect(specFlagsBySource().length).toBeGreaterThan(20);
    });

    it("declares no flag that GLOBAL_SPEC_KEYS already covers", () => {
        const collisions = specFlagsBySource().filter(entry => GLOBAL_SPEC_KEYS.has(entry.flag));
        expect(
            collisions.map(c => `${c.file}: ${c.flag}`),
            "a spec key with a global's spelling replaces the global in the merge, while the global's "
            + "other readers keep reading the raw line — so the two disagree about what the value means."
        ).toEqual([]);
    });
});

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

    it("finds the group pages it subtracts, so the subtraction cannot swallow the sweep", () => {
        // The other half of the same guard: if `printGroupHelp` were renamed,
        // this would return nothing and the subtraction would be a no-op — which
        // is the safe direction, but silent. If it returned everything, the
        // sweep above would pass vacuously.
        expect(commandsWithAGroupPage().sort()).toEqual(
            ["db", "debug", "domains", "env", "extensions", "orgs", "settings", "storage"]
        );
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

    /**
     * A group's usage line lists action words, and those words have to be the
     * ones the group dispatches.
     *
     * `cloud billing [portal|usage]` was the page; the dispatch answered `setup`
     * and `checkout`. So both documented words fell out of the chain into the
     * default action and printed the billing account — a page describing two
     * commands that do not exist, answering as if they did.
     */
    it.each([
        ["billing", BILLING_ACTIONS]
    ])("%s's usage line names the actions it dispatches", (key, dispatched) => {
        expect(actionWordsIn(ACTION_HELP[key].usage).sort()).toEqual([...dispatched].sort());
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
