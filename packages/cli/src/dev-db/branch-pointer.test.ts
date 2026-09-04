/**
 * The pointer that makes a branch usable.
 *
 * Before it, `rebase db branch create` copied the database and stopped: there
 * was no `switch`, no `--branch` on `rebase dev`, and the `.env` was
 * byte-identical afterwards despite the documentation saying otherwise. These
 * fix the two things that make the pointer safe to have — that it never becomes
 * a second copy of the password, and that it loses nothing from the base
 * connection string.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    BRANCH_DB_PREFIX,
    branchDatabaseName,
    branchPointerPath,
    branchUrl,
    clearActiveBranch,
    databaseNameOf,
    readActiveBranch,
    writeActiveBranch
} from "./branch-pointer";

describe("branchUrl", () => {
    const base = "postgresql://rebase:s3cret@localhost:5434/leadgen?sslmode=disable";

    it("swaps only the database name", () => {
        expect(branchUrl(base, "rb_feature_auth"))
            .toBe("postgresql://rebase:s3cret@localhost:5434/rb_feature_auth?sslmode=disable");
    });

    it("keeps the query string, which is load-bearing", () => {
        // Dropping `?sslmode=disable` turns a switch into a TLS error that says
        // nothing about branches — and it is what a local Docker Postgres needs.
        expect(branchUrl(base, "rb_x")).toContain("sslmode=disable");
    });

    it("keeps credentials, host and port", () => {
        const url = new URL(branchUrl(base, "rb_x")!);
        expect(url.username).toBe("rebase");
        expect(url.password).toBe("s3cret");
        expect(url.host).toBe("localhost:5434");
    });

    it("handles a base with no database at all", () => {
        expect(branchUrl("postgresql://localhost:5432", "rb_x"))
            .toBe("postgresql://localhost:5432/rb_x");
    });

    it("returns null rather than a mangled URL", () => {
        expect(branchUrl("not a connection string", "rb_x")).toBeNull();
    });
});

describe("databaseNameOf", () => {
    it("reads the database out of a connection string", () => {
        expect(databaseNameOf("postgresql://u:p@h:5432/leadgen?x=1")).toBe("leadgen");
    });

    it("is null when there is no database", () => {
        expect(databaseNameOf("postgresql://h:5432")).toBeNull();
    });

    it("is null for something unparseable, rather than throwing", () => {
        expect(databaseNameOf("???")).toBeNull();
    });
});

describe("branchDatabaseName", () => {
    it("matches the prefix BranchService applies", () => {
        // If the driver's prefix ever moves, this is the test that says so —
        // the CLI must resolve a database before it loads a driver.
        expect(BRANCH_DB_PREFIX).toBe("rb_");
        expect(branchDatabaseName("feature_auth")).toBe("rb_feature_auth");
    });

    it("leaves a hyphenated name exactly as given", () => {
        // Branch names stopped being stripped; a name that comes back different
        // from the one typed is the bug that change fixed.
        expect(branchDatabaseName("my-feature")).toBe("rb_my-feature");
    });
});

describe("the pointer file", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-branch-"));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("is absent until something is written", () => {
        expect(readActiveBranch(root)).toBeNull();
    });

    it("round-trips a branch", () => {
        writeActiveBranch(root, { name: "feature_auth", database: "rb_feature_auth" });
        expect(readActiveBranch(root)).toEqual({ name: "feature_auth", database: "rb_feature_auth" });
    });

    it("lives in .rebase/, which is gitignored — a branch is a fact about one machine", () => {
        writeActiveBranch(root, { name: "x", database: "rb_x" });
        expect(branchPointerPath(root)).toBe(path.join(root, ".rebase", "branch.json"));
        expect(fs.existsSync(path.join(root, ".rebase", "branch.json"))).toBe(true);
    });

    it("never stores a connection string", () => {
        writeActiveBranch(root, { name: "x", database: "rb_x" });
        const raw = fs.readFileSync(branchPointerPath(root), "utf-8");
        expect(raw).not.toMatch(/postgres(ql)?:\/\//);
    });

    it("creates .rebase/ when the project has none yet", () => {
        expect(() => writeActiveBranch(root, { name: "x", database: "rb_x" })).not.toThrow();
    });

    it("reads a corrupt file as no branch rather than throwing", () => {
        fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
        fs.writeFileSync(branchPointerPath(root), "{ not json");
        expect(readActiveBranch(root)).toBeNull();
    });

    it("reads a file missing its fields as no branch", () => {
        fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
        fs.writeFileSync(branchPointerPath(root), JSON.stringify({ name: "x" }));
        expect(readActiveBranch(root)).toBeNull();
    });

    it("clears, and clearing twice is not an error", () => {
        writeActiveBranch(root, { name: "x", database: "rb_x" });
        clearActiveBranch(root);
        expect(readActiveBranch(root)).toBeNull();
        expect(() => clearActiveBranch(root)).not.toThrow();
    });
});
