import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBundleManifest, bundleDeployBody, packBundle, declaredAppsFrom } from "./bundle-deploy";
import type { RebaseBundleManifest } from "@rebasepro/types";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-deploy-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true,
force: true });
});

function manifest(overrides: Partial<RebaseBundleManifest> = {}): RebaseBundleManifest {
    return {
        bundleFormat: 2,
        runtime: { range: "^1",
builtAgainst: "1.4.2",
contract: 1 },
        schemaVersion: "v1:abc",
        app: "backend",
        kind: "backend",
        hooks: { native: false },
        deps: { declared: {} },
        build: { cli: "0.11.0",
node: "22",
createdAt: "2026-07-24T00:00:00Z" },
        ...overrides
    } as RebaseBundleManifest;
}

describe("readBundleManifest", () => {
    it("reads a valid manifest", () => {
        fs.writeFileSync(path.join(scratch, "manifest.json"), JSON.stringify(manifest()));
        const m = readBundleManifest(scratch);
        expect(m.runtime.range).toBe("^1");
    });

    it("explains a missing manifest, pointing at rebase build", () => {
        expect(() => readBundleManifest(scratch)).toThrow(/rebase build/);
    });

    it("rejects a document that is not a bundle manifest", () => {
        fs.writeFileSync(path.join(scratch, "manifest.json"), JSON.stringify({ nope: true }));
        expect(() => readBundleManifest(scratch)).toThrow(/not a valid bundle manifest/);
    });

    it("reports malformed JSON", () => {
        fs.writeFileSync(path.join(scratch, "manifest.json"), "{ broken");
        expect(() => readBundleManifest(scratch)).toThrow(/not valid JSON/);
    });
});

describe("bundleDeployBody", () => {
    it("carries the manifest so the control plane can validate intake fast", () => {
        const body = bundleDeployBody({ projectId: "p1",
bundleId: "b1",
manifest: manifest() });
        expect(body.projectId).toBe("p1");
        expect(body.bundleId).toBe("b1");
        expect((body.bundleManifest as RebaseBundleManifest).schemaVersion).toBe("v1:abc");
        expect(body.client).toBe("cli");
    });

    it("defaults the app to the manifest's app, overridable", () => {
        expect(bundleDeployBody({ projectId: "p",
bundleId: "b",
manifest: manifest({ app: "api" }) }).app).toBe("api");
        expect(bundleDeployBody({ projectId: "p",
bundleId: "b",
manifest: manifest(),
app: "web" }).app).toBe("web");
    });

    it("passes the framework version and an optional message", () => {
        const body = bundleDeployBody({ projectId: "p",
bundleId: "b",
manifest: manifest(),
message: "ship it" });
        expect(body.frameworkVersion).toBe("1.4.2");
        expect(body.message).toBe("ship it");
    });
});

describe("packBundle", () => {
    it("packs the bundle and excludes node_modules", async () => {
        // A bundle ships a package.json; node_modules is installed at boot, and a
        // platform-specific install must not travel in the archive.
        fs.writeFileSync(path.join(scratch, "manifest.json"), "{}");
        fs.mkdirSync(path.join(scratch, "config"), { recursive: true });
        fs.writeFileSync(path.join(scratch, "config", "index.js"), "export const x = 1;");
        fs.mkdirSync(path.join(scratch, "node_modules", "junk"), { recursive: true });
        fs.writeFileSync(path.join(scratch, "node_modules", "junk", "big.js"), "x".repeat(1000));

        const out = path.join(scratch, "..", "out.tar.gz");
        await packBundle(scratch, out);
        expect(fs.existsSync(out)).toBe(true);

        // The archive should not contain node_modules.
        const { execSync } = await import("child_process");
        const listing = execSync(`tar -tzf ${out}`).toString();
        expect(listing).toContain("config/index.js");
        expect(listing).not.toContain("node_modules");
        fs.rmSync(out, { force: true });
    });
});

/**
 * What a deploy tells the control plane this repository contains.
 *
 * The registry accepts exactly two app types. A declaration outside that set is
 * not a warning — the apps hook rejects the registration outright, and the user
 * sees it partway through a deploy rather than as the manifest problem it is.
 */
describe("declaredAppsFrom", () => {
    it("sends the backend as a backend and everything else as static", () => {
        expect(declaredAppsFrom({
            apps: {
                backend: { type: "backend" },
                admin: { type: "static" },
                site: { type: "static" }
            }
        })).toEqual([
            { name: "backend",
type: "backend" },
            { name: "admin",
type: "static" },
            { name: "site",
type: "static" }
        ]);
    });

    it("never emits a type the control plane would reject", () => {
        // This runs on the RAW parsed JSON, not a validated manifest, and it
        // used to default an unknown type to "custom" — which the narrowed
        // registry now refuses.
        const declared = declaredAppsFrom({
            apps: {
                backend: { type: "backend" },
                panel: { type: "admin" },
                phone: { type: "mobile" },
                nothing: {}
            }
        });

        expect(declared.every(app => app.type === "backend" || app.type === "static")).toBe(true);
        expect(declared.find(app => app.name === "panel")?.type).toBe("static");
    });

    it("skips a blank name and tolerates a missing apps section", () => {
        expect(declaredAppsFrom({ apps: { "  ": { type: "static" } } })).toEqual([]);
        expect(declaredAppsFrom({})).toEqual([]);
        expect(declaredAppsFrom(null)).toEqual([]);
        expect(declaredAppsFrom(undefined)).toEqual([]);
    });
});
