/**
 * Moving a project's `@rebasepro/*` pins, file by file.
 *
 * The rewrite is the part that has to be exact: a version bump that reformats a
 * `package.json` is a whole-file diff nobody can review, and one that also moves
 * a `peerDependencies` range or a `workspace:` link has changed what the
 * package means. So most of these compare bytes, not parsed values.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    applyUpgradePlan,
    classifySpec,
    detectInstaller,
    discoverProjectFiles,
    installCommand,
    isDowngrade,
    isExactVersion,
    overrideTarget,
    planUpgrade,
    resolveTarget,
    UpgradeError
} from "./upgrade";

let root: string;

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-upgrade-")));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content: string): string {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
}

function read(relative: string): string {
    return fs.readFileSync(path.join(root, relative), "utf8");
}

describe("classifySpec", () => {
    it.each([
        ["0.19.1", "", "0.19.1"],
        ["^0.19.1", "^", "0.19.1"],
        ["~0.19.1", "~", "0.19.1"],
        ["0.21.1-canary.g8c5a265", "", "0.21.1-canary.g8c5a265"],
        ["^1.0.0+build.7", "^", "1.0.0+build.7"]
    ])("moves %s, keeping its prefix", (spec, prefix, version) => {
        expect(classifySpec(spec)).toEqual({ kind: "movable", prefix, version });
    });

    it.each([
        ["link:../packages/types", "link:"],
        ["file:../packages/types", "file:"],
        ["portal:../packages/types", "portal:"]
    ])("reads %s as a local path", (spec, protocol) => {
        expect(classifySpec(spec)).toEqual({ kind: "local", protocol });
    });

    it.each([
        ["workspace:*", /workspace/],
        ["workspace:^0.19.1", /workspace/],
        ["git+https://github.com/rebasepro/rebase.git", /git or URL/],
        ["github:rebasepro/rebase", /git or URL/],
        ["https://example.com/cms.tgz", /git or URL/],
        ["*", /wildcard/],
        ["", /wildcard/],
        ["latest", /dist-tag/],
        ["canary", /dist-tag/],
        [">=0.19.0", /comparator/],
        ["^0.19.0 || ^0.20.0", /union/],
        ["^0.19", /MAJOR\.MINOR\.PATCH/],
        ["v0.19.1", /MAJOR\.MINOR\.PATCH/],
        ["npm:@other/cms@1.0.0", /alias/]
    ])("leaves %s alone, and says why", (spec, reason) => {
        const cls = classifySpec(spec);
        expect(cls.kind).toBe("other");
        expect(cls.kind === "other" ? cls.reason : "").toMatch(reason);
    });
});

describe("isExactVersion", () => {
    it("accepts a release and a prerelease, and nothing looser", () => {
        expect(isExactVersion("0.21.0")).toBe(true);
        expect(isExactVersion("0.21.1-canary.g8c5a265")).toBe(true);
        expect(isExactVersion("^0.21.0")).toBe(false);
        expect(isExactVersion("0.21")).toBe(false);
        expect(isExactVersion("latest")).toBe(false);
        expect(isExactVersion("01.2.3")).toBe(false);
    });
});

describe("overrideTarget", () => {
    it.each([
        ["@rebasepro/types", "@rebasepro/types"],
        ["@rebasepro/types@<0.20", "@rebasepro/types"],
        ["some-parent>@rebasepro/server", "@rebasepro/server"],
        ["**/@rebasepro/client", "@rebasepro/client"],
        ["some-parent/@rebasepro/client", "@rebasepro/client"]
    ])("finds the framework package %s targets", (key, target) => {
        expect(overrideTarget(key)).toBe(target);
    });

    it("ignores everything else", () => {
        expect(overrideTarget("hono")).toBeNull();
        expect(overrideTarget("@rebasepro/server>hono")).toBeNull();
    });
});

