/**
 * Old bundles keep booting on new runtimes.
 *
 * That is the entire reason the artifact and the engine are versioned
 * separately, so it is worth a test rather than an assumption. A format-1
 * bundle — `mode`, a single `entry.static` string, `entry.admin` — predates the
 * rename and is still sitting in every deployed project that has not been
 * rebuilt.
 *
 * The failure it guards is silent: with no `kind`, every gate keyed on
 * `kind === "backend"` skips, so migrate-on-boot stops running and the static
 * loader iterates a string as if it were a list.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION } from "@rebasepro/types";
import { loadBundle, readBundleManifest, BundleError } from "./bundle";

let scratch: string;

function writeBundle(manifest: Record<string, unknown>, files: string[] = []): string {
    const dir = fs.mkdtempSync(path.join(scratch, "bundle-"));
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    for (const relative of files) {
        const full = path.join(dir, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, "x");
    }
    return dir;
}

const runtime = {
    range: "^1",
    builtAgainst: "1.0.0",
    contract: RUNTIME_CONTRACT_VERSION
};

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-compat-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("a format-1 bundle on this runtime", () => {
    it("reads `mode: cms` as a backend", () => {
        const dir = writeBundle({
            bundleFormat: 1,
            runtime,
            schemaVersion: "abc",
            app: "backend",
            mode: "cms",
            entry: { config: "config" },
            hooks: { native: false },
            deps: { declared: {} }
        });

        expect(readBundleManifest(dir).kind).toBe("backend");
    });

    it("reads `mode: baas` as a backend too — the distinction is entry.config now", () => {
        const dir = writeBundle({
            bundleFormat: 1,
            runtime,
            schemaVersion: "",
            app: "backend",
            mode: "baas",
            entry: {},
            hooks: { native: false },
            deps: { declared: {} }
        });

        const manifest = readBundleManifest(dir);
        expect(manifest.kind).toBe("backend");
        // And it must NOT look like a project with declared collections, or
        // migrate-on-boot would push a schema into a database it only reads.
        expect(manifest.entry?.config).toBeUndefined();
    });

    it("reads `mode: static` as a static bundle", () => {
        const dir = writeBundle({
            bundleFormat: 1,
            runtime,
            schemaVersion: "",
            app: "web",
            mode: "static",
            entry: { static: "static" },
            hooks: { native: false },
            deps: { declared: {} }
        }, ["static/index.html"]);

        expect(readBundleManifest(dir).kind).toBe("static");
    });

    it("turns a single entry.static directory into a list mounted at the root", () => {
        const dir = writeBundle({
            bundleFormat: 1,
            runtime,
            schemaVersion: "",
            app: "web",
            mode: "static",
            entry: { static: "static" },
            hooks: { native: false },
            deps: { declared: {} }
        }, ["static/index.html"]);

        const bundle = loadBundle(dir);
        expect(bundle.staticApps).toHaveLength(1);
        expect(bundle.staticApps[0]).toMatchObject({ path: "/",
spa: true });
        expect(bundle.staticApps[0].dir).toBe(path.join(dir, "static"));
    });

    it("serves a bundled admin panel from entry.admin, as `staticDir ?? adminDir` did", () => {
        const dir = writeBundle({
            bundleFormat: 1,
            runtime,
            schemaVersion: "abc",
            app: "backend",
            mode: "cms",
            entry: { config: "config",
admin: "admin" },
            hooks: { native: false },
            deps: { declared: {} }
        }, ["admin/index.html"]);

        const bundle = loadBundle(dir);
        expect(bundle.staticApps).toHaveLength(1);
        expect(bundle.staticApps[0].dir).toBe(path.join(dir, "admin"));
    });
});

describe("a format-2 bundle", () => {
    it("passes through untouched", () => {
        const dir = writeBundle({
            bundleFormat: BUNDLE_FORMAT_VERSION,
            runtime,
            schemaVersion: "abc",
            app: "backend",
            kind: "backend",
            entry: {
                config: "config",
                static: [
                    { path: "/admin", dir: "static/admin", spa: true },
                    { path: "/", dir: "static/site", spa: true }
                ]
            },
            hooks: { native: false },
            deps: { declared: {} }
        }, ["static/admin/index.html", "static/site/index.html"]);

        const bundle = loadBundle(dir);
        expect(bundle.manifest.kind).toBe("backend");
        // Longest path first, so the root app's catch-all is registered last.
        expect(bundle.staticApps.map(a => a.path)).toEqual(["/admin", "/"]);
    });

    it("drops a declared static app whose directory is missing, and keeps the rest", () => {
        const dir = writeBundle({
            bundleFormat: BUNDLE_FORMAT_VERSION,
            runtime,
            schemaVersion: "abc",
            app: "backend",
            kind: "backend",
            entry: {
                static: [
                    { path: "/admin", dir: "static/admin", spa: true },
                    { path: "/", dir: "static/gone", spa: true }
                ]
            },
            hooks: { native: false },
            deps: { declared: {} }
        }, ["static/admin/index.html"]);

        expect(loadBundle(dir).staticApps.map(a => a.path)).toEqual(["/admin"]);
    });
});

describe("a newer format than this runtime understands", () => {
    it("refuses to boot rather than half-loading it", () => {
        const dir = writeBundle({
            bundleFormat: BUNDLE_FORMAT_VERSION + 1,
            runtime,
            schemaVersion: "abc",
            app: "backend",
            kind: "backend",
            entry: {},
            hooks: { native: false },
            deps: { declared: {} }
        });

        expect(() => readBundleManifest(dir)).toThrow(BundleError);
        expect(() => readBundleManifest(dir)).toThrow(/understands up to/);
    });
});

/**
 * Additive changes must never break a reader.
 *
 * This is the property that makes the whole arrangement survivable. A bundle is
 * produced by one release and read by two others — this runtime, and a control
 * plane that ships on its own cadence and cannot import these types at all. If
 * adding a field required every reader to be updated first, the format could
 * never move without a synchronised release of three things.
 *
 * So: unknown fields are ignored, at the same format version. Only a change that
 * makes an existing field unreadable earns a `bundleFormat` bump.
 */
