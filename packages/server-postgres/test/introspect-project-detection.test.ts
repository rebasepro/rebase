/**
 * Which `defineCollection` introspection generates against, and how it is decided.
 *
 * The detection is the load-bearing half of the change: emit the admin-types
 * import into a headless project and every generated file names a package that is
 * not installed. So the rule is the manifests above the output directory — the
 * same path Node resolves a bare specifier along.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { detectCollectionBuilder } from "../src/schema/introspect-db-project";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-builder-detect-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

/** Lays out `<root>/config/collections` and returns it. */
function project(configDeps: Record<string, string> | null, options: {
    rootDeps?: Record<string, string>;
    manifest?: boolean;
} = {}): string {
    fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({ rebase: "^1" }), "utf-8");
    if (options.rootDeps) {
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "p", dependencies: options.rootDeps }),
            "utf-8"
        );
    }
    const config = path.join(root, "config");
    fs.mkdirSync(path.join(config, "collections"), { recursive: true });
    if (configDeps) {
        fs.writeFileSync(
            path.join(config, "package.json"),
            JSON.stringify({ name: "p-config", dependencies: configDeps }),
            "utf-8"
        );
    }
    return path.join(config, "collections");
}

describe("detectCollectionBuilder", () => {
    it("picks the admin builder for a project that declares admin-types", () => {
        const out = project({ "@rebasepro/admin-types": "*", "@rebasepro/types": "*" });
        expect(detectCollectionBuilder(out)).toBe("admin-types");
    });

    it("picks the headless builder for a project that declares only common", () => {
        const out = project({ "@rebasepro/common": "*", "@rebasepro/types": "*" });
        expect(detectCollectionBuilder(out)).toBe("common");
    });

    /**
     * The failure mode this exists to prevent: writing an import of a package the
     * project does not have. A scaffold from before `@rebasepro/common` joined the
     * headless config package declares neither, and gets the old annotation.
     */
    it("falls back to the annotation when neither package is declared", () => {
        const out = project({ "@rebasepro/types": "*" });
        expect(detectCollectionBuilder(out)).toBe("annotation");
    });

    it("falls back to the annotation when there is no manifest at all", () => {
        const out = project(null);
        expect(detectCollectionBuilder(out)).toBe("annotation");
    });

    /**
     * Resolution walks up, so the detection does too: a dependency declared at the
     * project root is reachable from `config/collections` even though the nearest
     * manifest never mentions it.
     */
    it("sees a dependency declared further up", () => {
        const out = project({ "@rebasepro/types": "*" }, { rootDeps: { "@rebasepro/common": "*" } });
        expect(detectCollectionBuilder(out)).toBe("common");
    });

    /** A project with both has an admin panel, and that is the flavour with a block. */
    it("prefers the admin builder when both are declared", () => {
        const out = project({ "@rebasepro/admin-types": "*", "@rebasepro/common": "*" });
        expect(detectCollectionBuilder(out)).toBe("admin-types");
    });

    /** "Can this import resolve?" — an unparseable manifest answers no, not a crash. */
    it("survives a malformed manifest", () => {
        const out = project({ "@rebasepro/common": "*" });
        fs.writeFileSync(path.join(root, "config", "package.json"), "{ not json", "utf-8");
        expect(detectCollectionBuilder(out)).toBe("annotation");
    });

    /**
     * `rebase.json` marks the project root, and the walk stops there. Without that
     * stop, a project checked out inside an unrelated workspace would inherit that
     * workspace's dependencies and generate imports its own package cannot resolve.
     */
    it("stops at the project root", () => {
        const outer = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-builder-outer-"));
        try {
            fs.writeFileSync(
                path.join(outer, "package.json"),
                JSON.stringify({ name: "outer", dependencies: { "@rebasepro/admin-types": "*" } }),
                "utf-8"
            );
            root = path.join(outer, "inner");
            fs.mkdirSync(root);
            const out = project({ "@rebasepro/common": "*" });
            expect(detectCollectionBuilder(out)).toBe("common");
        } finally {
            fs.rmSync(outer, { recursive: true, force: true });
        }
    });
});
