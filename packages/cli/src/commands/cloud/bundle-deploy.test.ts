import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBundleManifest, bundleDeployBody, bundleCommit, packBundleForUpload, declaredAppsFrom } from "./bundle-deploy";
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

/**
 * A managed upload never carries `node_modules`, even one `rebase build`
 * vendored: the control plane holds each bundle in memory on every pod start,
 * so an upload stays the size it was sized against (see packBundleForUpload).
 */
describe("packing a bundle for upload", () => {
    function bundleWithModules(): void {
        fs.writeFileSync(path.join(scratch, "manifest.json"), "{}");
        fs.mkdirSync(path.join(scratch, "config"), { recursive: true });
        fs.writeFileSync(path.join(scratch, "config", "index.js"), "export const x = 1;");
        fs.mkdirSync(path.join(scratch, "node_modules", "pg", "node_modules", "pg-types"), { recursive: true });
        fs.writeFileSync(path.join(scratch, "node_modules", "pg", "index.js"), "module.exports = {};");
        fs.writeFileSync(path.join(scratch, "node_modules", "pg", "node_modules", "pg-types", "index.js"), "x");
    }

    function entries(archive: string): string[] {
        return execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split("\n").filter(Boolean);
    }

    const out = (): string => path.join(scratch, "..", `out-${path.basename(scratch)}.tar.gz`);
    afterEach(() => fs.rmSync(out(), { force: true }));

    it("leaves out even a tree the build vendored, and says so", async () => {
        // The control plane reads each bundle into memory on every pod start;
        // until it streams them, an upload stays the size it was sized against.
        bundleWithModules();

        const packed = await packBundleForUpload(scratch, out(), manifest({ deps: { declared: { pg: "^8" }, vendored: true } }));

        expect(packed.modulesLeftOut).toBe(true);
        expect(packed.bytes).toBe(fs.statSync(out()).size);
        const listing = entries(out());
        expect(listing).toContain("./config/index.js");
        expect(listing.some(entry => entry.includes("node_modules"))).toBe(false);
    });

    it("leaves out a node_modules the build did not vendor, with nothing to report", async () => {
        // Installed by hand into a prebuilt bundle, for whatever machine it ran on.
        bundleWithModules();

        const packed = await packBundleForUpload(scratch, out(), manifest({ deps: { declared: { pg: "^8" } } }));

        expect(packed.modulesLeftOut).toBe(false);
        const listing = entries(out());
        expect(listing).toContain("./config/index.js");
        expect(listing.some(entry => entry.includes("node_modules"))).toBe(false);
    });

    it("refuses a bundle over the upload cap before uploading it", async () => {
        bundleWithModules();
        fs.writeFileSync(path.join(scratch, "config", "blob.bin"), crypto.randomBytes(64 * 1024));

        await expect(packBundleForUpload(scratch, out(), manifest({}), 32 * 1024)).rejects.toThrow(/over the .* upload limit/);
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

/**
 * The commit a bundle was built from.
 *
 * Nothing near the control plane has a repository on this path — the CLI uploads
 * a tarball — so every bundle deployment recorded an empty hash: 291 of 305
 * production rows, a Deployments list on which almost nothing said what it
 * shipped. The CLI is the one party standing in the repo.
 */
describe("bundleCommit", () => {
    const git = (answers: Record<string, string>) => (args: string[]) => {
        const key = args[0];
        if (!(key in answers)) throw new Error(`unexpected git ${args.join(" ")}`);
        return answers[key];
    };

    it("reports the short hash and the subject", () => {
        expect(bundleCommit(".", git({ "rev-parse": "0a1b2c3\n", log: "fix: the thing\n" })))
            .toEqual({ hash: "0a1b2c3", message: "fix: the thing" });
    });

    it("reports nothing outside a repository, rather than a guess", () => {
        // No git, not a repo, no commits yet — all the same answer, and the
        // server records what it is given and nothing more.
        expect(bundleCommit(".", () => { throw new Error("not a git repository"); })).toBeNull();
    });

    it("refuses an answer that is not a hash", () => {
        expect(bundleCommit(".", git({ "rev-parse": "HEAD\n", log: "m\n" }))).toBeNull();
    });
});

describe("bundleDeployBody carries the commit only when there is one", () => {
    const manifest = { app: "backend" } as unknown as RebaseBundleManifest;

    it("sends both fields when the repo answered", () => {
        const body = bundleDeployBody({
            projectId: "p1", bundleId: "b1", manifest,
            commit: { hash: "0a1b2c3", message: "fix: the thing" }
        });
        expect(body.gitCommitHash).toBe("0a1b2c3");
        expect(body.gitCommitMessage).toBe("fix: the thing");
    });

    it("omits them entirely when it did not", () => {
        // Not `""`. An absent field and an empty one are the same to the server,
        // and sending the empty string would make "we did not look"
        // indistinguishable from "we looked and there was nothing".
        const body = bundleDeployBody({ projectId: "p1", bundleId: "b1", manifest, commit: null });
        expect("gitCommitHash" in body).toBe(false);
        expect("gitCommitMessage" in body).toBe(false);
    });
});

/**
 * The two fields a platform upgrade's rebuild depends on.
 *
 * Absent, not empty, when there is nothing to say: a control plane reading
 * `rebuildSource: null` or `allowFrameworkDowngrade: false` would have to treat
 * them as statements, and "no source was uploaded" is already what an absent
 * field means.
 */
describe("bundleDeployBody carries the rebuild source and the downgrade opt-in only when there is one", () => {
    const manifest = { app: "backend" } as unknown as RebaseBundleManifest;
    const rebuildSource = {
        sourceId: "0123456789abcdef0123456789abcdef",
        projectPath: "app",
        buildEnv: { VITE_TITLE: "Shop" }
    };

    it("sends the uploaded source as one object", () => {
        const body = bundleDeployBody({ projectId: "p1", bundleId: "b1", manifest, rebuildSource });
        expect(body.rebuildSource).toEqual(rebuildSource);
    });

    it("omits it entirely when no source was uploaded", () => {
        expect("rebuildSource" in bundleDeployBody({ projectId: "p1", bundleId: "b1", manifest })).toBe(false);
        expect("rebuildSource" in bundleDeployBody({ projectId: "p1", bundleId: "b1", manifest, rebuildSource: null })).toBe(false);
    });

    it("says allowFrameworkDowngrade only when it was asked for", () => {
        expect(bundleDeployBody({ projectId: "p1", bundleId: "b1", manifest, allowFrameworkDowngrade: true }).allowFrameworkDowngrade)
            .toBe(true);
        expect("allowFrameworkDowngrade" in bundleDeployBody({ projectId: "p1", bundleId: "b1", manifest, allowFrameworkDowngrade: false }))
            .toBe(false);
        expect("allowFrameworkDowngrade" in bundleDeployBody({ projectId: "p1", bundleId: "b1", manifest })).toBe(false);
    });
});
