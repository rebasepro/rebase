/**
 * E2E: a database instrumented by an older version stops broadcasting rows on
 * its next boot.
 *
 * Postgres puts no privilege on `LISTEN`. The capture trigger used to send
 * `to_jsonb(NEW)` on `rebase_cdc`, so any role that could connect — a BI login
 * with no grant on anything — received every changed row of every instrumented
 * table, the auth table's `password_hash` and verification tokens included.
 *
 * The fix is in the trigger function, and the function is what an existing
 * database already has installed. So this starts from that database: the old
 * function, attached the old way, to collection tables, a junction with a key
 * of its own, and an auth-shaped table the boot does not re-attach. Then it
 * boots the real bootstrapper over it — once with capture on, once with
 * `REALTIME_CDC=off` — and listens as a role with no grants.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper } from "../../src/PostgresBootstrapper.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";

/** The trigger function as versions up to 0.23 installed it, verbatim. */
const LEGACY_CDC_FUNCTION_SQL = `
CREATE SCHEMA IF NOT EXISTS rebase;
CREATE OR REPLACE FUNCTION rebase.rebase_cdc_notify() RETURNS trigger
LANGUAGE plpgsql AS $rebase_cdc$
DECLARE
    rec     jsonb;
    payload text;
    ident   jsonb;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        rec := to_jsonb(OLD);
    ELSE
        rec := to_jsonb(NEW);
    END IF;
    payload := json_build_object('schema', TG_TABLE_SCHEMA, 'table', TG_TABLE_NAME, 'op', TG_OP, 'row', rec)::text;
    IF (octet_length(payload) > 7900) THEN
        SELECT jsonb_object_agg(a.attname, rec->a.attname) INTO ident
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = TG_RELID AND i.indisprimary;
        IF ident IS NULL THEN
            ident := CASE WHEN rec ? 'id' THEN jsonb_build_object('id', rec->'id') ELSE '{}'::jsonb END;
        END IF;
        payload := json_build_object('schema', TG_TABLE_SCHEMA, 'table', TG_TABLE_NAME, 'op', TG_OP, 'row', ident, 'truncated', true)::text;
    END IF;
    PERFORM pg_notify('rebase_cdc', payload);
    RETURN NULL;
END;
$rebase_cdc$;
`;

const legacyTrigger = (qualified: string) =>
    `DROP TRIGGER IF EXISTS rebase_cdc_trigger ON ${qualified};
     CREATE TRIGGER rebase_cdc_trigger AFTER INSERT OR UPDATE OR DELETE ON ${qualified}
     FOR EACH ROW EXECUTE FUNCTION rebase.rebase_cdc_notify();`;

const SCHEMA_SQL = `
    CREATE TABLE public.posts (id text PRIMARY KEY, title text, secret_note text);
    CREATE TABLE public.tags (id text PRIMARY KEY, label text);
    CREATE TABLE public.posts_tags (id serial PRIMARY KEY, post_id text, tag_id text, note text);
    CREATE SCHEMA IF NOT EXISTS rebase;
    CREATE TABLE rebase.legacy_users (id uuid PRIMARY KEY, email text, password_hash text, email_verification_token text);
`;

/** Every value written below that is not a key. None may reach a listener. */
const SECRETS = ["post body secret", "scrypt$N=16384$deadbeef$hash", "verify-token-123", "alice@example.com", "linked by mallory"];

const WRITES = [
    "INSERT INTO public.posts VALUES ('p1', 'Hello', 'post body secret')",
    "UPDATE public.posts SET secret_note = 'post body secret' || '' WHERE id = 'p1'",
    "INSERT INTO public.tags VALUES ('t1', 'pg')",
    "INSERT INTO public.posts_tags (post_id, tag_id, note) VALUES ('p1', 't1', 'linked by mallory')",
    "DELETE FROM public.posts_tags WHERE post_id = 'p1'",
    "INSERT INTO rebase.legacy_users VALUES ('00000000-0000-0000-0000-000000000001', 'alice@example.com', 'scrypt$N=16384$deadbeef$hash', 'verify-token-123')",
    "DELETE FROM rebase.legacy_users",
    "DELETE FROM public.posts WHERE id = 'p1'",
    "DELETE FROM public.tags WHERE id = 't1'"
];

/** The only columns each table's payload may name. */
const ALLOWED: Record<string, string[]> = {
    "public.posts": ["id"],
    "public.tags": ["id"],
    "public.posts_tags": ["id", "post_id", "tag_id"],
    "rebase.legacy_users": ["id"]
};

const postsCollection = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        secret_note: { name: "Secret", type: "string" }
    }
} as unknown as CollectionConfig;

const tagsCollection = {
    name: "Tags",
    slug: "tags",
    table: "tags",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        label: { name: "Label", type: "string" }
    },
    relations: [
        {
            kind: "manyToMany",
            relationName: "posts",
            target: () => postsCollection,
            through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" }
        }
    ]
} as unknown as CollectionConfig;

