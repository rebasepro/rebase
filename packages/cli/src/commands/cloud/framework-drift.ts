/**
 * A platform upgrade that moved the live app past this checkout.
 *
 * A fleet rollout rebuilds a managed app from its last deploy's source on a
 * newer `@rebasepro` release, and records that release on the project as
 * `platformRebuiltVersion` while the rebuilt bundle is the live one. The next
 * deploy from a checkout still pinning the old release is refused by intake
 * (`FRAMEWORK_DOWNGRADE`) — rightly, since it would put the older admin panel
 * and driver back. What was missing was being told before that: the only
 * record was a deployment row's log nobody reads, so the developer met it as a
 * refused deploy at the end of a full build.
 *
 * `cloud status` and the deploy's preflight read the same field and say it
 * first, with the one command that fixes it.
 */
import fs from "node:fs";
import path from "node:path";
import { isDowngrade } from "../../upgrade";
import type { CloudClient } from "./context";

/**
 * The `@rebasepro` version a project directory resolves: `@rebasepro/server`
 * (at the root or under `backend/`, where a bundle built here reads it as
 * `runtime.builtAgainst`), else `@rebasepro/client`. Walked up from `dir`, so a
 * subdirectory of the project answers for it. Undefined when none is installed.
 */
export function localFrameworkVersion(dir: string): string | undefined {
    const candidates = [
        ["node_modules", "@rebasepro", "server"],
        ["backend", "node_modules", "@rebasepro", "server"],
        ["node_modules", "@rebasepro", "client"]
    ];
    let current = path.resolve(dir);
    for (;;) {
        for (const parts of candidates) {
            try {
                const manifest = path.join(current, ...parts, "package.json");
                const version = (JSON.parse(fs.readFileSync(manifest, "utf8")) as { version?: unknown }).version;
                if (typeof version === "string" && version.trim() !== "") return version.trim();
            } catch {
                /* not here — keep looking */
            }
        }
        const parent = path.dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
}

/** The live app runs a newer framework than this checkout, because the platform rebuilt it. */
export interface FrameworkDrift {
    /** What the platform rebuilt the live app on. */
    live: string;
    /** What this checkout resolves. */
    local: string;
    /** The command that brings the checkout up to the live app. */
    nextAction: string;
}

/** The drift between the platform's rebuild and this checkout, or undefined when there is none to report. */
export function frameworkDrift(
    platformRebuiltVersion: string | null | undefined,
    local: string | undefined
): FrameworkDrift | undefined {
    const live = platformRebuiltVersion?.trim();
    if (!live || !local || !isDowngrade(live, local)) return undefined;
    return { live, local, nextAction: `rebase upgrade --to ${live}` };
}

/** What both commands say about a drift: the fact, and what to do before deploying. */
export function driftSentence(drift: FrameworkDrift): { message: string; hint: string } {
    return {
        message: `A platform upgrade rebuilt this app on @rebasepro ${drift.live}; this checkout is on ${drift.local}.`,
        hint: `Run \`${drift.nextAction}\` before the next deploy: a deploy built on ${drift.local} is refused, `
            + "because it would put the older admin panel and database driver back. "
            + "`--allow-downgrade` deploys the older release on purpose."
    };
}

/** `platformRebuiltVersion` off a project row, in either spelling, or undefined. */
export function platformRebuiltVersionOf(row: unknown): string | undefined {
    if (typeof row !== "object" || row === null) return undefined;
    const raw = "platformRebuiltVersion" in row ? row.platformRebuiltVersion
        : "platform_rebuilt_version" in row ? row.platform_rebuilt_version : undefined;
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/**
 * The release a bundle deploy from here would ship: what a prebuilt bundle's
 * manifest says it was built against (`--bundle-dir`), else what this project
 * resolves — the same reading the build makes.
 */
export function deployFrameworkVersion(bundleDir: string | undefined, cwd: string = process.cwd()): string | undefined {
    if (bundleDir) {
        try {
            const manifest: unknown = JSON.parse(fs.readFileSync(path.join(path.resolve(cwd, bundleDir), "manifest.json"), "utf8"));
            const runtime = typeof manifest === "object" && manifest !== null && "runtime" in manifest ? manifest.runtime : undefined;
            const builtAgainst = typeof runtime === "object" && runtime !== null && "builtAgainst" in runtime ? runtime.builtAgainst : undefined;
            if (typeof builtAgainst === "string" && builtAgainst !== "unknown" && builtAgainst.trim() !== "") return builtAgainst.trim();
        } catch {
            /* no readable manifest: the project's packages answer instead */
        }
    }
    return localFrameworkVersion(cwd);
}

/**
 * The drift between the project's live rebuild and `local`, read off the
 * project row. Best effort in one direction only: a read that fails, or a
 * version that cannot be read, is no drift — intake still decides.
 */
export async function readFrameworkDrift(
    client: CloudClient,
    projectId: string,
    local: string | undefined
): Promise<FrameworkDrift | undefined> {
    if (!local) return undefined;
    try {
        return frameworkDrift(platformRebuiltVersionOf(await client.data.table("projects").findById(projectId)), local);
    } catch {
        return undefined;
    }
}