describe("the pin rewrite", () => {
    it("moves exact, caret and tilde pins and changes no other byte", () => {
        const original = [
            "{",
            "  \"name\": \"shop\",",
            "  \"dependencies\": {",
            "    \"@rebasepro/server\": \"0.19.1\",",
            "    \"@rebasepro/client\":\"^0.19.1\",",
            "    \"hono\": \"^4.10.0\"",
            "  },",
            "  \"devDependencies\": {",
            "    \"@rebasepro/cli\":   \"~0.19.1\",",
            "    \"@rebasepro/server\": \"0.19.1\"",
            "  },",
            "  \"optionalDependencies\": { \"@rebasepro/plugin-ai\": \"0.19.1\" },",
            "  \"peerDependencies\": {",
            "    \"@rebasepro/server\": \"0.19.1\"",
            "  }",
            "}",
            ""
        ].join("\n");
        write("package.json", original);

        const plan = planUpgrade(root, "0.21.0");
        applyUpgradePlan(plan);

        const expected = original
            .replace("\"@rebasepro/server\": \"0.19.1\",", "\"@rebasepro/server\": \"0.21.0\",")
            .replace("\"@rebasepro/client\":\"^0.19.1\"", "\"@rebasepro/client\":\"^0.21.0\"")
            .replace("\"@rebasepro/cli\":   \"~0.19.1\"", "\"@rebasepro/cli\":   \"~0.21.0\"")
            // The devDependencies entry — the second occurrence of this exact pair.
            .replace("\"@rebasepro/server\": \"0.19.1\"\n  },\n  \"optionalDependencies\"",
                "\"@rebasepro/server\": \"0.21.0\"\n  },\n  \"optionalDependencies\"")
            .replace("\"@rebasepro/plugin-ai\": \"0.19.1\"", "\"@rebasepro/plugin-ai\": \"0.21.0\"");
        expect(read("package.json")).toBe(expected);
        // peerDependencies is a statement about what a CONSUMER may bring, and
        // is not this project's pin to move.
        expect(JSON.parse(read("package.json")).peerDependencies["@rebasepro/server"]).toBe("0.19.1");

        expect(plan.changed).toEqual([
            { file: "package.json", name: "@rebasepro/server", field: "dependencies", from: "0.19.1", to: "0.21.0" },
            { file: "package.json", name: "@rebasepro/client", field: "dependencies", from: "^0.19.1", to: "^0.21.0" },
            { file: "package.json", name: "@rebasepro/cli", field: "devDependencies", from: "~0.19.1", to: "~0.21.0" },
            { file: "package.json", name: "@rebasepro/server", field: "devDependencies", from: "0.19.1", to: "0.21.0" },
            { file: "package.json", name: "@rebasepro/plugin-ai", field: "optionalDependencies", from: "0.19.1", to: "0.21.0" }
        ]);
    });

    it("keeps tabs, a missing trailing newline and CRLF line endings", () => {
        const tabs = "{\n\t\"dependencies\": {\n\t\t\"@rebasepro/types\": \"0.19.1\"\n\t}\n}";
        const crlf = "{\r\n  \"dependencies\": {\r\n    \"@rebasepro/types\": \"^0.19.1\"\r\n  }\r\n}\r\n";
        write("a/package.json", tabs);
        write("b/package.json", crlf);

        applyUpgradePlan(planUpgrade(root, "0.21.0"));

        expect(read("a/package.json")).toBe(tabs.replace("0.19.1", "0.21.0"));
        expect(read("b/package.json")).toBe(crlf.replace("0.19.1", "0.21.0"));
    });

    it("moves to a prerelease the same way", () => {
        write("package.json", JSON.stringify({ dependencies: { "@rebasepro/cms": "^0.19.1" } }, null, 2));
        const plan = planUpgrade(root, "0.21.1-canary.g8c5a265");
        expect(plan.changed[0].to).toBe("^0.21.1-canary.g8c5a265");
    });

    it("reports what it leaves alone, with the reason, and never writes it", () => {
        const original = JSON.stringify({
            dependencies: {
                "@rebasepro/types": "workspace:*",
                "@rebasepro/editor": "link:../../packages/editor",
                "@rebasepro/cms": "latest",
                "@rebasepro/client": ">=0.19.0",
                "@rebasepro/ui": "^0.19.0 || ^0.20.0",
                "@rebasepro/app": "github:rebasepro/rebase"
            }
        }, null, 2);
        write("package.json", original);

        const plan = planUpgrade(root, "0.21.0");

        expect(plan.changed).toEqual([]);
        expect(plan.writes).toEqual([]);
        expect(plan.skipped.map(s => [s.name, s.spec])).toEqual([
            ["@rebasepro/types", "workspace:*"],
            ["@rebasepro/editor", "link:../../packages/editor"],
            ["@rebasepro/cms", "latest"],
            ["@rebasepro/client", ">=0.19.0"],
            ["@rebasepro/ui", "^0.19.0 || ^0.20.0"],
            ["@rebasepro/app", "github:rebasepro/rebase"]
        ]);
        for (const skip of plan.skipped) {
            expect(skip.file).toBe("package.json");
            expect(skip.field).toBe("dependencies");
            expect(skip.reason.length).toBeGreaterThan(10);
        }
        expect(plan.skipped[1].reason).toContain("link:");
    });

    it("leaves packages outside the scope alone", () => {
        write("package.json", JSON.stringify({ dependencies: { hono: "0.19.1", "rebasepro-thing": "0.19.1" } }));
        expect(planUpgrade(root, "0.21.0").writes).toEqual([]);
    });

    it("does nothing to a project already on the target", () => {
        write("package.json", JSON.stringify({ dependencies: { "@rebasepro/server": "^0.21.0" } }));
        const plan = planUpgrade(root, "0.21.0");
        expect(plan.changed).toEqual([]);
        expect(plan.writes).toEqual([]);
    });

    it("reports a package.json it cannot parse, and carries on", () => {
        write("fixtures/broken/package.json", "{ \"dependencies\": ");
        write("package.json", JSON.stringify({ dependencies: { "@rebasepro/server": "0.19.1" } }));

        const plan = planUpgrade(root, "0.21.0");

        expect(plan.unreadable).toEqual([
            { file: "fixtures/broken/package.json", reason: expect.stringContaining("not valid JSON") }
        ]);
        expect(plan.changed).toHaveLength(1);
    });

    it("refuses a target that is not one exact version", () => {
        expect(() => planUpgrade(root, "latest")).toThrow(UpgradeError);
    });
});

