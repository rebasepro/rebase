import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readAtlasBinaryState } from "./commands/doctor";
import {
    checkAtlasBinary,
    checkDuplicateSlugs,
    checkEnvSanity,
    checkNodeVersion,
    checkPackageManager,
    checkVersionSkew,
    minimumFromRange,
    parseEnvFile
} from "./doctor-environment";

/**
 * One fixture per check, each of which fails it.
 *
 * `rebase doctor` compared three descriptions of a schema — the right check for
 * a project that works, and the wrong one for a project that has never worked.
 * Everything below breaks a first run, and every one of them happens before a
 * table is compared.
 */

describe("Node version", () => {
    it("names the version and the range when the running Node is too old", () => {
        const [finding] = checkNodeVersion("18.19.0", ">=20");
        expect(finding.severity).toBe("error");
        expect(finding.message).toContain("18.19.0");
        expect(finding.message).toContain(">=20");
        expect(finding.fix).toContain("nvm install 20");
    });

    it("says nothing when the running Node satisfies the range", () => {
        expect(checkNodeVersion("22.11.0", ">=20")).toEqual([]);
        expect(checkNodeVersion("20.0.0", ">=20")).toEqual([]);
    });

    it("compares by component, not lexically", () => {
        // "9.0.0" > "20.0.0" as strings, and this check would then pass a Node
        // nine major versions too old.
        expect(checkNodeVersion("9.0.0", ">=20").length).toBe(1);
        expect(checkNodeVersion("20.11.0", ">=20.12").length).toBe(1);
    });

    it("declines to guess at a range it does not understand", () => {
        expect(checkNodeVersion("18.0.0", "^20 || ^22")).toEqual([]);
        expect(minimumFromRange("^20")).toBeNull();
    });
});

describe("package manager", () => {
    it("reports two lockfiles as an error, and names both", () => {
        const [finding] = checkPackageManager(["pnpm-lock.yaml", "package-lock.json"], "pnpm@10.0.0");
        expect(finding.severity).toBe("error");
        expect(finding.message).toContain("pnpm-lock.yaml");
        expect(finding.message).toContain("package-lock.json");
        expect(finding.fix).toContain("pnpm");
    });

    it("reports a single lockfile that disagrees with packageManager", () => {
        const [finding] = checkPackageManager(["package-lock.json"], "pnpm@10.0.0");
        expect(finding.severity).toBe("warning");
        expect(finding.fix).toContain("pnpm");
    });

    it("says nothing about a project with one matching lockfile", () => {
        expect(checkPackageManager(["pnpm-lock.yaml"], "pnpm@10.0.0")).toEqual([]);
        expect(checkPackageManager([], undefined)).toEqual([]);
    });
});

describe("duplicate slugs", () => {
    it("reports two tables claiming one slug", () => {
        const [finding] = checkDuplicateSlugs([
            { slug: "posts" }, { slug: "authors" }, { slug: "posts" }
        ]);
        expect(finding.check).toBe("tables");
        expect(finding.severity).toBe("error");
        expect(finding.message).toContain("posts");
        // The registry keeps the last registration, so the loser is served as
        // the winner rather than reported missing — which is why every symptom
        // of this points somewhere else.
        expect(finding.message).toContain("last one registered");
    });

    it("says nothing when every slug is distinct", () => {
        expect(checkDuplicateSlugs([{ slug: "posts" }, { slug: "authors" }])).toEqual([]);
    });
});

