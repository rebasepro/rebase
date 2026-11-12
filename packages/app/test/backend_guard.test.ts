import fs from "fs";
import os from "os";
import path from "path";

import { backendImportMessage, fileOfModuleId, findProjectBackendDir, isModuleInDir, realPath } from "../src/backend_guard";

/** The pieces of `rebaseBackendGuard` a build does not show one by one. */

function tree(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "backend-guard-"));
    for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
}

describe("findProjectBackendDir", () => {
    it("walks up from the Vite root to the directory with rebase.json", () => {
        const root = tree({ "rebase.json": "{}", "backend/index.ts": "", "frontend/package.json": "{}" });
        expect(findProjectBackendDir(path.join(root, "frontend"))).toBe(path.join(root, "backend"));
    });

    it("takes a package.json beside a backend/ as the project, as the CLI does", () => {
        const root = tree({ "package.json": "{}", "backend/index.ts": "", "apps/admin/package.json": "{}" });
        expect(findProjectBackendDir(path.join(root, "apps/admin"))).toBe(path.join(root, "backend"));
    });

    it("finds nothing for a project without backend/", () => {
        const root = tree({ "rebase.json": "{}", "frontend/package.json": "{}" });
        expect(findProjectBackendDir(path.join(root, "frontend"))).toBeUndefined();
    });
});

describe("fileOfModuleId", () => {
    it("drops the query and the dev server's /@fs prefix", () => {
        expect(fileOfModuleId("/p/backend/x.ts?raw")).toBe("/p/backend/x.ts");
        expect(fileOfModuleId("/@fs/p/backend/x.ts?import")).toBe("/p/backend/x.ts");
    });

    it("names no file for a virtual module or a bare specifier", () => {
        expect(fileOfModuleId("\0commonjsHelpers.js")).toBeUndefined();
        expect(fileOfModuleId("virtual:rebase")).toBeUndefined();
        expect(fileOfModuleId("react")).toBeUndefined();
    });
});

describe("isModuleInDir", () => {
    it("follows a symlink into the backend, and keeps a sibling with a longer name out", () => {
        const root = tree({ "backend/schema/posts.ts": "", "backend-tools/x.ts": "", "frontend/src/main.ts": "" });
        fs.mkdirSync(path.join(root, "frontend/node_modules"));
        fs.symlinkSync(path.join(root, "backend"), path.join(root, "frontend/node_modules/app-backend"), "dir");
        const backend = realPath(path.join(root, "backend"));
        expect(isModuleInDir(path.join(root, "frontend/node_modules/app-backend/schema/posts.ts"), backend)).toBe(true);
        expect(isModuleInDir(path.join(root, "backend-tools/x.ts"), backend)).toBe(false);
        expect(isModuleInDir(path.join(root, "frontend/src/main.ts"), backend)).toBe(false);
    });

    it("judges a path that does not exist by its nearest existing ancestor", () => {
        const root = tree({ "backend/index.ts": "" });
        expect(isModuleInDir(path.join(root, "backend/not/yet.ts"), realPath(path.join(root, "backend")))).toBe(true);
    });
});

describe("backendImportMessage", () => {
    it("names the importer, the import as written, the backend file, and what to write instead", () => {
        const message = backendImportMessage({
            projectRoot: "/p",
            importer: "/p/frontend/src/cms/posts.tsx",
            specifier: "../../../backend/schema/posts",
            resolved: "/p/backend/schema/posts.ts"
        });
        expect(message).toContain("frontend/src/cms/posts.tsx imports \"../../../backend/schema/posts\", which resolves to backend/schema/posts.ts");
        expect(message).toContain("import type { … } from \"../../../backend/schema/posts\"");
        expect(message).toContain("outside backend/");
    });
});
