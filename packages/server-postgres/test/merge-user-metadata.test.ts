/**
 * `mergeUserMetadata` sets and removes single keys of an account's metadata
 * and leaves the others — where the platform's grant of `admin` is recorded
 * (`platform-grants.ts` in `@rebasepro/server`).
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
            roles text[] NOT NULL DEFAULT '{}',
            metadata jsonb NOT NULL DEFAULT '{}',
            created_at timestamp NOT NULL DEFAULT now(),
            updated_at timestamp NOT NULL DEFAULT now()
        );
    `);
    const { rows } = await pglite.query<{ id: string }>(
        `INSERT INTO rebase.users (email, metadata) VALUES ('owner@example.test', '{"plan":"pro"}') RETURNING id`
    );
    uid = rows[0].id;
    service = new UserService(drizzle(pglite));
});

afterAll(async () => {
    await pglite.close();
});

const stored = async () => (await pglite.query<{ metadata: Record<string, unknown> }>(
    "SELECT metadata FROM rebase.users WHERE id = $1", [uid]
)).rows[0].metadata;

describe("mergeUserMetadata", () => {
    it("sets a key and keeps the others", async () => {
        await service.mergeUserMetadata(uid, { platformRoles: ["admin"] });
        expect(await stored()).toEqual({ plan: "pro", platformRoles: ["admin"] });
    });

    it("replaces a key's value", async () => {
        await service.mergeUserMetadata(uid, { platformRoles: ["admin", "editor"] });
        expect(await stored()).toEqual({ plan: "pro", platformRoles: ["admin", "editor"] });
    });

    it("removes a key given null, and keeps the others", async () => {
        await service.mergeUserMetadata(uid, { platformRoles: null });
        expect(await stored()).toEqual({ plan: "pro" });
    });

    it("binds the key rather than splicing it into the statement", async () => {
        await service.mergeUserMetadata(uid, { "a'b\"}": 1 });
        expect(await stored()).toEqual({ plan: "pro", "a'b\"}": 1 });
    });
});