describe(".env sanity", () => {
    it("reports a JWT_SECRET too short for the runtime to accept", () => {
        const [finding] = checkEnvSanity({ JWT_SECRET: "short" });
        expect(finding.message).toContain("5 characters");
        expect(finding.message).toContain("32");
        expect(finding.fix).toContain("openssl rand -hex 32");
    });

    it("raises the same finding to an error in production", () => {
        expect(checkEnvSanity({ JWT_SECRET: "short" })[0].severity).toBe("warning");
        expect(checkEnvSanity({ JWT_SECRET: "short", NODE_ENV: "production" })[0].severity).toBe("error");
    });

    it("reports production with no CORS configuration at all", () => {
        const findings = checkEnvSanity({ NODE_ENV: "production" });
        expect(findings.some(f => f.message.includes("any origin"))).toBe(true);
    });

    it("accepts production with either variable set", () => {
        expect(checkEnvSanity({ NODE_ENV: "production", CORS_ORIGINS: "https://app.example" })).toEqual([]);
        expect(checkEnvSanity({ NODE_ENV: "production", FRONTEND_URL: "https://app.example" })).toEqual([]);
    });

    it("never echoes a value", () => {
        const findings = checkEnvSanity({ JWT_SECRET: "hunter2", NODE_ENV: "production" });
        expect(findings.map(f => `${f.message} ${f.fix}`).join("\n")).not.toContain("hunter2");
    });

    it("parses a .env without touching process.env", () => {
        const before = process.env.REBASE_DOCTOR_FIXTURE;
        const values = parseEnvFile([
            "# a comment",
            "REBASE_DOCTOR_FIXTURE=1",
            "export JWT_SECRET=\"quoted value\"",
            "MALFORMED"
        ].join("\n"));

        expect(values.REBASE_DOCTOR_FIXTURE).toBe("1");
        expect(values.JWT_SECRET).toBe("quoted value");
        expect(values.MALFORMED).toBeUndefined();
        expect(process.env.REBASE_DOCTOR_FIXTURE).toBe(before);
    });

    it("reads a trailing comment as a comment, as the server's dotenv does", () => {
        const values = parseEnvFile([
            "NODE_ENV=production # deployed with compose",
            "JWT_SECRET=0123456789abcdef0123456789abcdef   # rotated quarterly"
        ].join("\r\n"));

        expect(values.NODE_ENV).toBe("production");
        expect(values.JWT_SECRET).toBe("0123456789abcdef0123456789abcdef");
        // Production with no CORS is reported, and the 32-character secret is not.
        expect(checkEnvSanity(values).map(f => f.message)).toEqual([
            expect.stringContaining("NODE_ENV=production with neither CORS_ORIGINS nor FRONTEND_URL")
        ]);
    });
});

describe("version skew", () => {
    it("reports one package pinned to two versions, and names both files", () => {
        const [finding] = checkVersionSkew([
            { file: "package.json", name: "@rebasepro/server", range: "^0.17.3" },
            { file: "backend/package.json", name: "@rebasepro/server", range: "^0.16.0" }
        ]);
        expect(finding.severity).toBe("error");
        expect(finding.message).toContain("^0.17.3");
        expect(finding.message).toContain("backend/package.json");
        // The failure is not an install error — it is `instanceof` quietly
        // returning false across two copies of the same class.
        expect(finding.fix).toContain("instanceof");
    });

    it("ignores workspace and link protocols, which resolve to one build", () => {
        expect(checkVersionSkew([
            { file: "package.json", name: "@rebasepro/server", range: "workspace:*" },
            { file: "backend/package.json", name: "@rebasepro/server", range: "^0.17.3" }
        ])).toEqual([]);
    });

    it("ignores packages that are not ours", () => {
        expect(checkVersionSkew([
            { file: "package.json", name: "hono", range: "^4.13.0" },
            { file: "backend/package.json", name: "hono", range: "^4.10.0" }
        ])).toEqual([]);
    });

    it("says nothing when every declaration agrees", () => {
        expect(checkVersionSkew([
            { file: "package.json", name: "@rebasepro/server", range: "^0.17.3" },
            { file: "backend/package.json", name: "@rebasepro/server", range: "^0.17.3" }
        ])).toEqual([]);
    });
});

/**
 * The Ptah compatibility binary used by database commands.
 *
 * A missing package and a missing native executable need different remedies.
 */