describe("finding the package.json files", () => {
    it("walks the whole project, and skips installs, build output and hidden directories", () => {
        const pin = JSON.stringify({ dependencies: { "@rebasepro/types": "0.19.1" } });
        for (const file of [
            "package.json",
            "frontend/package.json",
            "packages/editor/package.json",
            "apps/site/nested/package.json",
            // Never entered:
            "node_modules/@rebasepro/types/package.json",
            "frontend/node_modules/x/package.json",
            "dist/package.json",
            "dist-bundle/package.json",
            "dist-bundle-admin/package.json",
            ".git/package.json",
            ".rebase/package.json",
            ".claude/worktrees/copy/package.json"
        ]) write(file, pin);

        const found = discoverProjectFiles(root).packageJsons.map(f => path.relative(root, f).split(path.sep).join("/"));
        expect(found.sort()).toEqual([
            "apps/site/nested/package.json",
            "frontend/package.json",
            "package.json",
            "packages/editor/package.json"
        ]);

        applyUpgradePlan(planUpgrade(root, "0.21.0"));
        expect(read("dist-bundle/package.json")).toBe(pin);
        expect(read(".claude/worktrees/copy/package.json")).toBe(pin);
        expect(read("node_modules/@rebasepro/types/package.json")).toBe(pin);
        expect(read("apps/site/nested/package.json")).toContain("0.21.0");
    });

    it("reports every path relative to the project root, with forward slashes", () => {
        write("frontend/package.json", JSON.stringify({ dependencies: { "@rebasepro/cms": "0.19.1" } }));
        expect(planUpgrade(root, "0.21.0").changed[0].file).toBe("frontend/package.json");
    });
});