describe("A database instrumented by an older version (E2E)", () => {
    let container: PgContainer;

    beforeAll(async () => {
        container = await startPgContainer();
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query("CREATE ROLE bi_reader LOGIN PASSWORD 'bi'");
        await admin.query("CREATE DATABASE cdc_on");
        await admin.query("CREATE DATABASE cdc_off");
        await admin.end();
    }, 180_000);

    afterAll(async () => {
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    const urlFor = (database: string, user = "rebase:rebase") =>
        container.connectionString.replace("rebase:rebase@", `${user}@`).replace("/rebase?", `/${database}?`);

    /** The legacy install: the old function, attached the old way, to every table. */
    async function instrumentTheOldWay(url: string): Promise<void> {
        const owner = new pg.Client({ connectionString: url });
        await owner.connect();
        try {
            await owner.query(SCHEMA_SQL);
            await owner.query(LEGACY_CDC_FUNCTION_SQL);
            for (const table of Object.keys(ALLOWED)) await owner.query(legacyTrigger(table));
        } finally {
            await owner.end();
        }
    }

    /** Run the writes on the owner's connection; collect what a grantless login hears. */
    async function listenAsGrantlessRole(database: string): Promise<string[]> {
        const spy = new pg.Client({ connectionString: urlFor(database, "bi_reader:bi") });
        spy.on("error", () => { /* torn down with the container */ });
        await spy.connect();
        const owner = new pg.Client({ connectionString: urlFor(database) });
        owner.on("error", () => { /* torn down with the container */ });
        try {
            const heard: string[] = [];
            spy.on("notification", (msg) => { if (msg.payload) heard.push(msg.payload); });
            await spy.query("LISTEN rebase_cdc");
            // It may read none of this.
            await expect(spy.query("SELECT * FROM rebase.legacy_users")).rejects.toThrow(/permission denied/);

            await owner.connect();
            for (const write of WRITES) await owner.query(write);
            for (let i = 0; i < 100 && heard.length < WRITES.length; i++) await new Promise((r) => setTimeout(r, 20));
            return heard;
        } finally {
            await owner.end().catch(() => {});
            await spy.end().catch(() => {});
        }
    }

    async function boot(database: string, cdcMode: string): Promise<void> {
        const url = urlFor(database);
        const connection = createPostgresDatabaseConnection(url);
        const previous = { direct: process.env.DATABASE_DIRECT_URL, cdc: process.env.REALTIME_CDC };
        try {
            process.env.DATABASE_DIRECT_URL = url;
            process.env.REALTIME_CDC = cdcMode;
            await createPostgresBootstrapper({ connectionString: url, connection: connection.db as never })
                .initializeDriver!({
                    collections: [postsCollection, tagsCollection],
                    dataSourceKey: "(default)",
                    realtime: { subscribe: false, provision: true }
                });
        } finally {
            for (const [key, value] of [["DATABASE_DIRECT_URL", previous.direct], ["REALTIME_CDC", previous.cdc]] as const) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            await connection.pool.end().catch(() => {});
        }
    }

    function assertIdentityOnly(heard: string[]): void {
        expect(heard.length).toBe(WRITES.length);
        for (const payload of heard) {
            for (const secret of SECRETS) expect(payload).not.toContain(secret);
            const { schema, table, row } = JSON.parse(payload) as { schema: string; table: string; row: Record<string, unknown> };
            const allowed = ALLOWED[`${schema}.${table}`];
            expect(allowed, `${schema}.${table}`).toBeDefined();
            for (const key of Object.keys(row)) expect(allowed).toContain(key);
        }
    }

    it("starts from the leak: the old function sends whole rows to a login with no grants", async () => {
        await instrumentTheOldWay(urlFor("cdc_on"));
        const heard = await listenAsGrantlessRole("cdc_on");
        expect(heard.join("\n")).toContain("scrypt$N=16384$deadbeef$hash");
    });

    it("sends only identities after one boot with capture on — including a table the boot does not re-attach", async () => {
        await boot("cdc_on", "trigger");
        assertIdentityOnly(await listenAsGrantlessRole("cdc_on"));
    }, 120_000);

    it("names a junction's two ids, so the child list can still be routed", async () => {
        const heard = (await listenAsGrantlessRole("cdc_on"))
            .map((p) => JSON.parse(p) as { table: string; row: Record<string, unknown> })
            .filter((event) => event.table === "posts_tags");
        expect(heard.length).toBeGreaterThan(0);
        for (const event of heard) expect(event.row).toMatchObject({ post_id: "p1", tag_id: "t1" });
    }, 120_000);

    it("sends only identities after one boot with REALTIME_CDC=off, which leaves the old triggers attached", async () => {
        await instrumentTheOldWay(urlFor("cdc_off"));
        await boot("cdc_off", "off");
        assertIdentityOnly(await listenAsGrantlessRole("cdc_off"));
    }, 120_000);
});