describe("atlas binary", () => {
    const base = { packageInstalled: true, binaryOnDisk: true, manager: "pnpm" };

    it("says nothing when the package and binary are installed", () => {
        expect(checkAtlasBinary(base)).toEqual([]);
    });

    it("does not mistake an installed package for a present native binary", () => {
        expect(checkAtlasBinary({ ...base, packageInstalled: false })).toHaveLength(1);
        expect(checkAtlasBinary({ ...base, binaryOnDisk: false })[0].fix)
            .toContain("optional dependencies");
    });

    it("says nothing when the state could not be read", () => {
        expect(checkAtlasBinary(null)).toEqual([]);
    });

    it("tells an uninstalled project to install it, in its own package manager", () => {
        const [finding] = checkAtlasBinary({ ...base, packageInstalled: false, manager: "npm" });
        expect(finding.check).toBe("atlas");
        expect(finding.message).toContain("not installed");
        expect(finding.fix).toContain("npm add -D @stokaro/ptah-compat");
    });

    it("installs into the workspace member that runs it, where the root would refuse", () => {
        // A scaffold is a workspace and `@stokaro/ptah-compat` belongs to `backend/`:
        // `pnpm add -D` at its root fails with ERR_PNPM_ADDING_TO_ROOT.
        const fixes = (["pnpm", "npm", "yarn", "bun"] as const).map(manager =>
            checkAtlasBinary({ ...base, packageInstalled: false, manager, workspaceDir: "backend" })[0].fix);
        expect(fixes).toEqual([
            expect.stringContaining("pnpm --dir backend add -D @stokaro/ptah-compat"),
            expect.stringContaining("npm install -D @stokaro/ptah-compat -w backend"),
            expect.stringContaining("yarn --cwd backend add -D @stokaro/ptah-compat"),
            expect.stringContaining("bun add -d @stokaro/ptah-compat --cwd backend")
        ]);
    });

    it("reinstalls when the package is there and the binary is not", () => {
        const [finding] = checkAtlasBinary({ ...base, binaryOnDisk: false });
        expect(finding.message).toContain("executable is missing");
        expect(finding.fix).toContain("Reinstall");
    });

});