describe("overrides in pnpm-workspace.yaml", () => {
    const workspace = [
        "packages:",
        "  - \"frontend\"",
        "  - \"backend\"",
        "# Pins everything to one build.",
        "overrides:",
        "  \"@rebasepro/server\": \"0.19.1\"",
        "  '@rebasepro/client': ^0.19.1  # the SDK",
        "  \"@rebasepro/types\": \"link:../packages/types\"",
        "  \"@rebasepro/cms\": link:../packages/cms",
        "  \"hono\": \"4.10.0\"",
        "linkWorkspacePackages: true",
        ""
    ].join("\n");

    it("bumps a plain version, keeping its quotes and comment, and reports local links", () => {
        write("pnpm-workspace.yaml", workspace);
        const plan = planUpgrade(root, "0.21.0");
        applyUpgradePlan(plan);

        expect(read("pnpm-workspace.yaml")).toBe(workspace
            .replace("\"@rebasepro/server\": \"0.19.1\"", "\"@rebasepro/server\": \"0.21.0\"")
            .replace("'@rebasepro/client': ^0.19.1  # the SDK", "'@rebasepro/client': ^0.21.0  # the SDK"));
        expect(plan.overrides).toEqual([
            { file: "pnpm-workspace.yaml", name: "@rebasepro/server", spec: "0.19.1", action: "bumped", to: "0.21.0" },
            { file: "pnpm-workspace.yaml", name: "@rebasepro/client", spec: "^0.19.1", action: "bumped", to: "^0.21.0" },
            { file: "pnpm-workspace.yaml", name: "@rebasepro/types", spec: "link:../packages/types", action: "kept-local" },
            { file: "pnpm-workspace.yaml", name: "@rebasepro/cms", spec: "link:../packages/cms", action: "kept-local" }
        ]);
    });

    it("removes local links with --drop-local-overrides, and nothing else", () => {
        write("pnpm-workspace.yaml", workspace);
        const plan = planUpgrade(root, "0.21.0", { dropLocalOverrides: true });
        applyUpgradePlan(plan);

        const after = read("pnpm-workspace.yaml");
        expect(after).not.toContain("link:");
        expect(after).toContain("  \"hono\": \"4.10.0\"\n");
        expect(after).toContain("overrides:\n");
        expect(after).toContain("linkWorkspacePackages: true\n");
        expect(plan.overrides.filter(o => o.action === "removed-local").map(o => o.name))
            .toEqual(["@rebasepro/types", "@rebasepro/cms"]);
    });

    it("removes the key too when the block is left empty", () => {
        const onlyLinks = [
            "packages:",
            "  - \"frontend\"",
            "overrides:",
            "  \"@rebasepro/types\": \"link:../packages/types\"",
            "  \"@rebasepro/server\": \"link:../packages/server\"",
            "minimumReleaseAge: 0",
            ""
        ].join("\n");
        write("pnpm-workspace.yaml", onlyLinks);

        applyUpgradePlan(planUpgrade(root, "0.21.0", { dropLocalOverrides: true }));

        expect(read("pnpm-workspace.yaml")).toBe("packages:\n  - \"frontend\"\nminimumReleaseAge: 0\n");
    });

    it("keeps the links, and the file, without the flag", () => {
        const onlyLinks = "overrides:\n  \"@rebasepro/types\": \"link:../packages/types\"\n";
        write("pnpm-workspace.yaml", onlyLinks);
        const plan = planUpgrade(root, "0.21.0");
        expect(plan.writes).toEqual([]);
        expect(plan.overrides[0].action).toBe("kept-local");
    });

    it("does not touch a workspace file with no overrides", () => {
        write("pnpm-workspace.yaml", "packages:\n  - \"frontend\"\n");
        expect(planUpgrade(root, "0.21.0").writes).toEqual([]);
    });

    it("reports an inline overrides map rather than guessing at it", () => {
        write("pnpm-workspace.yaml", "overrides: { \"@rebasepro/types\": \"0.19.1\" }\n");
        const plan = planUpgrade(root, "0.21.0");
        expect(plan.writes).toEqual([]);
        expect(plan.skipped[0]).toMatchObject({ file: "pnpm-workspace.yaml", field: "overrides" });
    });
});

