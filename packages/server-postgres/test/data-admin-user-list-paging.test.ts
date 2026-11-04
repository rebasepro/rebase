/**
 * The admin user list serves every user once, page after page.
 *
 * `GET /api/admin/users` pages by OFFSET over `ORDER BY roles, created_at`. A
 * seed or an import creates its users in one statement, so they share
 * `created_at`, and with nothing after it to break the tie Postgres ordered the
 * tied rows differently for each page: paging 300 such users seven at a time
 * served 300 rows of which only 205 were different users — the rest were never
 * listed at all.
 *
 * Against a real Postgres (PGlite): the order of tied rows is the database's.
 */
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { UserService } from "../src/auth/services";

const USERS = 300;
const PAGE = 7;

let pglite: PGlite;
let service: UserService;

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
        -- One statement, so one now(): every user ties on created_at.
        INSERT INTO rebase.users (email, roles)
        SELECT 'user' || g || '@example.test',
               CASE WHEN g % 3 = 0 THEN '{editor}'::text[] ELSE '{}'::text[] END
        FROM generate_series(1, ${USERS}) g;
    `);
    service = new UserService(drizzle(pglite) as unknown as ConstructorParameters<typeof UserService>[0]);
});

afterAll(async () => {
    await pglite.close();
});

/** Every page of the listing, concatenated. */
async function pageThrough(options: { roleId?: string }, expected: number): Promise<string[]> {
    const seen: string[] = [];
    for (let offset = 0; offset < expected; offset += PAGE) {
        const { users } = await service.listUsersPaginated({ limit: PAGE, offset, ...options });
        seen.push(...users.map(user => user.email));
    }
    return seen;
}

describe("paging the admin user list over users created together", () => {
    it("serves each user exactly once", async () => {
        const seen = await pageThrough({}, USERS);

        expect(seen).toHaveLength(USERS);
        expect(new Set(seen).size).toBe(USERS);
    });

    it("serves each user exactly once when filtered by a role", async () => {
        const editors = USERS / 3;
        const seen = await pageThrough({ roleId: "editor" }, editors);

        expect(seen).toHaveLength(editors);
        expect(new Set(seen).size).toBe(editors);
    });
});
