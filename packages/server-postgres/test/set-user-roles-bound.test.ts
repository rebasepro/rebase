/**
 * `setUserRoles` stores exactly the roles it is given.
 *
 * It used to spell the array as a literal, `{${roles.join(",")}}`, and let
 * Postgres parse it: `"support,admin"` was stored as two roles — one of them
 * `admin`, granted by a `users:write` holder who could not grant `admin` —
 * `"NULL"` became a SQL NULL, and padding was trimmed. Each role is now a bound
 * parameter, and a name that would be read back as other roles is refused.
 *
 * Against a real Postgres (PGlite): what is stored is the database's answer.
 */
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { UserService } from "../src/auth/services";

let pglite: PGlite;
let service: UserService;
let uid: string;

beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    await pglite.exec(`
        CREATE SCHEMA rebase;
        CREATE TABLE rebase.users (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            email text NOT NULL UNIQUE,
            display_name text,
            roles text[] NOT NULL DEFAULT '{}',
            created_at timestamp NOT NULL DEFAULT now(),
            updated_at timestamp NOT NULL DEFAULT now()
        );
    `);
    const { rows } = await pglite.query<{ id: string }>(
        "INSERT INTO rebase.users (email, roles) VALUES ('sup@example.test', '{support}') RETURNING id"
    );
    uid = rows[0].id;
    service = new UserService(drizzle(pglite) as unknown as ConstructorParameters<typeof UserService>[0]);
});

afterAll(async () => {
    await pglite.close();
});

const stored = async () => (await pglite.query<{ roles: (string | null)[] }>(
    "SELECT roles FROM rebase.users WHERE id = $1", [uid]
)).rows[0].roles;

describe("setUserRoles", () => {
    it.each([
        [["support"]],
        [[]],
        [["NULL"]],
        [["  padded  "]],
        [["Editor in chief", "o'brien", "ünïcode"]]
    ])("round-trips %j", async (roles) => {
        await service.setUserRoles(uid, roles);
        expect(await stored()).toEqual(roles);
        expect(await service.getUserRoleIds(uid)).toEqual(roles);
    });

    it.each([
        [["support,admin"]],
        [["{admin}"]],
        [["\"admin\""]],
        [["a\\b"]],
        [[""]]
    ])("refuses %j and leaves the roles as they were", async (roles) => {
        await service.setUserRoles(uid, ["support"]);
        await expect(service.setUserRoles(uid, roles)).rejects.toMatchObject({ code: "INVALID_ROLE" });
        expect(await stored()).toEqual(["support"]);
    });
});
