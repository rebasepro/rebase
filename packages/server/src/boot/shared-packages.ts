import fs from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Lets a bundle load the runtime image's drizzle-orm and pg instead of its own
 * copies, when the image's are versions the bundle could have installed itself.
 *
 * A pod holds two trees of each. The server loads the image's
 * (`/app/node_modules`), and the project's schema and its database driver load
 * the bundle's (`/bundle/node_modules`), because the driver comes from the
 * bundle. Node keys a module by its real path, so the process keeps both
 * copies for the life of the pod.
 *
 * They are not on the runtime-provided list with zod and hono, because the
 * driver and the image are released separately and drizzle breaks its API
 * between minor versions. Pointing an old driver built against 0.45 at an image
 * that moved to 0.46 would break that project at the next image upgrade. So the
 * bundle keeps installing its own copies, and at boot its imports go to the
 * image's only when each satisfies `^<the bundle's version>`: same minor (below
 * 1.0) or same major, same patch or newer. Otherwise the bundle's own copies
 * load, as before.
 *
 * The two are shared together or not at all. drizzle's node-postgres driver
 * imports pg and parses every result with pg's type parsers, so drizzle from
 * the image with pg from the bundle would parse the driver's queries with a
 * different pg than the one a project's `pg.types.setTypeParser` configures.
 *
 * Done with a resolve hook rather than a symlink. Nothing in the bundle changes,
 * so the decision is made again on every boot from the versions actually
 * there: a self-hosted bundle is a directory on the host that outlives image
 * upgrades, and replacing its copy with a link would leave it pointing at
 * whatever the next image ships, with nothing left to compare against. A
 * read-only bundle works the same way.
 *
 * Both `import` and `require()` are redirected, so pg's ESM entry and its
 * CommonJS one (the same module underneath) stay one instance. An import from a
 * bundle package with its own nested copy (another version range) is left
 * alone: only an import that would have resolved to the bundle's top-level
 * copy is redirected.
 *
 * No local imports, so a test can load this file in a real Node process; jest's
 * module sandbox has no loader to hook.
 */

/** Packages a bundle installs for itself and shares with the image, all together, when the versions allow it. */
export const SHARED_WHEN_COMPATIBLE = ["drizzle-orm", "pg"] as const;

/** What boot decided for one package, for its log line. */
export interface SharedPackageDecision {
    package: string;
    /** The version installed in the bundle. */
    bundle: string;
    /** The version the image ships, or `null` when the image has no copy. */
    runtime: string | null;
    shared: boolean;
}

interface Redirect {
    /** Real path of the bundle's top-level copy, `<bundle>/node_modules/<package>`. */
    own: string;
    /** Real path of the bundle root; imports from outside it are never redirected. */
    bundleRoot: string;
    /** Real path of the image's copy; every redirected answer must be inside it. */
    provided: string;
    /** The same, as a URL prefix. */
    providedURL: string;
    /** A parent URL from which an `import` of the package resolves to the image's copy. */
    anchor: string;
    /** `require` from the same place, for `require()` calls. */
    requireFromImage: NodeJS.Require;
    /** Per directory: whether an import from a file in it resolves to `own`. */
    reachesOwn: Map<string, boolean>;
}

const redirects = new Map<string, Redirect>();
let hookInstalled = false;

/**
 * Whether `offered` is a version npm would accept for `^installed`: same
 * major, same minor while the major is 0, and not older. A pre-release, or a
 * version this cannot read, matches only itself.
 */
export function isCaretCompatible(installed: string, offered: string): boolean {
    if (installed === offered) return true;
    const a = parseRelease(installed);
    const b = parseRelease(offered);
    if (!a || !b) return false;
    if (a[0] !== b[0]) return false;
    if (a[0] === 0 && a[1] !== b[1]) return false;
    if (a[0] === 0 && a[1] === 0) return false; // ^0.0.x pins the patch too
    for (let i = 1; i < 3; i++) {
        if (b[i] !== a[i]) return b[i] > a[i];
    }
    return true;
}

function parseRelease(version: string): [number, number, number] | undefined {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function readVersion(packageDir: string): string | undefined {
    try {
        const manifest: unknown = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
        if (manifest && typeof manifest === "object" && "version" in manifest && typeof manifest.version === "string") {
            return manifest.version;
        }
    } catch {
        // Absent or unreadable: nothing to compare, so nothing is shared.
    }
    return undefined;
}

function safeRealpath(file: string): string | undefined {
    try {
        return fs.realpathSync(file);
    } catch {
        return undefined;
    }
}

/**
 * Decide whether the bundle's imports of {@link SHARED_WHEN_COMPATIBLE} load
 * the image's copies, and install the resolve hook that makes it so. Call
 * before anything is imported from the bundle.
 *
 * Every package the bundle has must be one the image ships at a compatible
 * version, or none is shared. A package the bundle does not have is not part
 * of the decision. A no-op without an image (`imageModules` undefined) and
 * under `--preserve-symlinks`, where parent URLs are not real paths.
 */
export function shareCompatiblePackages(
    bundleRoot: string,
    imageModules: string | undefined,
    preserveSymlinks = false
): SharedPackageDecision[] {
    if (!imageModules || preserveSymlinks) return [];
    const realBundle = safeRealpath(bundleRoot);
    const realModules = safeRealpath(imageModules);
    if (!realBundle || !realModules) return [];

    const found: { pkg: string; own: string; provided: string | undefined; bundle: string; runtime: string | undefined }[] = [];
    for (const pkg of SHARED_WHEN_COMPATIBLE) {
        const own = safeRealpath(path.join(realBundle, "node_modules", pkg));
        const bundle = own && readVersion(own);
        if (!own || !bundle) continue;
        const provided = safeRealpath(path.join(realModules, pkg));
        // Already the image's directory (a bundle whose copy is a link to it):
        // one copy already, nothing to decide.
        if (own === provided) continue;
        found.push({ pkg, own, provided, bundle, runtime: provided && readVersion(provided) });
    }

    const shared = found.length > 0
        && found.every(entry => entry.provided && entry.runtime && isCaretCompatible(entry.bundle, entry.runtime));

    for (const pkg of SHARED_WHEN_COMPATIBLE) redirects.delete(pkg);
    if (shared) {
        for (const { pkg, own, provided } of found) {
            if (!provided) continue;
            const anchorFile = path.join(provided, "package.json");
            redirects.set(pkg, {
                own,
                bundleRoot: realBundle,
                provided,
                providedURL: pathToFileURL(provided).href + "/",
                anchor: pathToFileURL(anchorFile).href,
                requireFromImage: createRequire(anchorFile),
                reachesOwn: new Map()
            });
        }
        installHook();
    }
    return found.map(({ pkg, bundle, runtime }) => ({ package: pkg, bundle, runtime: runtime ?? null, shared }));
}

function installHook(): void {
    if (hookInstalled) return;
    registerHooks({
        resolve(specifier, context, nextResolve) {
            const parentURL = context.parentURL;
            const redirect = redirectFor(specifier, parentURL);
            if (!redirect) return nextResolve(specifier, context);
            // Only an answer inside the image's copy is taken. Anything else,
            // including a subpath the image's copy does not export, falls back
            // to the resolution Node would have made. With the parent passed
            // again explicitly: Node writes the context it was handed back into
            // `context`, so after a call it may hold the anchor.
            try {
                if (context.conditions?.includes("require")) {
                    // A changed parent URL is ignored for `require()`, so the
                    // file is found from the image's copy and handed over by path.
                    const file = redirect.requireFromImage.resolve(specifier);
                    if (file.startsWith(redirect.provided + path.sep)) return nextResolve(file, { ...context, parentURL });
                } else {
                    const resolved = nextResolve(specifier, { ...context, parentURL: redirect.anchor });
                    if (resolved.url.startsWith(redirect.providedURL)) return resolved;
                }
            } catch {
                // Resolved below, against the bundle's own copy.
            }
            return nextResolve(specifier, { ...context, parentURL });
        }
    });
    hookInstalled = true;
}

/** The redirect that applies to importing `specifier` from `parentURL`, if any. */
function redirectFor(specifier: string, parentURL: string | undefined): Redirect | undefined {
    if (redirects.size === 0 || !parentURL || !parentURL.startsWith("file:")) return undefined;
    for (const [pkg, redirect] of redirects) {
        if (specifier !== pkg && !specifier.startsWith(pkg + "/")) continue;
        const parent = fileURLToPath(parentURL);
        if (!parent.startsWith(redirect.bundleRoot + path.sep)) return undefined;
        return reachesOwnCopy(path.dirname(parent), pkg, redirect) ? redirect : undefined;
    }
    return undefined;
}

/**
 * Whether Node, resolving `pkg` from a file in `dir`, would land on the bundle's
 * top-level copy rather than a nearer one in a nested `node_modules`. Walks up
 * as Node does, stopping at the bundle root, and remembers every directory it
 * passed.
 */
function reachesOwnCopy(dir: string, pkg: string, redirect: Redirect): boolean {
    const passed: string[] = [];
    let answer = false;
    for (let at = dir; ; at = path.dirname(at)) {
        const known = redirect.reachesOwn.get(at);
        if (known !== undefined) {
            answer = known;
            break;
        }
        passed.push(at);
        if (path.basename(at) !== "node_modules") {
            const candidate = path.join(at, "node_modules", pkg);
            if (fs.existsSync(candidate)) {
                answer = safeRealpath(candidate) === redirect.own;
                break;
            }
        }
        if (at === redirect.bundleRoot || path.dirname(at) === at) break;
    }
    for (const at of passed) redirect.reachesOwn.set(at, answer);
    return answer;
}
