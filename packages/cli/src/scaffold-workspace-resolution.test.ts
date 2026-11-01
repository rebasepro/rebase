/**
 * A scaffold's own packages are named after the project: `my-app-config`, on a
 * `"*"` range, so that npm and pnpm can both install it. That name is free for
 * anyone to publish, and `my-app-config` was: with only `linkWorkspacePackages`
 * set, pnpm takes the higher version the registry offers over the workspace's
 * 1.0.0. The scaffold then allowlisted that package's install script, so
 * `pnpm install` ran a stranger's code on the quickstart's exact command.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../templates");

describe.each([
    ["the default scaffold", "template/package.json"],
    ["the headless scaffold", "overlays/baas/package.json"]
])("%s's package.json", (_name, file) => {
    it("installs the MCP server its .mcp.json runs", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(templates, file), "utf8")) as {
            devDependencies: Record<string, string>;
        };
        expect(manifest.devDependencies).toHaveProperty(["@rebasepro/mcp"]);
    });
});

describe.each([
    ["the default scaffold", "template/pnpm-workspace.yaml"],
    ["the headless scaffold", "overlays/baas/pnpm-workspace.yaml"]
])("%s's pnpm-workspace.yaml", (_name, file) => {
    const yaml = fs.readFileSync(path.join(templates, file), "utf8");

    it("resolves a workspace package from the workspace, whatever the registry holds", () => {
        expect(yaml).toMatch(/^preferWorkspacePackages: true$/m);
    });

    it("allows no build script for a package named after the project", () => {
        expect(yaml).not.toMatch(/^\s+"?\{\{PROJECT_NAME\}\}.*:\s*true/m);
    });
});
