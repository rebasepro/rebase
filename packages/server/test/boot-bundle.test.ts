import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION } from "@rebasepro/types";
import { BundleError, loadBundle, readBundleManifest } from "../src/boot/bundle";

/**
 * Reading a bundle.
 *
 * Every check here fails at boot rather than at the first request. A container
 * that refuses to start is a deploy that rolls back; a container that starts and
 * then misbehaves is an incident.
 */

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function writeManifest(overrides: Record<string, unknown> = {}): void {
    fs.writeFileSync(
        path.join(scratch, "manifest.json"),
        JSON.stringify({
            bundleFormat: BUNDLE_FORMAT_VERSION,
            runtime: { range: "^1", builtAgainst: "0.11.0", contract: RUNTIME_CONTRACT_VERSION },
            schemaVersion: "v1:0000000000000000",
            app: "backend",
            mode: "cms",
            entry: {},
            hooks: { native: false },
            deps: { declared: {} },
            build: { cli: "0.11.0", node: "22", createdAt: new Date().toISOString() },
            ...overrides
        })
    );
}

describe("readBundleManifest", () => {
    it("reads a well-formed manifest", () => {
        writeManifest();
        expect(readBundleManifest(scratch).app).toBe("backend");
    });

    it("explains a missing manifest instead of throwing ENOENT", () => {
        expect(() => readBundleManifest(scratch)).toThrow(BundleError);
        expect(() => readBundleManifest(scratch)).toThrow(/manifest\.json/);
    });

    it("reports malformed JSON with the file path", () => {
        fs.writeFileSync(path.join(scratch, "manifest.json"), "{ not json");
        expect(() => readBundleManifest(scratch)).toThrow(/not valid JSON/);
    });

    it("refuses a bundle format newer than it understands", () => {
        writeManifest({ bundleFormat: BUNDLE_FORMAT_VERSION + 1 });
        expect(() => readBundleManifest(scratch)).toThrow(/understands up to/);
    });

    it("accepts an older bundle format, which is the whole point", () => {
        // A bundle built months ago has to keep booting on a patched runtime —
        // otherwise the runtime could never be upgraded underneath a project.
        writeManifest({ bundleFormat: 1 });
        expect(readBundleManifest(scratch).bundleFormat).toBe(1);
    });

    it("refuses a bundle targeting a different runtime contract major", () => {
        writeManifest({
            runtime: { range: "^2", builtAgainst: "2.0.0", contract: RUNTIME_CONTRACT_VERSION + 1 }
        });
        expect(() => readBundleManifest(scratch)).toThrow(/runtime contract/);
    });
});

describe("loadBundle", () => {
    it("resolves declared entry directories to absolute paths", () => {
        fs.mkdirSync(path.join(scratch, "config", "collections"), { recursive: true });
        fs.mkdirSync(path.join(scratch, "backend", "functions"), { recursive: true });
        writeManifest({ entry: { config: "config", functions: "backend/functions" } });

        const bundle = loadBundle(scratch);

        expect(bundle.collectionsDir).toBe(path.join(scratch, "config", "collections"));
        expect(bundle.functionsDir).toBe(path.join(scratch, "backend", "functions"));
    });

    it("derives the collections directory from the config package", () => {
        fs.mkdirSync(path.join(scratch, "config", "collections"), { recursive: true });
        writeManifest({ entry: { config: "config" } });

        expect(loadBundle(scratch).collectionsDir).toBe(
            path.join(scratch, "config", "collections")
        );
    });

    it("drops a declared directory that does not exist instead of failing the boot", () => {
        // An empty `functions/` is an ordinary project; refusing to start over
        // one would be the runtime inventing a requirement.
        writeManifest({ entry: { functions: "backend/functions" } });
        expect(loadBundle(scratch).functionsDir).toBeUndefined();
    });

    it("refuses an entry that points outside the bundle", () => {
        writeManifest({ entry: { config: "../../etc" } });
        expect(() => loadBundle(scratch)).toThrow(/outside the bundle/);
    });

    it("explains a missing bundle directory", () => {
        expect(() => loadBundle(path.join(scratch, "nope"))).toThrow(/not found/);
    });
});
