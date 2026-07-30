/**
 * Telling a *stale* driver apart from a driver that never had the feature.
 *
 * The managed runtime is two halves that version independently. The image
 * supplies `@rebasepro/server` — `docker/entrypoint.mjs` symlinks it over
 * whatever the bundle installed, so the boot harness is always the image's. The
 * **driver** is not redirected: `@rebasepro/server-postgres` comes from the
 * bundle's `deps.declared`, pinned to whatever the project's `package.json`
 * asked npm for. Shipping a new image therefore does not ship a new driver, and
 * a fix that spans both packages reaches a tenant only after an npm publish AND
 * a rebuild.
 *
 * That split has a nasty failure mode, and it has already burned a day. Boot
 * looks for an optional capability, does not find it, and reports the honest
 * local fact — "this driver does not implement collection-table creation" —
 * which is exactly what a schemaless driver looks like. But a driver that is
 * merely *older than the runtime asking* looks identical, and the two want
 * opposite responses: one is "this database is not managed by Rebase, carry on",
 * the other is "your tables were never created and every data route is about to
 * 500". Naming the versions is what separates them, so these helpers exist to
 * put both numbers in front of whoever reads the log.
 */
import fs from "fs";
import path from "path";

/** The package whose version defines "the runtime" for skew purposes. */
const RUNTIME_PACKAGE = "@rebasepro/server";

/**
 * Locate a package by walking `node_modules` up from a directory.
 *
 * Lives here rather than in `driver.ts` because both the driver loader and the
 * version check need it, and `driver.ts` already imports this module.
 */
export function findPackageDir(fromDir: string, packageName: string): string | undefined {
    let dir = path.resolve(fromDir);
    for (;;) {
        const candidate = path.join(dir, "node_modules", ...packageName.split("/"));
        if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

interface ParsedVersion {
    parts: number[];
    /** `canary.g7f1150f` in `0.12.1-canary.g7f1150f`, absent on a release. */
    prerelease?: string;
}

/**
 * Parse the subset of semver the workspace actually publishes.
 *
 * Deliberately lenient: an unparseable version yields `undefined` and every
 * comparison then declines to judge, because a wrong "your driver is old"
 * warning on a fork's custom version string is worse than no warning at all.
 */
function parseVersion(version: string): ParsedVersion | undefined {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version.trim());
    if (!match) return undefined;
    return {
        parts: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4]
    };
}

/**
 * Compare two versions, or `undefined` when either cannot be parsed.
 *
 * Follows semver on the one rule that matters here: a prerelease sorts *below*
 * the release it leads to, so `0.12.1-canary.g7f1150f` < `0.12.1`. Without that
 * rule every canary would read as newer than the stable it precedes, and the
 * canaries are precisely where fixes land first.
 */
export function compareVersions(a: string, b: string): number | undefined {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (!left || !right) return undefined;

    for (let i = 0; i < 3; i++) {
        if (left.parts[i] !== right.parts[i]) return left.parts[i] < right.parts[i] ? -1 : 1;
    }
    if (left.prerelease === right.prerelease) return 0;
    if (left.prerelease === undefined) return 1;
    if (right.prerelease === undefined) return -1;
    return left.prerelease < right.prerelease ? -1 : 1;
}

export interface DriverSkew {
    /** True only when both versions parsed AND the driver is genuinely older. */
    stale: boolean;
    /**
     * A clause naming both versions, ready to append to a sentence. Present
     * whenever both versions are known — including when they agree, because
     * "the driver is current" is the fact that redirects an investigation away
     * from staleness and toward the real cause.
     */
    detail?: string;
}

/**
 * Describe how a driver's version relates to the runtime asking it for work.
 *
 * Returns `stale: false` whenever it cannot tell — an unknown version, an
 * unparseable one, a driver that is newer. Silence beats a confident wrong
 * diagnosis, and the caller still prints its own local fact either way.
 */
export function describeDriverSkew(
    driverVersion: string | undefined,
    runtimeVersion: string | undefined
): DriverSkew {
    if (!driverVersion || !runtimeVersion) return { stale: false };
    const order = compareVersions(driverVersion, runtimeVersion);
    if (order === undefined) return { stale: false };
    if (order < 0) {
        return {
            stale: true,
            detail:
                `The driver is at ${driverVersion} while this runtime is ${runtimeVersion} — ` +
                "the driver is OLDER, so this is very likely a stale pin rather than a driver " +
                "that never had the capability."
        };
    }
    return {
        stale: false,
        detail: `Driver ${driverVersion}, runtime ${runtimeVersion}.`
    };
}

/**
 * How to get a project's schema applied, written once and owned by the runtime.
 *
 * This text lives in `@rebasepro/server` on purpose. The equivalent guidance in
 * the Postgres driver's schema-drift warning can only ever be as current as the
 * driver a tenant pinned — so the tenants who most need to be told "your driver
 * is too old" are exactly the ones whose driver still prints the old advice.
 * The image's copy of this package is never stale, so guidance printed from
 * here always reflects the platform as it is today.
 *
 * Both audiences get a line because the runtime cannot reliably tell which one
 * it is serving, and naming only the pnpm scripts — as this once did everywhere
 * — tells a managed operator to run a command that structurally cannot reach
 * their in-cluster database.
 */
export function schemaRecoveryGuidance(options: { staleDriver?: boolean } = {}): string {
    const lines = [
        "  To apply this project's schema:",
        "    • Managed cloud: the runtime applies tables and RLS at boot (unless",
        "      REBASE_MIGRATE_ON_BOOT=none). `rebase db push` cannot reach a tenant's",
        "      in-cluster database — redeploy instead."
    ];
    if (options.staleDriver) {
        lines.push(
            "      Because the driver is pinned by your bundle, bump the",
            "      `@rebasepro/server-postgres` version in your project's package.json",
            "      and redeploy — a newer platform image alone will NOT update it."
        );
    }
    lines.push("    • Self-host: run `rebase db push` (dev) or `rebase db migrate` (prod).");
    return lines.join("\n");
}

/**
 * The installed version of a package, read from its `package.json`.
 *
 * Returns `undefined` rather than throwing for every failure — a missing or
 * malformed manifest degrades the diagnosis, and must never take down a boot
 * that would otherwise have served.
 */
export function readPackageVersion(packageDir: string): string | undefined {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")) as {
            version?: unknown;
        };
        return typeof pkg.version === "string" ? pkg.version : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The version of `@rebasepro/server` this deployment is actually running.
 *
 * Resolved from the same roots the drivers are, and that is the point rather
 * than a convenience. In a managed container `docker/entrypoint.mjs` replaces
 * `/bundle/node_modules/@rebasepro/server` with a link to the image's copy, so
 * reading the manifest *through the bundle* reports the version that will
 * really execute — which is exactly the number the driver has to be compared
 * against. Reading this package's own manifest by module path would report the
 * same thing in the happy case and quietly lie in the case that matters: a
 * bundle whose link did not happen.
 *
 * Returns `undefined` when the package cannot be found; every caller treats
 * that as "cannot judge" and stays quiet.
 */
export function readRuntimeVersion(roots: string[]): string | undefined {
    for (const root of roots) {
        const dir = findPackageDir(root, RUNTIME_PACKAGE);
        const version = dir ? readPackageVersion(dir) : undefined;
        if (version) return version;
    }
    return undefined;
}
