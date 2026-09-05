import { describe, expect, it } from "vitest";
import {
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
    it("reports two collections claiming one slug", () => {
        const [finding] = checkDuplicateSlugs([
            { slug: "posts" }, { slug: "authors" }, { slug: "posts" }
        ]);
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