describe("overrides in package.json", () => {
    it("bumps pnpm.overrides, npm overrides and yarn resolutions", () => {
        const original = JSON.stringify({
            pnpm: { overrides: { "@rebasepro/server": "0.19.1", hono: "4.10.0" } },
            overrides: { "@rebasepro/client@<0.20": "^0.19.1" },
            resolutions: { "**/@rebasepro/types": "~0.19.1" }
        }, null, 4) + "\n";
        write("package.json", original);

        const plan = planUpgrade(root, "0.21.0");
        applyUpgradePlan(plan);

        expect(read("package.json")).toBe(original
            .replace("\"@rebasepro/server\": \"0.19.1\"", "\"@rebasepro/server\": \"0.21.0\"")
            .replace("\"^0.19.1\"", "\"^0.21.0\"")
            .replace("\"~0.19.1\"", "\"~0.21.0\""));
        expect(plan.overrides.map(o => [o.name, o.action, o.to])).toEqual([
            ["@rebasepro/server", "bumped", "0.21.0"],
            ["@rebasepro/client@<0.20", "bumped", "^0.21.0"],
            ["**/@rebasepro/types", "bumped", "~0.21.0"]
        ]);
        // An override is not a pin, and is reported as one kind of thing.
        expect(plan.changed).toEqual([]);
    });

    it("drops local overrides, the emptied block, and an emptied pnpm", () => {
        const original = [
            "{",
            "  \"name\": \"shop\",",
            "  \"pnpm\": {",
            "    \"overrides\": {",
            "      \"@rebasepro/types\": \"link:../packages/types\",",
            "      \"@rebasepro/server\": \"link:../packages/server\"",
            "    }",
            "  },",
            "  \"resolutions\": {",
            "    \"hono\": \"4.10.0\",",
            "    \"@rebasepro/client\": \"file:../packages/client\"",
            "  },",
            "  \"private\": true",
            "}",
            ""
        ].join("\n");
        write("package.json", original);

        const plan = planUpgrade(root, "0.21.0", { dropLocalOverrides: true });
        applyUpgradePlan(plan);

        expect(read("package.json")).toBe([
            "{",
            "  \"name\": \"shop\",",
            "  \"resolutions\": {",
            "    \"hono\": \"4.10.0\"",
            "  },",
            "  \"private\": true",
            "}",
            ""
        ].join("\n"));
        expect(plan.overrides.map(o => o.action)).toEqual(["removed-local", "removed-local", "removed-local"]);
    });

    it("keeps pnpm's other settings when its overrides go", () => {
        const original = JSON.stringify({
            pnpm: {
                overrides: { "@rebasepro/types": "link:../packages/types" },
                onlyBuiltDependencies: ["esbuild"]
            }
        }, null, 2);
        write("package.json", original);

        applyUpgradePlan(planUpgrade(root, "0.21.0", { dropLocalOverrides: true }));

        expect(JSON.parse(read("package.json"))).toEqual({ pnpm: { onlyBuiltDependencies: ["esbuild"] } });
        expect(read("package.json")).toBe("{\n  \"pnpm\": {\n    \"onlyBuiltDependencies\": [\n      \"esbuild\"\n    ]\n  }\n}");
    });

    it("reports a local override without the flag, and leaves it", () => {
        write("package.json", JSON.stringify({ pnpm: { overrides: { "@rebasepro/types": "link:../t" } } }));
        const plan = planUpgrade(root, "0.21.0");
        expect(plan.writes).toEqual([]);
        expect(plan.overrides).toEqual([
            { file: "package.json", name: "@rebasepro/types", spec: "link:../t", action: "kept-local" }
        ]);
    });

    it("reports a nested npm override instead of rewriting it", () => {
        write("package.json", JSON.stringify({ overrides: { "@rebasepro/server": { ".": "0.19.1" } } }));
        const plan = planUpgrade(root, "0.21.0");
        expect(plan.writes).toEqual([]);
        expect(plan.skipped[0]).toMatchObject({ name: "@rebasepro/server", field: "overrides" });
    });
});

describe("a dry run", () => {
    it("plans everything and writes nothing", () => {
        const original = JSON.stringify({ dependencies: { "@rebasepro/server": "0.19.1" } }, null, 2);
        write("package.json", original);
        write("pnpm-workspace.yaml", "overrides:\n  \"@rebasepro/types\": \"link:../t\"\n");

        const plan = planUpgrade(root, "0.21.0", { dropLocalOverrides: true });

        expect(plan.changed).toHaveLength(1);
        expect(plan.writes).toHaveLength(2);
        expect(read("package.json")).toBe(original);
        expect(read("pnpm-workspace.yaml")).toContain("link:");
    });
});

