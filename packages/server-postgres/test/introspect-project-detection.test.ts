/**
 * Whether introspection writes `frontend/src/cms/<table>.tsx` customizations,
 * and where.
 *
 * Only into a project whose frontend can resolve the import the file opens
 * with (`@rebasepro/cms`): a headless project gets its `backend/schema` and
 * nothing it could not compile. The rule is the manifests on the path the file
 * resolves bare specifiers along — the frontend's, then the project root's.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { detectCmsDir, findProjectRoot } from "../src/schema/introspect-db-project";

let root: string;

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cms-detect-")));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

/** Lays out `<root>/backend/schema` (and a frontend when asked) and returns the schema directory. */
function project(options: {
    rebaseJson?: boolean;
    frontendDeps?: Record<string, string> | null;
    rootDeps?: Record<string, string>;
    frontendManifest?: string;
} = {}): string {
    if (options.rebaseJson !== false) fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({ rebase: "^1" }), "utf-8");
    const schemaDir = path.join(root, "backend", "schema");
    fs.mkdirSync(schemaDir, { recursive: true });
    if (options.frontendDeps !== undefined || options.frontendManifest !== undefined) {
        fs.mkdirSync(path.join(root, "frontend", "src"), { recursive: true });
        const manifest = options.frontendManifest ?? (options.frontendDeps ? JSON.stringify({ name: "web", dependencies: options.frontendDeps }) : undefined);
        if (manifest !== undefined) fs.writeFileSync(path.join(root, "frontend", "package.json"), manifest, "utf-8");
    }
    if (options.rootDeps) {
        fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "p", dependencies: options.rootDeps }), "utf-8");
    }
    return schemaDir;
}

describe("detectCmsDir", () => {
    it("is frontend/src/cms for a project whose frontend declares @rebasepro/cms", () => {
        expect(detectCmsDir(project({ frontendDeps: { "@rebasepro/cms": "*" } }))).toBe(path.join(root, "frontend", "src", "cms"));
    });

    it("reads the root manifest too (a workspace that declares it there)", () => {
        expect(detectCmsDir(project({ frontendDeps: null, rootDeps: { "@rebasepro/cms": "*" } }))).toBe(path.join(root, "frontend", "src", "cms"));
    });

    it("is nothing for a headless project, frontend directory or not", () => {
        expect(detectCmsDir(project())).toBeUndefined();
        fs.rmSync(root, { recursive: true, force: true });
        fs.mkdirSync(root);
        expect(detectCmsDir(project({ frontendDeps: { react: "*" } }))).toBeUndefined();
    });

    it("is nothing when only the backend declares the package — there is no frontend to write into", () => {
        expect(detectCmsDir(project({ rootDeps: { "@rebasepro/cms": "*" } }))).toBeUndefined();
    });

    it("survives a malformed manifest", () => {
        expect(detectCmsDir(project({ frontendManifest: "{ not json" }))).toBeUndefined();
    });

    it("finds the root above backend/ when there is no rebase.json", () => {
        expect(detectCmsDir(project({ rebaseJson: false, frontendDeps: { "@rebasepro/cms": "*" } }))).toBe(path.join(root, "frontend", "src", "cms"));
    });
});

describe("findProjectRoot", () => {
    it("is the first ancestor holding a rebase.json", () => {
        const schemaDir = project();
        expect(findProjectRoot(schemaDir)).toBe(root);
    });

    it("is nothing when no ancestor within reach holds one", () => {
        const deep = path.join(root, "a", "b");
        fs.mkdirSync(deep, { recursive: true });
        expect(findProjectRoot(deep)).toBeUndefined();
    });
});
