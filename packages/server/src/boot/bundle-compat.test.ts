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
