/**
 * The CLI surface, read out of the CLI source rather than copied here.
 *
 * A hardcoded list is the same staleness bug the doc verifiers exist to catch —
 * it would have to be remembered every time a command, subcommand or flag is
 * added or renamed, and it would silently stop catching anything the day it
 * drifted. Deriving it means a removed subcommand starts failing the check on
 * the commit that removes it.
 *
 * This module was factored out of `check-marketing-snippets.mjs`, which is
 * where the command tree first grew. It had exactly one consumer and one glob
 * (`website/src/{components,pages}`), so the agent skills and the example
 * READMEs — the other two places a reader copies commands from — were never
 * checked against it. `check-doc-commands.mjs` is the second consumer.
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

/** Read a workspace file, or "" when it is not there. */
function read(root, rel) {
    try {
        return readFileSync(path.join(root, rel), "utf8");
    } catch {
        return "";
    }
}

/**
 * @returns {{ top: Set<string>, sub: Map<string, Set<string>|null> }}
 *   A command whose module exposes no dispatch table gets `null`, meaning "top
 *   level is known, subcommands are not checked" — better than inventing a list.
 */
export function loadCliCommands(root) {
    const cli = read(root, "packages/cli/src/cli.ts");
    const declared = cli.match(/const namespacedCommands = \[([^\]]*)\]/);
    const top = new Set(
        declared ? [...declared[1].matchAll(/"([a-z][a-z0-9-]*)"/g)].map(m => m[1]) : []
    );
    // Commands that take no subcommand still have to be recognised at the top.
    for (const name of ["init", "dev", "build", "start", "doctor", "eject", "generate-sdk"]) top.add(name);

    /** `case "x":` — how the CLI's own command modules dispatch. */
    const cases = source => {
        const found = [...source.matchAll(/case\s+"([a-z][a-z0-9-]*)"\s*:/g)].map(m => m[1]);
        return found.length ? new Set(found) : null;
    };

    const sub = new Map([
        ["auth", cases(read(root, "packages/cli/src/commands/auth.ts"))],
        ["skills", cases(read(root, "packages/cli/src/commands/skills.ts"))],
        ["api-keys", cases(read(root, "packages/cli/src/commands/api-keys.ts"))],
        ["apps", cases(read(root, "packages/cli/src/commands/apps.ts"))],
        ["cloud", cases(read(root, "packages/cli/src/commands/cloud/index.ts"))]
    ]);

    // `schema` and `db` do not dispatch themselves — they hand rawArgs to the
    // active database driver, so the real subcommand list lives there. `schema`
    // is written as `subcommand === "x"`; `db` gates on an explicit allowlist
    // first, and that allowlist is the authority on what `rebase db` accepts.
    const driver = read(root, "packages/server-postgres/src/cli.ts");
    const driverSubs = new Set([...driver.matchAll(/subcommand === "([a-z][a-z0-9-]*)"/g)].map(m => m[1]));
    if (driverSubs.size) sub.set("schema", driverSubs);

    const dbAllowlist = driver.match(/const VALID_ACTIONS = \[([^\]]*)\]/);
    if (dbAllowlist) {
        sub.set("db", new Set([...dbAllowlist[1].matchAll(/"([a-z][a-z0-9-]*)"/g)].map(m => m[1])));
    } else if (driverSubs.size) {
        sub.set("db", driverSubs);
    }

    // The driver's allowlist is not the whole of `rebase db`.
    //
    // `db.ts` answers `pull`, `stop` and `reset` ITSELF and returns before the
    // driver is ever reached — they are about the managed development database,
    // which no driver knows exists. Deriving the list from the driver alone made
    // this check report three real, working, `--help`-documented commands as
    // ones "a reader cannot run", which is the failure that gets a check
    // switched off rather than fixed.
    //
    // Read from `db.ts` rather than listed here, so a fourth one is picked up
    // the day it is written.
    const dbSelf = read(root, "packages/cli/src/commands/db.ts");
    const selfHandled = new Set(
        [...dbSelf.matchAll(/subcommand === "([a-z][a-z0-9-]*)"/g)].map(m => m[1])
    );
    if (selfHandled.size) {
        sub.set("db", new Set([...(sub.get("db") ?? []), ...selfHandled]));
    }

    return { top, sub };
}

