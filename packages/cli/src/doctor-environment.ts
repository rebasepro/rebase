/**
 * The checks that need no database, and that catch what breaks a first run.
 *
 * `rebase doctor` compared three descriptions of a schema, which is the right
 * check for a project that is working and the wrong one for a project that has
 * never worked. Everything that stops a first run — the wrong Node, two
 * lockfiles disagreeing, two collections claiming one slug, a `JWT_SECRET`
 * short enough to be guessed, a half-installed workspace with three versions of
 * `@rebasepro/server` in it — happens before a single table is compared, and
 * doctor said nothing about any of it.
 *
 * Every function here is pure: it takes what it read and returns findings. The
 * reading and the printing are at the edges, in `commands/doctor.ts`, so each
 * check has a fixture that fails it without a filesystem, a project or a
 * database.
 */

/** One thing that is wrong, and what to do about it. */
export interface EnvironmentFinding {
    /** Which check produced it, for grouping in the report. */
    check: "node" | "package-manager" | "collections" | "env" | "versions" | "atlas";
    severity: "error" | "warning";
    message: string;
    fix: string;
}

// ── Atlas ────────────────────────────────────────────────────────────────

/** What is on disk for `@ariga/atlas`, read by `commands/doctor.ts`. */
export interface AtlasBinaryState {
    /** A `node_modules/.bin/atlas` the project's commands would find. */
    onPath: boolean;
    /** `@ariga/atlas/package.json` resolves from the project. */
    packageInstalled: boolean;
    /** The binary the package's `bin` names exists as a file. */
    binaryOnDisk: boolean;
    /** For the remedy: the reader's own package manager. */
    manager: string;
}

/**
 * Whether `db push`, `db generate` and `db migrate` can run at all.
 *
 * They shell out to `atlas`, and its absence is invisible until one of them is
 * run: `@ariga/atlas` downloads its platform binary in `preinstall`, pnpm 10+
 * and npm 12+ refuse a dependency's lifecycle scripts unless allowlisted, and
 * the install exits 0 either way. The scaffold allowlists it, so this is a
 * problem for the person who added `@rebasepro/server-postgres` to a project
 * they already had — five lines of `ERR_PNPM_IGNORED_BUILDS` and
 * `Failed to create bin … ENOENT`, several screens up, with nothing saying that
 * a schema push will fail later.
 *
 * Three states, because two of them need opposite advice. The package absent is
 * an install; the package present with no binary is an allowlist; the binary
 * present with no `.bin` shim is a re-install, and telling that reader their
 * build scripts are blocked sends them to a command that does nothing.
 */
export function checkAtlasBinary(state: AtlasBinaryState | null): EnvironmentFinding[] {
    if (!state || state.onPath) return [];

    if (!state.packageInstalled) {
        return [{
            check: "atlas",
            severity: "warning",
            message: "The atlas binary is not on PATH and @ariga/atlas is not installed — "
                + "`db push`, `db generate` and `db migrate` will fail.",
            fix: `Install it: ${state.manager} add -D @ariga/atlas, and allow its install script.`
        }];
    }

    if (!state.binaryOnDisk) {
        return [{
            check: "atlas",
            severity: "warning",
            message: "@ariga/atlas is installed and its binary is missing — its `preinstall` "
                + "script was blocked, so `db push` and `db migrate` will fail.",
            fix: "Allow the build script (pnpm: `allowBuilds` in pnpm-workspace.yaml or "
                + "`pnpm approve-builds`; npm: `allowScripts` in package.json), then re-install."
        }];
    }

    return [{
        check: "atlas",
        severity: "warning",
        message: "The atlas binary is on disk but node_modules/.bin/atlas is missing, "
            + "so nothing can invoke it.",
        fix: "Re-resolve the tree so the link is recreated: `pnpm install --force`, or delete "
            + "node_modules and install again."
    }];
}

// ── Node ─────────────────────────────────────────────────────────────────

/**
 * `20.11.0` → `[20, 11, 0]`, ignoring anything after the patch.
 *
 * A bare major is a version: `>=20` is how every `engines.node` in this repo is
 * written, and requiring a minor here made the whole check return nothing —
 * silently, which is the only way a check like this ever fails.
 */
