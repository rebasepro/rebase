/**
 * Which bundles this runtime boots.
 *
 * Format 3 / runtime contract 2 is where tables begin: the schema is
 * `entry.tables` (a compiled `backend/schema`). Every earlier bundle carries
 * `config/collections`, which this runtime does not read — booting one would
 * introspect the database instead of serving the declared tables, a different
 * API announced as healthy. So they are refused at boot, with the codemod to
 * run.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, LEGACY_LAYOUT_REMEDY, RUNTIME_CONTRACT_VERSION } from "@rebasepro/types";
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
    range: "^2",
    builtAgainst: "1.0.0",
    contract: RUNTIME_CONTRACT_VERSION
};

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-compat-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("a bundle built from config/collections", () => {
    it.each([
        ["a format-1 bundle (`mode: cms`)", { bundleFormat: 1, mode: "cms", entry: { config: "config" } }],
        ["a format-1 bundle with no config (`mode: baas`)", { bundleFormat: 1, mode: "baas", entry: {} }],
        ["a format-2 bundle", { bundleFormat: 2, kind: "backend", entry: { config: "config" } }],
        ["a format-2 bundle with no collections", { bundleFormat: 2, kind: "backend", entry: {} }],
        ["a format-3 bundle still naming entry.collections", { bundleFormat: BUNDLE_FORMAT_VERSION, kind: "backend", entry: { collections: "config/collections" } }],
        ["a format-3 bundle still naming entry.usersCollection", { bundleFormat: BUNDLE_FORMAT_VERSION, kind: "backend", entry: { usersCollection: "config/collections/users.js" } }]
    ])("refuses %s, naming the codemod", (_label, fields) => {
        const dir = writeBundle({
            runtime, schemaVersion: "", app: "backend", hooks: { native: false }, deps: { declared: {} }, ...fields
        });

        expect(() => readBundleManifest(dir)).toThrow(BundleError);
        try {
            readBundleManifest(dir);
        } catch (error) {
            if (!(error instanceof BundleError)) throw error;
            expect(error.message).toMatch(/config\/collections/);
            expect(error.hint).toContain(LEGACY_LAYOUT_REMEDY);
        }
    });
});

describe("a format-3 bundle", () => {
    it("passes through untouched, and resolves entry.tables and the backend modules", () => {
        const dir = writeBundle({
            bundleFormat: BUNDLE_FORMAT_VERSION,
            runtime,
            schemaVersion: "abc",
            app: "backend",
            kind: "backend",
            entry: {
                tables: "backend/schema",
                resources: "backend/resources",
                storage: "backend/storage.js",
                hooks: "backend/hooks",
                static: [
                    { path: "/admin", dir: "static/admin", spa: true },
                    { path: "/", dir: "static/site", spa: true }
                ]
            },
            hooks: { native: false },
            deps: { declared: {} }
        }, [
            "backend/schema/index.js", "backend/resources.js", "backend/storage.js", "backend/hooks/index.js",
            "static/admin/index.html", "static/site/index.html"
        ]);

        const bundle = loadBundle(dir);
        expect(bundle.manifest.kind).toBe("backend");
        expect(bundle.tablesDir).toBe(path.join(dir, "backend", "schema"));
        expect(bundle.resourcesModule).toBe(path.join(dir, "backend", "resources.js"));
        expect(bundle.storageModule).toBe(path.join(dir, "backend", "storage.js"));
        expect(bundle.hooksModule).toBe(path.join(dir, "backend", "hooks", "index.js"));
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
            tables: "backend/schema",
            static: [{ path: "/", dir: "static/site", spa: true, preload: ["/app.js"] }],
            // A future entry kind this runtime has never heard of.
            workers: "workers"
        },
        hooks: { native: false },
        deps: { declared: {} },
        // Whole sections added by a later CLI.
        telemetry: { sampleRate: 0.1 },
        edge: { regions: ["fra1"] }
    }, ["static/site/index.html", "backend/schema/index.js"]);

    it("loads, ignoring what it does not recognise", () => {
        const bundle = loadBundle(futureBundle());
        expect(bundle.manifest.kind).toBe("backend");
        expect(bundle.staticApps).toHaveLength(1);
    });

    it("still reads every field it does know", () => {
        const bundle = loadBundle(futureBundle());
        expect(bundle.manifest.entry?.tables).toBe("backend/schema");
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
 *   1. Decide what this runtime does with the OLD shape: read it, or refuse
 *      it by name with the way forward (format 3 refuses formats 1 and 2 —
 *      they carry config/collections — with LEGACY_LAYOUT_REMEDY). Never let
 *      a missing field read as undefined, where every gate keyed on it skips.
 *   2. Raise SUPPORTED_BUNDLE_FORMAT in the control plane
 *      (saas/backend/src/managed/bundle-manifest.ts) and teach
 *      `parseBundleManifest` the new shape.
 *   3. SHIP THE CONTROL PLANE FIRST. It rejects a format it does not know, so a
 *      CLI released ahead of it turns every deploy into MALFORMED_MANIFEST or
 *      BUNDLE_FORMAT_TOO_NEW, and the message blames the user's manifest.
 *   4. Then release the CLI and the runtime image.
 *
 * Raising RUNTIME_CONTRACT_VERSION additionally invalidates every project's
 * `rebase` range, so it is a major of the whole product, not a format tweak.
 * It went to 2 with tables (0.31): a contract-1 bundle carries collections,
 * and there is no in-runtime adapter from collections to tables.
 */
describe("the version constants", () => {
    it("are what every current consumer was written against", () => {
        expect(BUNDLE_FORMAT_VERSION).toBe(3);
        expect(RUNTIME_CONTRACT_VERSION).toBe(2);
    });
});
