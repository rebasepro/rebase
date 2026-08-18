/**
 * `rebase doctor`'s connection-string check.
 *
 * The plugin's drift check connects through node-postgres, which parses these
 * URLs happily — so it cannot see this defect. Without this check a project
 * scaffolded before 2026-08-18 gets a clean bill of health while
 * `rebase db backup` has never once worked on it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { findLibpqUrlProblems } from "./doctor.js";

const BROKEN = "postgresql://rebase_app:pw@127.0.0.1:5435/rebase?options=-c%20search_path=public&sslmode=disable";
const FIXED = "postgresql://rebase_app:pw@127.0.0.1:5435/rebase?options=-c%20search_path%3Dpublic&sslmode=disable";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-doctor-test-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("findLibpqUrlProblems", () => {
    it("finds the URL rebase init used to generate", () => {
        fs.writeFileSync(path.join(root, ".env"), `DATABASE_URL=${BROKEN}\n`);
        const findings = findLibpqUrlProblems(root);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ file: ".env", variable: "DATABASE_URL" });
        expect(findings[0].suggested).toBe(FIXED);
    });

    it("says nothing about a project scaffolded after the fix", () => {
        fs.writeFileSync(path.join(root, ".env"), `DATABASE_URL=${FIXED}\n`);
        expect(findLibpqUrlProblems(root)).toEqual([]);
    });

    it("checks the compose files a deployed stack runs on", () => {
        /*
         * The exposure that outlives a fixed .env: the container's scheduled
         * backup cron reads its connection string from here, so a stack whose
         * .env was corrected still has no working backups until the compose
         * file is too.
         */
        fs.writeFileSync(path.join(root, ".env"), `DATABASE_URL=${FIXED}\n`);
        fs.writeFileSync(
            path.join(root, "docker-compose.yml"),
            `services:\n  api:\n    environment:\n      DATABASE_URL: ${BROKEN}\n`
        );
        const findings = findLibpqUrlProblems(root);
        expect(findings.map(f => f.file)).toEqual(["docker-compose.yml"]);
    });

    it("reads an .env that lives outside the project root", () => {
        // findEnvFile can resolve one elsewhere; doctor passes it in explicitly.
        const elsewhere = path.join(root, "config");
        fs.mkdirSync(elsewhere);
        const envFile = path.join(elsewhere, ".env");
        fs.writeFileSync(envFile, `DATABASE_URL=${BROKEN}\n`);
        expect(findLibpqUrlProblems(root, envFile)).toHaveLength(1);
    });

    it("does not report the same file twice when it is also the resolved env file", () => {
        const envFile = path.join(root, ".env");
        fs.writeFileSync(envFile, `DATABASE_URL=${BROKEN}\n`);
        expect(findLibpqUrlProblems(root, envFile)).toHaveLength(1);
    });

    it("ignores .env.example, which nothing runs on", () => {
        fs.writeFileSync(path.join(root, ".env.example"), `DATABASE_URL=${BROKEN}\n`);
        expect(findLibpqUrlProblems(root)).toEqual([]);
    });

    it("is silent on a project with no connection files at all", () => {
        expect(findLibpqUrlProblems(root)).toEqual([]);
    });

    it("reports each offending file separately", () => {
        fs.writeFileSync(path.join(root, ".env"), `DATABASE_URL=${BROKEN}\n`);
        fs.writeFileSync(
            path.join(root, "docker-compose.custom.yml"),
            `      ADMIN_CONNECTION_STRING: ${BROKEN}\n`
        );
        const findings = findLibpqUrlProblems(root);
        expect(findings).toHaveLength(2);
        expect(new Set(findings.map(f => f.file)))
            .toEqual(new Set([".env", "docker-compose.custom.yml"]));
    });
});