describe("atlas binary state on disk", () => {
    /**
     * pnpm's isolated layout — the scaffold default. The compatibility CLI
     * can live under `.pnpm/` with a link from the driver's `node_modules`.
     * A directory walk from the project root alone would miss it.
     */
    it("finds the binary through the driver and a direct pnpm symlink", () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "doctor-atlas-")));
        const store = path.join(root, "node_modules", ".pnpm");
        const atlasDir = path.join(store, "@stokaro+ptah-compat@1.0.0", "node_modules", "@stokaro", "ptah-compat");
        const driverDir = path.join(store, "@rebasepro+server-postgres@0.0.0", "node_modules", "@rebasepro", "server-postgres");
        fs.mkdirSync(atlasDir, { recursive: true });
        fs.mkdirSync(driverDir, { recursive: true });
        fs.writeFileSync(path.join(atlasDir, "package.json"), JSON.stringify({ name: "@stokaro/ptah-compat", version: "1.0.0", bin: { atlas: "bin/ptah-compat.mjs" } }));
        fs.mkdirSync(path.join(atlasDir, "bin"));
        fs.writeFileSync(path.join(atlasDir, "bin", "ptah-compat.mjs"), "#!/usr/bin/env node\n");
        const ptahDir = path.join(atlasDir, "node_modules", "@stokaro", "ptah");
        const nativeDir = path.join(ptahDir, "node_modules", "@stokaro", `ptah-${process.platform}-${process.arch}`);
        fs.mkdirSync(nativeDir, { recursive: true });
        fs.writeFileSync(path.join(ptahDir, "package.json"), JSON.stringify({ name: "@stokaro/ptah", version: "1.0.0" }));
        fs.writeFileSync(path.join(nativeDir, "package.json"), JSON.stringify({ name: `@stokaro/ptah-${process.platform}-${process.arch}`, version: "1.0.0" }));
        fs.mkdirSync(path.join(nativeDir, "bin"));
        const nativeBinary = path.join(nativeDir, "bin", `ptah-compat${process.platform === "win32" ? ".exe" : ""}`);
        fs.writeFileSync(nativeBinary, "");
        fs.writeFileSync(path.join(driverDir, "package.json"), JSON.stringify({ name: "@rebasepro/server-postgres", version: "0.0.0", dependencies: { "@stokaro/ptah-compat": "1.0.0" } }));
        // The driver's own node_modules links to atlas, and carries the .bin shim.
        fs.mkdirSync(path.join(driverDir, "node_modules", "@stokaro"), { recursive: true });
        fs.symlinkSync(atlasDir, path.join(driverDir, "node_modules", "@stokaro", "ptah-compat"));
        fs.mkdirSync(path.join(driverDir, "node_modules", ".bin"), { recursive: true });
        fs.writeFileSync(path.join(driverDir, "node_modules", ".bin", "atlas"), "#!/bin/sh\n");
        // The project depends on the driver only.
        fs.mkdirSync(path.join(root, "node_modules", "@rebasepro"), { recursive: true });
        fs.symlinkSync(driverDir, path.join(root, "node_modules", "@rebasepro", "server-postgres"));
        fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { "@rebasepro/server-postgres": "0.0.0" } }));

        // Vitest resolves workspace packages from this repository, even when
        // createRequire starts in the temporary project. Keep this probe on
        // the fixture's module graph.
        const resolveFixture = (from: string, request: string): string | null => {
            if (from === path.join(root, "package.json") && request === "@rebasepro/server-postgres/package.json") {
                return path.join(driverDir, "package.json");
            }
            if (from === path.join(driverDir, "package.json") && request === "@stokaro/ptah-compat/package.json") {
                return path.join(atlasDir, "package.json");
            }
            if (from === path.join(atlasDir, "package.json") && request === "@stokaro/ptah/package.json") {
                return path.join(ptahDir, "package.json");
            }
            if (from === path.join(ptahDir, "package.json") && request === `@stokaro/ptah-${process.platform}-${process.arch}/package.json`) {
                return path.join(nativeDir, "package.json");
            }
            return null;
        };
        const state = readAtlasBinaryState(root, resolveFixture);
        expect(state).not.toBeNull();
        expect(state!.packageInstalled).toBe(true);
        expect(state!.binaryOnDisk).toBe(true);
        const backendDir = path.join(root, "backend");
        fs.mkdirSync(path.join(backendDir, "node_modules", "@stokaro"), { recursive: true });
        fs.writeFileSync(path.join(backendDir, "package.json"), JSON.stringify({ name: "backend", dependencies: { "@stokaro/ptah-compat": "1.0.0" } }));
        fs.symlinkSync(atlasDir, path.join(backendDir, "node_modules", "@stokaro", "ptah-compat"));
        expect(readAtlasBinaryState(root, resolveFixture)?.binaryOnDisk).toBe(true);
        fs.rmSync(nativeBinary);
        expect(readAtlasBinaryState(root, resolveFixture)?.binaryOnDisk).toBe(false);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("names backend/ as where the install goes in a workspace, and nothing at a plain project", () => {
        const scaffold = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-atlas-ws-"));
        fs.writeFileSync(path.join(scaffold, "package.json"), JSON.stringify({ name: "app" }));
        fs.writeFileSync(path.join(scaffold, "pnpm-workspace.yaml"), "packages:\n  - backend\n");
        fs.mkdirSync(path.join(scaffold, "backend"));
        fs.writeFileSync(path.join(scaffold, "backend", "package.json"), JSON.stringify({ name: "backend" }));
        const plain = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-atlas-plain-"));
        fs.writeFileSync(path.join(plain, "package.json"), JSON.stringify({ name: "app" }));

        expect(readAtlasBinaryState(scaffold)?.workspaceDir).toBe("backend");
        expect(readAtlasBinaryState(plain)?.workspaceDir).toBeNull();
        fs.rmSync(scaffold, { recursive: true, force: true });
        fs.rmSync(plain, { recursive: true, force: true });
    });
});
