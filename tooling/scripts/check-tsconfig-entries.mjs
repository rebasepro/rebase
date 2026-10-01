/**
 * Every path a tsconfig names has to exist.
 *
 * TypeScript accepts an `include` that matches nothing and says nothing. When
 * `e2e/` moved to `tests/e2e/` (3959d813c, 2026-08-24) the commit updated the
 * `exclude` entry in tsconfig.typecheck.json and not the `include`, so from that
 * day `pnpm typecheck` read none of the Playwright specs, the global setup, or
 * the drivers that import `packages/client` source directly — a renamed client
 * API would have surfaced minutes into an e2e job instead of in the type gate.
 * The same file mapped `hono` to `./node_modules/hono`, which the isolated
 * layout has never created: TypeScript fell back to ordinary resolution and the
 * dedupe the entry was written for did nothing.
 *
 * So, for every tracked tsconfig: `extends`, `files`, `references`, the static
 * part of each `include`, and every `paths` target, resolved the way tsc
 * resolves them, must name something on disk. A glob is checked up to its
 * first wildcard — `packages/*\/src` needs `packages/`, which is all a reader can
 * promise about it.
 *
 * A `paths` target is a module specifier, so it counts as there when tsc would
 * find it: `../config/index` is `../config/index.ts`.
 *
 * Two kinds of target are not this check's business, and are skipped by name:
 *
 *   - generated output (`dist`, `build`, Astro's `.astro`), which a fresh clone
 *     and the static job do not have, and which the build exists to write;
 *   - the scaffold templates under packages/cli/templates, whose tsconfigs
 *     describe the project `rebase init` creates, not this repository. Their
 *     paths resolve after scaffolding, which `check:templates` exercises.
 *
 *     pnpm check:tsconfig-entries
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

/** Not this repository's program: see the header. */
const SKIPPED_DIRS = ["packages/cli/templates/"];

/** Generated output: absent before the build, by design. */
const BUILD_OUTPUT = /(^|\/)(dist|build|\.astro)(\/|$)/;

/** What tsc tries, in order, for a module specifier with no extension. */
const MODULE_SUFFIXES = ["", ".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json",
    "/index.ts", "/index.tsx", "/index.d.ts", "/index.js", "/package.json"];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** The part of a pattern before its first wildcard segment. */
function staticPrefix(pattern) {
    const segments = pattern.split("/");
    const firstGlob = segments.findIndex((segment) => /[*?[{]/.test(segment));
    return firstGlob === -1 ? pattern : segments.slice(0, firstGlob).join("/");
}

/**
 * The entries in one tsconfig that name nothing.
 *
 * Exported so the gate's own test can hand it a fixture directory.
 *
 * @returns {{ field: string, entry: string, resolved: string }[]}
 */
export function deadEntries(configPath) {
    const dir = path.dirname(configPath);
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (error) {
        return [{ field: "(file)", entry: ts.flattenDiagnosticMessageText(error.messageText, "\n"), resolved: configPath }];
    }

    const dead = [];
    const check = (field, entry, base, { prefix = false, module = false } = {}) => {
        if (typeof entry !== "string" || entry === "") return;
        const target = prefix ? staticPrefix(entry) : entry;
        if (target === "" || target === ".") return;
        const resolved = path.resolve(base, target);
        if (BUILD_OUTPUT.test(path.relative(ROOT, resolved))) return;
        const candidates = module ? MODULE_SUFFIXES.map((suffix) => resolved + suffix) : [resolved];
        if (!candidates.some((candidate) => fs.existsSync(candidate))) dead.push({ field, entry, resolved });
    };

    const extendsList = Array.isArray(config.extends) ? config.extends : config.extends ? [config.extends] : [];
    for (const entry of extendsList) {
        // A package name (`@tsconfig/node22`) resolves through node_modules.
        if (entry.startsWith(".") || path.isAbsolute(entry)) {
            check("extends", entry.endsWith(".json") ? entry : `${entry}.json`, dir);
        }
    }
    for (const entry of config.files ?? []) check("files", entry, dir);
    for (const entry of config.include ?? []) check("include", entry, dir, { prefix: true });
    for (const ref of config.references ?? []) check("references", ref?.path, dir);

    const options = config.compilerOptions ?? {};
    const pathsBase = options.baseUrl ? path.resolve(dir, options.baseUrl) : dir;
    for (const [alias, targets] of Object.entries(options.paths ?? {})) {
        for (const target of targets) check(`paths["${alias}"]`, target, pathsBase, { prefix: true, module: true });
    }
    return dead;
}

/** Every tracked tsconfig this check owns. */
export function trackedConfigs(root = ROOT) {
    return execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", "-z", "--", "*tsconfig*.json"], {
        cwd: root,
        encoding: "utf8"
    })
        .split("\0")
        .filter(Boolean)
        .filter((rel) => !SKIPPED_DIRS.some((skip) => rel.startsWith(skip)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
    const configs = trackedConfigs();
    const findings = configs.flatMap((rel) =>
        deadEntries(path.join(ROOT, rel)).map((finding) => ({ rel, ...finding })));

    if (findings.length === 0) {
        console.log(green(`✓ ${configs.length} tsconfig(s): every extends, files, include, references and paths entry names something on disk.`));
        process.exit(0);
    }
    console.error(red(`✗ ${findings.length} tsconfig entr${findings.length === 1 ? "y names" : "ies name"} nothing:\n`));
    for (const { rel, field, entry, resolved } of findings) {
        console.error(`    ${rel}  ${field}: ${JSON.stringify(entry)}  ${dim(`→ ${path.relative(ROOT, resolved) || resolved}`)}`);
    }
    console.error(dim(
        "\n    TypeScript does not complain about these. An include that matches nothing\n" +
        "    drops those files from the program in silence, and a paths target that is\n" +
        "    not there falls back to ordinary resolution as if it had never been\n" +
        "    written. Point it at what moved, or delete it.\n"
    ));
    process.exit(1);
}
