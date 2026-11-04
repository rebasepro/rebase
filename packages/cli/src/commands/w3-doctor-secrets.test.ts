/**
 * `rebase doctor` names a connection string libpq cannot parse without
 * printing the password in it.
 *
 * The report used to print the corrected string whole, so the database
 * password in `.env` went to the terminal, to CI logs, and — through the MCP
 * server's `rebase_doctor` tool — into an assistant's context. It now prints
 * the one parameter to change, as it is and as it should be.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { findLibpqUrlProblems, reportLibpqUrlProblems } from "./doctor.js";

const PASSWORD = "s3cret-Passw0rd";

let root: string;
let printed: string[];

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-w3-doctor-"));
    printed = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(" "));
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

describe("the unparseable connection-string report", () => {
    it("prints the parameter to change, and not the password", () => {
        fs.writeFileSync(
            path.join(root, ".env"),
            `DATABASE_URL=postgresql://rebase_app:${PASSWORD}@db.internal:5432/rebase?options=-c%20search_path=public&sslmode=disable\n`
        );

        expect(reportLibpqUrlProblems(findLibpqUrlProblems(root))).toBe(true);

        const text = printed.join("\n");
        expect(text).not.toContain(PASSWORD);
        expect(text).toContain("options=-c%20search_path=public");
        expect(text).toContain("options=-c%20search_path%3Dpublic");
    });

    it("masks a password carried as a query parameter", () => {
        fs.writeFileSync(
            path.join(root, ".env"),
            `DATABASE_URL=postgresql://rebase_app@db.internal:5432/rebase?password=${PASSWORD}=x&sslmode=disable\n`
        );

        expect(reportLibpqUrlProblems(findLibpqUrlProblems(root))).toBe(true);

        expect(printed.join("\n")).not.toContain(PASSWORD);
    });
});
