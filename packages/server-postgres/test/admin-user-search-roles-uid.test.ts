/**
 * `GET /api/admin/users?search=` finds a user by role and by uid as well as by
 * email and name.
 *
 * Studio's "Run as" picker searches the project's users here and says it
 * searches "by name, email, or role". The query matched email and display name
 * only: an administrator looking for an editor typed "editor" and was told no
 * user matched, and a uid pasted from the users table found nobody.
 *
 * Against a real Postgres (PGlite): whether a row matches is the database's
 * answer.
 */
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { UserService } from "../src/auth/services";

let pglite: PGlite;
let service: UserService;
const ids: Record<string, string> = {};

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
    for (const [email, displayName, roles] of [
        ["ada@example.test", "Ada", "{editor}"],
        ["bob@example.test", "Bob", "{viewer}"],
        ["editorial@example.test", "Desk", "{}"]
    ] as const) {
        const { rows } = await pglite.query<{ id: string }>(
            "INSERT INTO rebase.users (email, display_name, roles) VALUES ($1, $2, $3) RETURNING id",
            [email, displayName, roles]
        );
        ids[email] = rows[0].id;
    }
    service = new UserService(drizzle(pglite) as unknown as ConstructorParameters<typeof UserService>[0]);
});

afterAll(async () => {
    await pglite.close();
});

const emailsFor = async (search: string) => {
    const { users, total } = await service.listUsersPaginated({ search, orderBy: "email", orderDir: "asc" });
    return { emails: users.map(u => u.email), total };
};

describe("the admin user search", () => {
    it("finds a user by a role they hold", async () => {
        expect(await emailsFor("editor")).toEqual({
            emails: ["ada@example.test", "editorial@example.test"],
            total: 2
        });
    });

    it("finds a user by their uid", async () => {
        const uid = ids["bob@example.test"];

        expect(await emailsFor(uid)).toEqual({ emails: ["bob@example.test"], total: 1 });
        expect(await emailsFor(uid.slice(0, 8))).toEqual({ emails: ["bob@example.test"], total: 1 });
    });

    it("still finds by email and by name, and a role's text is still matched literally", async () => {
        expect((await emailsFor("Desk")).emails).toEqual(["editorial@example.test"]);
        expect((await emailsFor("ada@")).emails).toEqual(["ada@example.test"]);
        expect((await emailsFor("edit_r")).emails).toEqual([]);
    });
});