describe("resolveTarget", () => {
    it("uses an exact version as written, without asking the registry", async () => {
        const npmView = vi.fn(async () => "9.9.9");
        expect(await resolveTarget("0.21.0", npmView)).toBe("0.21.0");
        expect(await resolveTarget("0.21.1-canary.g8c5a265", npmView)).toBe("0.21.1-canary.g8c5a265");
        expect(await resolveTarget("v0.21.0", npmView)).toBe("0.21.0");
        expect(npmView).not.toHaveBeenCalled();
    });

    it("asks the registry what a tag points at, for the CLI package", async () => {
        const npmView = vi.fn(async () => "0.21.1-canary.g8c5a265\n");
        expect(await resolveTarget("canary", npmView)).toBe("0.21.1-canary.g8c5a265");
        expect(npmView).toHaveBeenCalledWith("@rebasepro/cli@canary");
    });

    it("refuses when the registry cannot be asked", async () => {
        const npmView = vi.fn(async () => {
            throw new Error("npm error code E404\nnpm error 404 Not Found");
        });
        await expect(resolveTarget("nope", npmView)).rejects.toMatchObject({
            code: "target_unresolved",
            message: expect.stringContaining("E404")
        });
    });

    it("refuses an answer that is not one version", async () => {
        await expect(resolveTarget("beta", async () => "")).rejects.toMatchObject({ code: "target_unresolved" });
        await expect(resolveTarget("beta", async () => "@rebasepro/cli@0.20.0 '0.20.0'\n@rebasepro/cli@0.21.0 '0.21.0'"))
            .rejects.toMatchObject({ code: "target_unresolved" });
    });

    it("refuses a range, which is neither a version nor a tag", async () => {
        const npmView = vi.fn(async () => "0.21.0");
        await expect(resolveTarget("^0.21", npmView)).rejects.toMatchObject({ code: "target_invalid" });
        expect(npmView).not.toHaveBeenCalled();
    });
});

describe("detectInstaller", () => {
    it.each([
        ["pnpm-lock.yaml", "pnpm"],
        ["package-lock.json", "npm"],
        ["yarn.lock", "yarn"],
        ["bun.lockb", "bun"],
        ["bun.lock", "bun"]
    ])("reads %s as %s", (lockfile, installer) => {
        write(".git/HEAD", "ref: refs/heads/main\n");
        write(lockfile, "");
        expect(detectInstaller(root)).toBe(installer);
    });

    it("takes pnpm from a workspace file when there is no lockfile, and npm otherwise", () => {
        write(".git/HEAD", "");
        expect(detectInstaller(root)).toBe("npm");
        write("pnpm-workspace.yaml", "packages: []\n");
        expect(detectInstaller(root)).toBe("pnpm");
    });

    it("finds the lockfile of the workspace a project sits in", () => {
        write(".git/HEAD", "");
        write("pnpm-lock.yaml", "");
        fs.mkdirSync(path.join(root, "apps", "shop"), { recursive: true });
        expect(detectInstaller(path.join(root, "apps", "shop"))).toBe("pnpm");
    });

    it("does not look above the repository", () => {
        write("pnpm-lock.yaml", "");
        write("repo/.git/HEAD", "");
        expect(detectInstaller(path.join(root, "repo"))).toBe("npm");
    });

    it("installs with each one's own command", () => {
        expect(installCommand("pnpm")).toEqual(["pnpm", ["install"]]);
        expect(installCommand("npm")).toEqual(["npm", ["install"]]);
        expect(installCommand("yarn")).toEqual(["yarn", ["install"]]);
        expect(installCommand("bun")).toEqual(["bun", ["install"]]);
    });
});

describe("isDowngrade", () => {
    it("orders releases and prereleases the way SemVer does", () => {
        expect(isDowngrade("0.22.0", "0.21.0")).toBe(true);
        expect(isDowngrade("^0.19.1", "^0.21.0")).toBe(false);
        expect(isDowngrade("0.21.0", "0.21.0-canary.1")).toBe(true);
        expect(isDowngrade("0.21.0-canary.1", "0.21.0")).toBe(false);
        expect(isDowngrade("0.21.1-canary.10", "0.21.1-canary.9")).toBe(true);
        expect(isDowngrade("0.21.0", "0.21.0")).toBe(false);
    });
});
