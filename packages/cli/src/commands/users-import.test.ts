/**
 * `rebase users import <file>`: accounts from another system, keeping their
 * ids, through `POST /api/admin/users/import`.
 *
 * The file is a `psql \copy` CSV or a JSON array; the CLI reads what a CSV
 * cannot say (booleans, role lists, dates), sends the accounts in requests the
 * route accepts, and exits 1 when any account failed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_USERS_PER_IMPORT } from "@rebasepro/types";

import { importHashAlgorithmOf, importUserOf, usersCommand } from "./users";

const argv = (...words: string[]) => ["node", "rebase", ...words];

describe("an import file's row, as the route takes it", () => {
    it("reads psql's CSV: snake_case headers, t/f, a Postgres array, a timestamptz, empty cells", () => {
        expect(importUserOf({
            id: "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b",
            email: " ada@example.com ",
            display_name: "",
            created_at: "2024-05-02 08:30:00.123456+00",
            email_verified: "t",
            roles: "{editor,viewer}"
        })).toEqual({
            id: "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b",
            email: "ada@example.com",
            createdAt: "2024-05-02T08:30:00.123Z",
            emailVerified: true,
            roles: ["editor", "viewer"]
        });
    });

    it("keeps JSON values, splits `a;b` roles, and passes an unknown column on for the server to name", () => {
        expect(importUserOf({ email: "b@example.com", emailVerified: false, roles: ["admin"], phone: "+1" }))
            .toEqual({ email: "b@example.com", emailVerified: false, roles: ["admin"], phone: "+1" });
        expect(importUserOf({ email: "c@example.com", roles: "editor; viewer", email_verified: "no" }))
            .toEqual({ email: "c@example.com", roles: ["editor", "viewer"], emailVerified: false });
    });
});

describe("rebase users import", () => {
    const saved = process.cwd();
    let root: string;
    let stdout: string[];
    let bodies: Array<{ users: Array<Record<string, unknown>>; dryRun?: boolean }>;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-users-import-"));
        fs.writeFileSync(path.join(root, "rebase.json"), "{}");
        fs.writeFileSync(path.join(root, ".env"), "REBASE_SERVICE_KEY=svc\nREBASE_BASE_URL=http://api.test\n");
        process.chdir(root);
        stdout = [];
        bodies = [];
        vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
        vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout.push(String(chunk)); return true; });
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });
    afterEach(() => {
        process.chdir(saved);
        process.exitCode = undefined;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    /** A server that creates every account except the ones named `fail-…`, which it refuses. */
    function stubServer(): string[] {
        const calls: string[] = [];
        vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method ?? "GET"} ${url} ${new Headers(init?.headers).get("Authorization")}`);
            const body = JSON.parse(String(init?.body)) as { users: Array<Record<string, unknown>>; dryRun?: boolean };
            bodies.push(body);
            const results = body.users.map((user, index) => String(user.email).startsWith("fail-")
                ? { index, status: "failed", email: user.email, code: "INVALID_ID", message: "nope" }
                : { index, status: "created", uid: user.id ?? `gen-${index}`, email: user.email });
            const failed = results.filter(r => r.status === "failed").length;
            return new Response(JSON.stringify({ dryRun: body.dryRun === true, created: results.length - failed, skipped: 0, failed, results }), { status: 200 });
        }));
        return calls;
    }

    const output = () => JSON.parse(stdout.join("")) as { created: number; failed: number; dryRun: boolean; results: Array<{ index: number; status: string; email?: string }> };

    it("sends a long file in requests the route accepts, and numbers the results by the file's rows", async () => {
        const calls = stubServer();
        const rows = Array.from({ length: MAX_USERS_PER_IMPORT + 20 }, (_, i) => ({ id: `u-${i}`, email: `u${i}@example.com` }));
        fs.writeFileSync(path.join(root, "users.json"), JSON.stringify(rows));

        await usersCommand("import", argv("users", "import", "users.json", "--json"));

        expect(calls).toEqual([
            "POST http://api.test/api/admin/users/import Bearer svc",
            "POST http://api.test/api/admin/users/import Bearer svc"
        ]);
        expect(bodies.map(b => b.users.length)).toEqual([MAX_USERS_PER_IMPORT, 20]);
        const result = output();
        expect(result).toMatchObject({ created: MAX_USERS_PER_IMPORT + 20, failed: 0, dryRun: false });
        expect(result.results.at(-1)).toMatchObject({ index: MAX_USERS_PER_IMPORT + 19, email: `u${MAX_USERS_PER_IMPORT + 19}@example.com` });
        expect(process.exitCode).toBeUndefined();
    });

    it("reads a CSV, passes --dry-run on, and exits 1 when an account failed", async () => {
        stubServer();
        fs.writeFileSync(path.join(root, "users.csv"), [
            "id,email,created_at,email_verified",
            "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b,ada@example.com,2024-05-02 08:30:00+00,t",
            "x,fail-bob@example.com,,f"
        ].join("\n"));

        await usersCommand("import", argv("users", "import", "users.csv", "--dry-run", "--json"));

        expect(bodies[0]).toEqual({
            dryRun: true,
            users: [
                { id: "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", email: "ada@example.com", createdAt: "2024-05-02T08:30:00.000Z", emailVerified: true },
                { id: "x", email: "fail-bob@example.com", emailVerified: false }
            ]
        });
        expect(output()).toMatchObject({ dryRun: true, created: 1, failed: 1 });
        expect(process.exitCode).toBe(1);
    });

    it("sends nothing for a file with no accounts, and refuses a line with no file", async () => {
        const calls = stubServer();
        fs.writeFileSync(path.join(root, "empty.json"), "[]");

        await usersCommand("import", argv("users", "import", "empty.json", "--json"));
        expect(calls).toEqual([]);
        expect(output()).toMatchObject({ created: 0 });

        await expect(usersCommand("import", argv("users", "import", "--json"))).rejects.toThrow("exit:1");
        expect(calls).toEqual([]);
    });

    it("sends Supabase's encrypted_password as passwordHash with --password-hashes bcrypt", async () => {
        stubServer();
        const hash = "$2a$10$" + "N".repeat(53);
        fs.writeFileSync(path.join(root, "users.csv"), [
            "id,email,encrypted_password",
            `5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b,ada@example.com,${hash}`,
            "6c1b4d0f-32a5-4e4c-9b7f-8d2e3f4a5b6c,magic@example.com,"
        ].join("\n"));

        await usersCommand("import", argv("users", "import", "users.csv", "--password-hashes", "bcrypt", "--json"));

        expect(bodies[0]).toEqual({
            passwordHashAlgorithm: "bcrypt",
            users: [
                { id: "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", email: "ada@example.com", passwordHash: hash },
                { id: "6c1b4d0f-32a5-4e4c-9b7f-8d2e3f4a5b6c", email: "magic@example.com" }
            ]
        });
        expect(output()).toMatchObject({ created: 2, failed: 0 });
    });

    it("refuses a file with password hashes and no --password-hashes, before any request", async () => {
        const calls = stubServer();
        fs.writeFileSync(path.join(root, "users.json"), JSON.stringify([{ email: "ada@example.com", password_hash: "$2b$10$" + "N".repeat(53) }]));

        await expect(usersCommand("import", argv("users", "import", "users.json", "--json"))).rejects.toThrow("exit:1");
        await expect(usersCommand("import", argv("users", "import", "users.json", "--password-hashes", "md5", "--json"))).rejects.toThrow("exit:1");
        expect(calls).toEqual([]);
    });
});

describe("--password-hashes, against the file", () => {
    it("is optional with no hash column, required with one, and takes only a known format", () => {
        expect(importHashAlgorithmOf(undefined, [{ email: "a@example.com" }])).toBeUndefined();
        expect(importHashAlgorithmOf("bcrypt", [{ email: "a@example.com", passwordHash: "$2b$…" }])).toBe("bcrypt");
        expect(() => importHashAlgorithmOf(undefined, [{ email: "a@example.com", passwordHash: "$2b$…" }])).toThrow(/--password-hashes bcrypt/);
        expect(() => importHashAlgorithmOf("argon2", [])).toThrow(/takes bcrypt \(got "argon2"\)/);
    });
});