describe("a same-format bundle carrying fields this runtime does not know", () => {
    const futureBundle = () => writeBundle({
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime,
        schemaVersion: "abc",
        app: "backend",
        kind: "backend",
        entry: {
            config: "config",
            static: [{ path: "/", dir: "static/site", spa: true, preload: ["/app.js"] }],
            // A future entry kind this runtime has never heard of.
            workers: "workers"
        },
        hooks: { native: false },
        deps: { declared: {} },
        // Whole sections added by a later CLI.
        telemetry: { sampleRate: 0.1 },
        edge: { regions: ["fra1"] }
    }, ["static/site/index.html"]);

    it("loads, ignoring what it does not recognise", () => {
        const bundle = loadBundle(futureBundle());
        expect(bundle.manifest.kind).toBe("backend");
        expect(bundle.staticApps).toHaveLength(1);
    });

    it("still reads every field it does know", () => {
        const bundle = loadBundle(futureBundle());
        expect(bundle.manifest.entry?.config).toBe("config");
        expect(bundle.staticApps[0]).toMatchObject({ path: "/",
spa: true });
    });
});

/**
 * Changing either version number is a coordinated release, not an edit.
 *
 * These constants are the contract between three independently-shipped things,
 * and one of them — the control plane — keeps a hand-written copy of this shape
 * because it cannot depend on this package. Nothing can make that copy update
 * itself. What this test can do is make the bump impossible to perform by
 * accident: it fails, and the failure is the checklist.
 *
 * Raising BUNDLE_FORMAT_VERSION means, in this order:
 *
 *   1. Teach `upgradeLegacyManifest` (boot/bundle.ts) to read the OLD shape.
 *      Old bundles booting on new runtimes is the reason the number exists, and
 *      it is the direction nothing else checks — a missing field simply reads as
 *      undefined and every gate keyed on it skips, silently.
 *   2. Raise SUPPORTED_BUNDLE_FORMAT in the control plane
 *      (saas/backend/src/managed/bundle-manifest.ts) and teach
 *      `parseBundleManifest` to accept BOTH shapes.
 *   3. SHIP THE CONTROL PLANE FIRST. It rejects a format it does not know, so a
 *      CLI released ahead of it turns every deploy into MALFORMED_MANIFEST or
 *      BUNDLE_FORMAT_TOO_NEW, and the message blames the user's manifest.
 *   4. Then release the CLI and the runtime image.
 *
 * Raising RUNTIME_CONTRACT_VERSION additionally invalidates every project's
 * `rebase` range, so it is a major of the whole product, not a format tweak.
 *
 * It was raised to **2** when resources moved from configuration to
 * declaration: `RebaseBackendConfig.dataSources` and `.storageSources` are gone,
 * a v1 bundle exports them, and a v2 runtime refuses them at boot. The managed
 * tier moves projects onto new images without rebuilding, so accepting them
 * quietly would have crash-looped a fleet on one rollout. The control plane's
 * SUPPORTED_RUNTIME_CONTRACT was raised first, per step 3 above.
 */
describe("the version constants", () => {
    it("are what every current consumer was written against", () => {
        expect(BUNDLE_FORMAT_VERSION).toBe(2);
        expect(RUNTIME_CONTRACT_VERSION).toBe(2);
    });
});