function parseVersion(raw: string): [number, number, number] | null {
    const match = raw.trim().replace(/^v/, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/** The lowest version a `>=x.y.z` range admits, or null for anything else. */
export function minimumFromRange(range: string): [number, number, number] | null {
    const match = range.match(/>=\s*v?(\d+(?:\.\d+)?(?:\.\d+)?)/);
    return match ? parseVersion(match[1]) : null;
}

function isBelow(actual: [number, number, number], minimum: [number, number, number]): boolean {
    for (let i = 0; i < 3; i++) {
        if (actual[i] < minimum[i]) return true;
        if (actual[i] > minimum[i]) return false;
    }
    return false;
}

/**
 * Is the running Node old enough to break things that will not say so?
 *
 * The symptoms are not "unsupported Node". They are a syntax error inside a
 * dependency, a missing global, or — the one that costs the most time — a
 * `node:` builtin that resolves and then behaves differently. Naming the
 * version is the whole check.
 */
export function checkNodeVersion(running: string, required: string | undefined): EnvironmentFinding[] {
    if (!required) return [];
    const minimum = minimumFromRange(required);
    const actual = parseVersion(running);
    if (!minimum || !actual) return [];
    if (!isBelow(actual, minimum)) return [];

    return [{
        check: "node",
        severity: "error",
        message: `Node ${running} is running, and Rebase needs ${required}.`,
        fix: `Install Node ${minimum[0]} or newer (nvm install ${minimum[0]}), then reinstall dependencies.`
    }];
}

// ── Package manager ──────────────────────────────────────────────────────

/** The lockfiles a project may have, and the manager each one belongs to. */
export const LOCKFILES: Record<string, string> = {
    "pnpm-lock.yaml": "pnpm",
    "package-lock.json": "npm",
    "yarn.lock": "yarn",
    "bun.lockb": "bun"
};

/**
 * Two package managers in one project.
 *
 * A Rebase project is a pnpm workspace, and running `npm install` inside one
 * rewrites `node_modules` into a hoisted layout that pnpm then disagrees with.
 * The result is not an install error: it is `Cannot find module` from inside a
 * dependency, hours later, on a machine where it worked yesterday. The
 * leftover `package-lock.json` is the only durable evidence, and nothing looked
 * at it.
 */
export function checkPackageManager(
    lockfilesPresent: string[],
    declared: string | undefined
): EnvironmentFinding[] {
    const known = lockfilesPresent.filter(file => file in LOCKFILES);
    if (known.length < 2) {
        // One lockfile, or none. A single one that disagrees with
        // `packageManager` is worth saying too.
        const declaredName = declared?.split("@")[0];
        if (known.length === 1 && declaredName && LOCKFILES[known[0]] !== declaredName) {
            return [{
                check: "package-manager",
                severity: "warning",
                message: `This project declares packageManager "${declared}" and has a ${LOCKFILES[known[0]]} lockfile (${known[0]}).`,
                fix: `Delete ${known[0]} and node_modules, then install with ${declaredName}.`
            }];
        }
        return [];
    }

    const managers = known.map(file => LOCKFILES[file]);
    return [{
        check: "package-manager",
        severity: "error",
        message: `Two package managers have installed here: ${known.join(" and ")}.`,
        fix: `Keep one. Delete the others and node_modules, then reinstall with ${declared?.split("@")[0] ?? managers[0]}.`
    }];
}

// ── Collections ──────────────────────────────────────────────────────────

/**
 * Two collections claiming one slug.
 *
 * The slug is the route, the table lookup and the registry key, and the
 * registry keeps the last one registered. So the loser is not reported missing:
 * it is served as the winner, with the winner's properties, under its own name.
 * Every symptom of this points somewhere else.
 */
export function checkDuplicateSlugs(
    collections: Array<{ slug?: string; name?: string }>
): EnvironmentFinding[] {
    const byslug = new Map<string, number>();
    for (const collection of collections) {
        if (!collection.slug) continue;
        byslug.set(collection.slug, (byslug.get(collection.slug) ?? 0) + 1);
    }

    return [...byslug]
        .filter(([, count]) => count > 1)
        .map(([slug, count]) => ({
            check: "collections" as const,
            severity: "error" as const,
            message: `${count} collections declare the slug "${slug}". Only the last one registered is served.`,
            fix: `Give each collection its own slug. The one that loses is not reported missing — it answers as the winner.`
        }));
}

// ── .env ─────────────────────────────────────────────────────────────────

/** What `loadEnv` requires of a JWT secret. Mirrors `rebaseEnvSchema`. */
export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * The two `.env` facts that fail late and confusingly.
 *
 * A short `JWT_SECRET` boots fine and is refused by `loadEnv` only in
 * production, which is the worst place to find out. Missing CORS in production
 * is the opposite shape — it does not fail at all; the API simply accepts
 * requests from anywhere.
 *
 * Values are never echoed. This reads a file that holds every credential the
 * project has, and doctor's output goes wherever a terminal goes.
 */
export function checkEnvSanity(values: Record<string, string>): EnvironmentFinding[] {
    const findings: EnvironmentFinding[] = [];
    const production = values.NODE_ENV === "production";

    const secret = values.JWT_SECRET;
    if (secret !== undefined && secret.length > 0 && secret.length < MIN_JWT_SECRET_LENGTH) {
        findings.push({
            check: "env",
            severity: production ? "error" : "warning",
            message: `JWT_SECRET is ${secret.length} characters. The runtime requires at least ${MIN_JWT_SECRET_LENGTH}, and refuses to boot below it in production.`,
            fix: "Generate one: openssl rand -hex 32"
        });
    }

    if (production && !values.CORS_ORIGINS && !values.FRONTEND_URL) {
        findings.push({
            check: "env",
            severity: "error",
            message: "NODE_ENV=production with neither CORS_ORIGINS nor FRONTEND_URL set — the API will accept requests from any origin.",
            fix: "Set CORS_ORIGINS to the origins that may call this API."
        });
    }

    return findings;
}

/**
 * Parse a `.env` into a plain object.
 *
 * Deliberately not `dotenv`: this must not touch `process.env`, and doctor may
 * be reading a file for a different environment than the one it is running in.
 */
export function parseEnvFile(text: string): Record<string, string> {
    const values: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).replace(/^export\s+/, "").trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
}

// ── Version skew ─────────────────────────────────────────────────────────

/** One `@rebasepro/*` dependency, and where it was declared. */
export interface DeclaredDependency {
    /** Where it was declared, relative to the project root. */
    file: string;
    name: string;
    /** The range exactly as written. */
    range: string;
}

/**
 * The same `@rebasepro/*` package pinned to different versions in one project.
 *
 * A Rebase project declares them in several package.json files — the root, the
 * backend, the frontend, the config workspace — and nothing has ever compared
 * them. The failure that produces is not an install error: pnpm installs both,
 * `instanceof` stops working across the two copies, and the symptom is a
 * `CollectionConfig` that fails a type guard written against an identical type.
 *
 * `workspace:` ranges are excluded: inside this repo's own workspaces they all
 * resolve to the same build by construction.
 */
export function checkVersionSkew(declared: DeclaredDependency[]): EnvironmentFinding[] {
    const byPackage = new Map<string, Map<string, string[]>>();

    for (const dependency of declared) {
        if (!dependency.name.startsWith("@rebasepro/")) continue;
        if (dependency.range.startsWith("workspace:") || dependency.range.startsWith("link:")) continue;
        if (dependency.range === "*" || dependency.range === "latest") continue;

        const ranges = byPackage.get(dependency.name) ?? new Map<string, string[]>();
        ranges.set(dependency.range, [...(ranges.get(dependency.range) ?? []), dependency.file]);
        byPackage.set(dependency.name, ranges);
    }

    const findings: EnvironmentFinding[] = [];
    for (const [name, ranges] of byPackage) {
        if (ranges.size < 2) continue;
        const described = [...ranges]
            .map(([range, files]) => `${range} (${files.join(", ")})`)
            .join(", ");
        findings.push({
            check: "versions",
            severity: "error",
            message: `${name} is pinned to different versions in this project: ${described}.`,
            fix: "Pin one version everywhere and reinstall. Two copies of a Rebase package break `instanceof` between them, which fails as a type guard rejecting its own type."
        });
    }
    return findings;
}