/**
 * Accepted flags per top-level command, from the `arg({...})` specs.
 *
 * Only the keys are collected: `arg` accepts a key whether its value is a type
 * or an alias target, and an alias target is always some other key. Commands
 * that fan out across several modules (`cloud`) or into the driver (`db`,
 * `schema`) get the union of everything those files accept — permissive, but
 * still enough to catch a flag nobody implements.
 *
 * A command with no entry here is not flag-checked at all.
 */
export function loadCliFlags(root) {
    /**
     * The object literals passed to `arg(` — and only those. Scanning a whole
     * module for quoted flag-shaped keys also finds `case "--help":` in a
     * dispatch switch, which would claim `--help` is the *only* flag a command
     * accepts and then reject every real one.
     */
    const argSpecs = source => {
        const specs = [];
        // Two shapes, and BOTH are needed.
        //
        // The first is the spec written inline at the call: `arg({ … })` and the
        // CLI's two wrappers around it. The pattern has to name the call, or a
        // command's whole flag set silently disappears — that is not
        // hypothetical: `cloud deploy` moved from `arg(` to `parseCloudArgs(` on
        // 2026-08-25 and this check lost all eight of its flags, then reported a
        // documented line that works as a command a reader cannot run.
        //
        // The second is the spec hoisted to a named constant —
        // `const DEPLOY_FLAGS = { … }`, passed as `parseCloudArgs({ spec:
        // DEPLOY_FLAGS, … })`. Seven of them exist in the cloud family alone,
        // and hoisting is the direction the code is moving, because a spec has
        // to be exported for its help page and its tests to be checked against
        // it. Reading only the call site would therefore make the checker
        // *quieter* the more carefully a command is written, which is exactly
        // backwards — the same failure as the `parseCloudArgs` one above,
        // re-arriving through a different door.
        //
        // Restricted to identifiers ending in `FLAGS`, and matched by balanced
        // braces from the opening one, so nothing outside an object literal is
        // read. A whole-file scan for flag-shaped quoted keys would also match
        // `case "--help":` in a dispatch switch, and conclude that `--help` is
        // the only flag a command accepts.
        const openers = [
            /\b(?:arg|parseCloudArgs|parseCommandArgs)\(\s*\{/g,
            /\bconst\s+[A-Za-z_$][\w$]*FLAGS\s*(?::[^=]+)?=\s*\{/g
        ];
        for (const re of openers) {
            for (const m of source.matchAll(re)) {
                let depth = 1;
                let i = m.index + m[0].length;
                for (; i < source.length && depth > 0; i++) {
                    if (source[i] === "{") depth++;
                    else if (source[i] === "}") depth--;
                }
                if (depth === 0) specs.push(source.slice(m.index + m[0].length, i - 1));
            }
        }
        return specs;
    };

    /** `"--out": ` / `"-h": ` — object keys only, so alias targets are not double-counted. */
    const keys = source =>
        argSpecs(source).flatMap(spec => [...spec.matchAll(/"(-{1,2}[A-Za-z][\w-]*)"\s*:/g)].map(m => m[1]));

    const flags = new Map();
    const add = (command, source) => {
        const found = keys(source);
        if (!found.length) return;
        const set = flags.get(command) ?? new Set();
        for (const f of found) set.add(f);
        flags.set(command, set);
    };

    // Every module under commands/, indexed by its filename. `generate_sdk.ts`
    // backs `rebase generate-sdk`, so both spellings are registered.
    for (const rel of globSync("packages/cli/src/commands/*.ts", { cwd: root })) {
        const base = path.basename(rel, ".ts");
        if (base.endsWith(".test")) continue;
        const source = read(root, rel);
        add(base, source);
        if (base.includes("_")) add(base.replace(/_/g, "-"), source);
    }

    for (const rel of globSync("packages/cli/src/commands/cloud/*.ts", { cwd: root })) {
        if (path.basename(rel).endsWith(".test.ts")) continue;
        add("cloud", read(root, rel));
    }

    const driver = read(root, "packages/server-postgres/src/cli.ts");
    if (driver) {
        add("db", driver);
        add("schema", driver);
    }

    // `db backup` parses its own argv in the backup module rather than in the
    // driver's cli.ts, so without this the union is missing `--out` — the flag
    // `rebase db --help` puts in its own examples. The symptom is a docs
    // finding against a command that works, which is worse than no finding: it
    // sends a reader to "fix" correct documentation.
    for (const rel of globSync("packages/server-postgres/src/backup/*.ts", { cwd: root })) {
        if (path.basename(rel).endsWith(".test.ts")) continue;
        add("db", read(root, rel));
    }

    // The same shape one level up: `db pull`, `stop` and `reset` are answered by
    // `db.ts` itself, and it reads their flags straight out of argv with
    // `readFlagValue(rawArgs, "--from")` rather than through an `arg({...})`
    // spec. `argSpecs` cannot see those, so `--from` and `--anonymize` looked
    // like flags the CLI rejects — again a finding against a command that works.
    const dbSelf = read(root, "packages/cli/src/commands/db.ts");
    if (dbSelf) {
        const manual = [
            ...dbSelf.matchAll(/readFlagValue\(\s*rawArgs\s*,\s*"(-{1,2}[A-Za-z][\w-]*)"/g),
            ...dbSelf.matchAll(/rawArgs\.includes\(\s*"(-{1,2}[A-Za-z][\w-]*)"\s*\)/g)
        ].map(m => m[1]);
        if (manual.length) {
            const set = flags.get("db") ?? new Set();
            for (const f of manual) set.add(f);
            flags.set("db", set);
        }
    }

    return flags;
}

/**
 * Binary names declared by workspace packages, mapped to the package that ships
 * them.
 *
 * The CLI's binary is `rebase`; its package is `@rebasepro/cli`. `rebase` on
 * the public registry is an unrelated third party's package, so a doc that says
 * `npm install -g rebase` or `npx rebase …` sends the reader to install and
 * execute a stranger's code. Deriving the mapping means every future package
 * whose bin name differs from its package name is covered the day it lands.
 */
export function loadWorkspaceBins(root) {
    const bins = new Map();
    for (const rel of globSync("packages/*/package.json", { cwd: root })) {
        let pkg;
        try {
            pkg = JSON.parse(read(root, rel));
        } catch {
            continue;
        }
        if (!pkg?.bin || !pkg.name) continue;
        const names = typeof pkg.bin === "string" ? [path.basename(rel, ".json")] : Object.keys(pkg.bin);
        for (const name of names) {
            if (name !== pkg.name) bins.set(name, pkg.name);
        }
    }
    return bins;
}

/**
 * Marketing copy says "rebase is", "rebase and", "rebase.pro" constantly, so a
 * bare `rebase <word>` match is only a command in two shapes:
 *
 *   1. after a shell prompt or a package runner — `$ rebase db push`;
 *   2. as a quoted string in *data* position — `command: "rebase db push"` or
 *      `const cmd = "rebase dev"`. The CLI page keeps its commands as data and
 *      adds the `$` in the template, so shape 1 alone never sees them; that is
 *      exactly where `rebase auth bootstrap` (no such subcommand) sat.
 *
 * Data position is what keeps shape 2 honest. A quoted string anywhere would
 * also match `search("rebase tutorial")`, where "rebase tutorial" is a search
 * query in an SDK example — an argument, not a command.
 */
export const CLI_INVOCATIONS = [
    /(?:\$\s*|npx\s+|pnpm dlx\s+|pnpm\s+)rebase ([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g,
    /[:=]\s*["'`]rebase ([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g
];
