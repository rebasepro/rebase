/**
 * What a project command says in a directory that is not linked.
 *
 * `deploy` is the last step `rebase init` prints, and it answered every new
 * user with "Pass --project <slug> or run rebase cloud link". `link` then
 * wanted a sign-in, then a project it cannot create — four refusals before a
 * first deploy. The refusal now names the next step for where the user is.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, afterEach } from "vitest";
import chalk from "chalk";
import { hasCloudCredential, notLinkedGuidance } from "./context";

const CP = "https://app.rebase.pro";

/** A home directory whose credentials file holds `contexts`. */
function homeWith(contexts: Record<string, { auth?: string }>): void {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-not-linked-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    fs.mkdirSync(path.join(home, ".rebase"), { recursive: true });
    fs.writeFileSync(path.join(home, ".rebase", "credentials.json"), JSON.stringify({ contexts }));
}

describe("a directory that is not linked", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it("shows someone with no session the whole first deploy, in order", () => {
        const level = chalk.level;
        chalk.level = 0;
        try {
            const [message, hint] = notLinkedGuidance(false);
            expect(message).toMatch(/not signed in/);
            const steps = ["rebase cloud login", "rebase cloud billing setup", "rebase cloud projects create --link", "rebase cloud deploy"];
            const at = steps.map(step => hint.indexOf(step));
            expect(at.every(i => i >= 0), hint).toBe(true);
            expect([...at].sort((a, b) => a - b)).toEqual(at);
        } finally {
            chalk.level = level;
        }
    });

    it("offers someone signed in a way to create the project and a way to link one", () => {
        const level = chalk.level;
        chalk.level = 0;
        try {
            const [, hint] = notLinkedGuidance(true);
            expect(hint).toContain("rebase cloud projects create --link");
            expect(hint).toContain("rebase cloud link <slug>");
            expect(hint).not.toContain("rebase cloud login");
        } finally {
            chalk.level = level;
        }
    });

    it("reads a session from the credentials file for that control plane only", () => {
        vi.stubEnv("REBASE_TOKEN", "");
        homeWith({ [CP]: { auth: "{\"refreshToken\":\"r\"}" } });
        expect(hasCloudCredential(CP)).toBe(true);
        expect(hasCloudCredential("https://cp.example")).toBe(false);
    });

    it("counts REBASE_TOKEN as a credential", () => {
        homeWith({});
        vi.stubEnv("REBASE_TOKEN", "rpt_ci_token");
        expect(hasCloudCredential(CP)).toBe(true);
    });

    it("has none on a machine that never signed in", () => {
        vi.stubEnv("REBASE_TOKEN", "");
        homeWith({});
        expect(hasCloudCredential(CP)).toBe(false);
    });
});
