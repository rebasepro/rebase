/**
 * What a change notification carries, as any database login sees it.
 *
 * Postgres puts no privilege on `LISTEN`. A role with no grant on anything — a
 * BI login, another service's role, a `db connect` user — can `LISTEN
 * rebase_cdc` and receive every payload the capture trigger sends. The trigger
 * used to send the whole changed tuple, so that role received every insert,
 * update and delete on every instrumented table: the auth table's
 * `password_hash` and `email_verification_token` included, past RLS, column
 * grants and `access.read` alike.
 *
 * The consumer reads the key and nothing else — every subscriber re-reads the
 * row under its own scope — so the payload carries the key and nothing else:
 * the columns the consumer addresses a row by, and for a junction table the two
 * ids that name the child list it changed.
 */
import { PGlite } from "@electric-sql/pglite";

import { buildCdcFunctionSql, buildCdcTriggerSql } from "../src/services/cdc/trigger-cdc";
import { parseCdcPayload } from "../src/services/cdc/CdcListener";

/** Values no notification may ever carry. */
const SECRETS = [
    "alice@example.com",
    "scrypt$N=16384$deadbeef$hash",
    "verify-token-123",
    "owner-only role",
    "draft body",
    "linked by mallory",
    "no key at all"
];

/**
 * Each table, how its trigger is attached, and the only columns its payload
 * may name.
 */
const TABLES: Array<{ table: string; ddl: string; trigger: string; identity: string[]; writes: string[] }> = [
    {
        // The auth table, attached with no identity columns — the shape an
        // older boot left it in, and what a table no collection maps still
        // has: the catalogue's primary key is the identity.
        table: "rebase.users",
        ddl: "CREATE TABLE rebase.users (id uuid PRIMARY KEY, email text, password_hash text, email_verification_token text)",
        trigger: buildCdcTriggerSql("rebase", "users"),
        identity: ["id"],
        writes: [
            "INSERT INTO rebase.users VALUES ('00000000-0000-0000-0000-000000000001', 'alice@example.com', 'scrypt$N=16384$deadbeef$hash', 'verify-token-123')",
            "UPDATE rebase.users SET email_verification_token = 'verify-token-123' || '' WHERE id = '00000000-0000-0000-0000-000000000001'",
            "DELETE FROM rebase.users WHERE id = '00000000-0000-0000-0000-000000000001'"
        ]
    },
    {
        table: "public.members",
        ddl: "CREATE TABLE public.members (project_id varchar, user_id varchar, role text, PRIMARY KEY (project_id, user_id))",
        trigger: buildCdcTriggerSql("public", "members"),
        identity: ["project_id", "user_id"],
        writes: [
            "INSERT INTO public.members VALUES ('p1', 'bob', 'owner-only role')",
            "UPDATE public.members SET role = 'owner-only role' WHERE user_id = 'bob'",
            "DELETE FROM public.members WHERE user_id = 'bob'"
        ]
    },
    {
        // A collection whose declared key is not the table's primary key: the
        // trigger is attached with the key the consumer addresses rows by.
        table: "public.docs",
        ddl: "CREATE TABLE public.docs (id serial PRIMARY KEY, slug text UNIQUE, body text)",
        trigger: buildCdcTriggerSql("public", "docs", ["slug"]),
        identity: ["slug"],
        writes: [
            "INSERT INTO public.docs (slug, body) VALUES ('hello', 'draft body')",
            "UPDATE public.docs SET body = 'draft body' || '' WHERE slug = 'hello'",
            "DELETE FROM public.docs WHERE slug = 'hello'"
        ]
    },
    {
        // A junction with a key of its own: the consumer needs the two ids
        // that name the child list, which are not its key.
        table: "public.posts_tags",
        ddl: "CREATE TABLE public.posts_tags (id serial PRIMARY KEY, post_id int, tag_id int, note text)",
        trigger: buildCdcTriggerSql("public", "posts_tags", ["post_id", "tag_id"]),
        identity: ["post_id", "tag_id"],
        writes: [
            "INSERT INTO public.posts_tags (post_id, tag_id, note) VALUES (1, 2, 'linked by mallory')",
            "UPDATE public.posts_tags SET note = 'linked by mallory' || '' WHERE post_id = 1",
            "DELETE FROM public.posts_tags WHERE post_id = 1"
        ]
    },
    {
        // No primary key and nothing named: `id` if there is one, and nothing
        // else — a collection-wide invalidation, never the row.
        table: "public.loose",
        ddl: "CREATE TABLE public.loose (label text)",
        trigger: buildCdcTriggerSql("public", "loose"),
        identity: [],
        writes: [
            "INSERT INTO public.loose VALUES ('no key at all')",
            "DELETE FROM public.loose"
        ]
    }
];

describe("a change notification", () => {
    let db: PGlite;
    const payloads: string[] = [];

    beforeAll(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec("CREATE SCHEMA IF NOT EXISTS rebase;");
        await db.exec(buildCdcFunctionSql());
        for (const { ddl, trigger } of TABLES) {
            await db.exec(`${ddl};\n${trigger}`);
        }
        await db.listen("rebase_cdc", payload => { payloads.push(payload); });
        for (const { writes } of TABLES) {
            for (const write of writes) await db.exec(write);
        }
        const expected = TABLES.reduce((n, t) => n + t.writes.length, 0);
        for (let i = 0; i < 100 && payloads.length < expected; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    });

    afterAll(async () => {
        await db.close();
    });

    it("is sent for every write", () => {
        expect(payloads).toHaveLength(TABLES.reduce((n, t) => n + t.writes.length, 0));
    });

    it("carries none of the row's other values", () => {
        for (const payload of payloads) {
            for (const secret of SECRETS) {
                expect(payload).not.toContain(secret);
            }
        }
    });

    it.each(TABLES.map(t => [t.table, t.identity] as const))(
        "on %s names exactly the identity %j",
        (table, identity) => {
            const [schema, name] = table.split(".");
            const events = payloads
                .map(p => parseCdcPayload(p))
                .filter(e => e?.schema === schema && e.table === name);
            expect(events.length).toBeGreaterThan(0);
            for (const event of events) {
                expect(Object.keys(event!.row).sort()).toEqual([...identity].sort());
            }
        }
    );
});
