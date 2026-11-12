/**
 * The static read of a frontend's Vite config that `rebase build` (refuses),
 * `rebase dev` (warns) and `rebase verify` (`cms-backend-guard-missing`) share:
 * does the frontend build with `rebaseBackendGuard()`?
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import * as tsm from "ts-morph";

import { assertBackendGuarded, backendGuardStates, readViteConfigGuard } from "./backend-guard";

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "template");

const read = (text: string) => readViteConfigGuard(tsm, "vite.config.ts", text).state;

describe("readViteConfigGuard", () => {
    it("is guarded when the guard is imported from @rebasepro/app/vitePlugin and called — by name, aliased, or through a namespace", () => {
        expect(read("import { rebaseBackendGuard } from \"@rebasepro/app/vitePlugin\";\nexport default { plugins: [rebaseBackendGuard()] };")).toBe("guarded");
        expect(read("import { rebaseBackendGuard as guard } from \"@rebasepro/app/vitePlugin\";\nexport default { plugins: [guard({ backendDir: \"../api\" })] };")).toBe("guarded");
        expect(read("import * as rebase from \"@rebasepro/app/vitePlugin\";\nexport default { plugins: [rebase.rebaseBackendGuard()] };")).toBe("guarded");
    });

    it("is missing when the guard is only imported, only mentioned, or imported from elsewhere", () => {
        expect(read("import { rebaseBackendGuard } from \"@rebasepro/app/vitePlugin\";\nexport default { plugins: [] };")).toBe("missing");
        expect(read("// rebaseBackendGuard()\nexport default { plugins: [] };")).toBe("missing");
        expect(read("import { rebaseBackendGuard } from \"some-fork\";\nexport default { plugins: [rebaseBackendGuard()] };")).toBe("missing");
    });

    it("cannot tell when the config imports a local module, which may add the guard", () => {
        const result = readViteConfigGuard(tsm, "vite.config.ts", "import { preset } from \"../vite.shared\";\nexport default preset();");
        expect(result.state).toBe("unknown");
        expect(result.reason).toContain("../vite.shared");
    });

    it("points at the config's `plugins`", () => {
        expect(readViteConfigGuard(tsm, "vite.config.ts", "export default {\n    base: \"/\",\n    plugins: []\n};").line).toBe(3);
    });

    it("finds the guard in the scaffold's own template", () => {
        expect(read(fs.readFileSync(path.join(TEMPLATE, "frontend", "vite.config.ts"), "utf-8"))).toBe("guarded");
    });
});

describe("backendGuardStates / assertBackendGuarded", () => {
    let root: string;
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    function project(files: Record<string, string>): string {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-backend-guard-"));
        for (const [rel, text] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), text);
        }
        return root;
    }

    it("reads frontend/ and every static app's root, and refuses a build when one lacks the guard", async () => {
        project({
            "rebase.json": JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend", runtime: "managed" }, site: { type: "static", root: "site", output: "site/dist" } } }),
            "backend/schema/index.ts": "",
            "frontend/vite.config.ts": "import { rebaseBackendGuard } from \"@rebasepro/app/vitePlugin\";\nexport default { plugins: [rebaseBackendGuard()] };",
            "site/vite.config.ts": "export default { plugins: [] };"
        });
        const states = await backendGuardStates(root);
        expect(states.map(s => `${s.viteConfig} ${s.state}`).sort()).toEqual(["frontend/vite.config.ts guarded", "site/vite.config.ts missing"]);
        await expect(assertBackendGuarded(root)).rejects.toThrow(/site\/vite\.config\.ts does not use rebaseBackendGuard\(\)/);
    });

    it("has nothing to check without backend/, or without a Vite config", async () => {
        project({ "frontend/vite.config.ts": "export default {};" });
        expect(await backendGuardStates(root)).toEqual([]);
        fs.rmSync(root, { recursive: true, force: true });
        project({ "backend/index.ts": "", "frontend/src/main.ts": "" });
        expect(await backendGuardStates(root)).toEqual([]);
        await expect(assertBackendGuarded(root)).resolves.toBeUndefined();
    });
});
