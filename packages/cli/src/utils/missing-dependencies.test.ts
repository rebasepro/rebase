import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { missingDependenciesHint } from "./missing-dependencies";

const dirs: string[] = [];
function project(lock?: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-missing-deps-"));
    dirs.push(dir);
    if (lock) fs.writeFileSync(path.join(dir, lock), "");
    return dir;
}
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const npmEnv = { npm_config_user_agent: "npm/11.0.0 node/v22" };

describe("missingDependenciesHint", () => {
    it("tells an uninstalled npm project to run npm install", () => {
        const root = project("package-lock.json");
        const hint = missingDependenciesHint(
            ["Could not import backend/schema/index.ts\n\nCannot find module '@rebasepro/server/schema'"],
            root,
            npmEnv
        );
        expect(hint).toBe(`The project's dependencies are not installed. Run \`npm install\` in ${root}, then deploy again.`);
    });

    it("names pnpm for a pnpm project", () => {
        const root = project("pnpm-lock.yaml");
        expect(missingDependenciesHint(["Cannot find module '@rebasepro/types'"], root, npmEnv)).toContain("`pnpm install`");
    });

    it("says nothing when the failure is the app's own code", () => {
        const root = project("package-lock.json");
        expect(missingDependenciesHint(["Cannot find module './posts'", "Unexpected token"], root, npmEnv)).toBeUndefined();
    });
});
