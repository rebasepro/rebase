/**
 * `rebase db pull --anonymize`, against a real Postgres.
 *
 * The pass failed on any database where users had signed in more than once:
 * every `token_hash` became the same `'REDACTED'`, `UNIQUE(token_hash)` refused
 * the second row, and because the UPDATEs ran one by one outside a transaction
 * the tables before it were anonymized and the ones after it — `rebase.users`,
 * with the real emails — were not. The command then threw past its own
 * "incomplete copy" message and the role re-grant.
 *
 * So these run the pass on a schema shaped like a Rebase project's own, with the
 * rows that broke it, and assert on what is left in the tables.
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type AtlasDevDatabase, startAtlasDevDatabase } from "./atlas-dev-database";
import { anonymizeCopy } from "./pull";

const REAL_EMAILS = ["ada@corp.example", "grace@corp.example", "edsger@corp.example"];

let database: AtlasDevDatabase;
let client: pg.Client;

beforeAll(async () => {
    database = await startAtlasDevDatabase();
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
}, 60_000);

afterAll(async () => {
    await client?.end().catch(() => undefined);
    await database?.stop();
});

beforeEach(async () => {
    await client.query(`
        DROP SCHEMA IF EXISTS rebase CASCADE;
        DROP SCHEMA IF EXISTS public CASCADE;
        CREATE SCHEMA public;
        CREATE SCHEMA rebase;

        CREATE TABLE rebase.users (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            email text NOT NULL UNIQUE,
            display_name text,
            password_hash text,
            phone varchar(20),
            -- Matches the email pattern by name, and cannot be UPDATEd.
            email_domain text GENERATED ALWAYS AS (split_part(email, '@', 2)) STORED
        );
        -- A user who signed in more than once: several refresh tokens.
        CREATE TABLE rebase.refresh_tokens (
            id serial PRIMARY KEY,
            user_id uuid NOT NULL REFERENCES rebase.users(id) ON DELETE CASCADE,
            token_hash text NOT NULL UNIQUE
        );
        CREATE TABLE public.authors (id serial PRIMARY KEY, name text, email text);
        -- Unique through an expression index, which names no column directly.
        CREATE TABLE public.contacts (id serial PRIMARY KEY, email text);
        CREATE UNIQUE INDEX contacts_email_lower ON public.contacts (lower(email));
        -- Short columns: a replacement must fit them.
        CREATE TABLE public.leads (id serial PRIMARY KEY, zip char(5), billing_email varchar(30) UNIQUE);
        CREATE TABLE public.notes (id serial PRIMARY KEY, body text);
        -- People that no list of table names could know: they have an address.
        CREATE TABLE public.speakers (id serial PRIMARY KEY, name text, contact_email text);
        CREATE TABLE public.tags (id serial PRIMARY KEY, name text);
        -- A view has an email column too, and is not a table to UPDATE.
        CREATE VIEW public.user_emails AS SELECT email FROM rebase.users;
    `);
    const users = await client.query<{ id: string }>(
        `INSERT INTO rebase.users (email, display_name, password_hash, phone) VALUES
            ('${REAL_EMAILS[0]}', 'Ada Lovelace', '$argon2id$real-1', '+44 20 7946 0000'),
            ('${REAL_EMAILS[1]}', 'Grace Hopper', '$argon2id$real-2', NULL)
         RETURNING id`
    );
    await client.query(
        `INSERT INTO rebase.refresh_tokens (user_id, token_hash) VALUES
            ($1, 'hash-a'), ($1, 'hash-b'), ($2, 'hash-c')`,
        [users.rows[0].id, users.rows[1].id]
    );
    await client.query(`INSERT INTO public.authors (name, email) VALUES ('Ada', '${REAL_EMAILS[0]}'), ('Edsger', '${REAL_EMAILS[2]}')`);
    await client.query(`INSERT INTO public.contacts (email) VALUES ('${REAL_EMAILS[1]}'), ('${REAL_EMAILS[2]}')`);
    await client.query(`INSERT INTO public.leads (zip, billing_email) VALUES ('94105', 'ap@corp.example'), ('10001', 'ar@corp.example')`);
    await client.query("INSERT INTO public.notes (body) VALUES ('kept as it is'), ('also kept')");
    await client.query("INSERT INTO public.speakers (name, contact_email) VALUES ('Barbara Liskov', 'barbara@corp.example')");
    await client.query("INSERT INTO public.tags (name) VALUES ('postgres'), ('rls')");
});

/** Every value of every column in the database that still reads as a real address. */
async function realEmailsLeft(): Promise<string[]> {
    const found: string[] = [];
    for (const [table, column] of [
        ["rebase.users", "email"], ["public.authors", "email"], ["public.contacts", "email"], ["public.leads", "billing_email"]
    ]) {
        const { rows } = await client.query<{ value: string }>(`SELECT ${column} AS value FROM ${table}`);
        found.push(...rows.map(row => row.value).filter(value => /@corp\.example$/.test(value)));
    }
    return found;
}

describe("anonymizeCopy", () => {
    it("anonymizes a database whose users signed in more than once", async () => {
        const outcome = await anonymizeCopy(client);

        expect(outcome).toMatchObject({ ok: true });
        expect(await realEmailsLeft()).toEqual([]);

        // Unique where the column is unique, and none of the originals left.
        const tokens = (await client.query<{ token_hash: string }>("SELECT token_hash FROM rebase.refresh_tokens")).rows
            .map(row => row.token_hash);
        expect(tokens).toHaveLength(3);
        expect(new Set(tokens).size).toBe(3);
        expect(tokens.some(token => token.startsWith("hash-"))).toBe(false);

        const users = (await client.query<{ email: string; display_name: string; password_hash: string; phone: string | null; email_domain: string }>(
            "SELECT email, display_name, password_hash, phone, email_domain FROM rebase.users ORDER BY phone NULLS LAST"
        )).rows;
        expect(users.every(user => user.email.endsWith("@example.invalid"))).toBe(true);
        // Every user's name is here, and the pass kept it.
        expect(users.map(user => user.display_name)).toEqual(["Redacted", "Redacted"]);
        expect(users.every(user => !user.password_hash.startsWith("$argon2id$real"))).toBe(true);
        // A NULL stays NULL; the generated column follows the new address.
        expect(users.map(user => user.phone)).toEqual(["+10000000000", null]);
        expect(users.every(user => user.email_domain === "example.invalid")).toBe(true);
    });

    it("fits a replacement to the column, unique columns included", async () => {
        await anonymizeCopy(client);

        const leads = (await client.query<{ zip: string; billing_email: string }>("SELECT zip, billing_email FROM public.leads")).rows;
        expect(leads.every(lead => lead.zip.length === 5 && !/^\d+$/.test(lead.zip))).toBe(true);
        expect(leads.every(lead => lead.billing_email.length <= 30 && lead.billing_email.endsWith("@example.invalid"))).toBe(true);
        expect(new Set(leads.map(lead => lead.billing_email)).size).toBe(2);
    });

    it("leaves columns it does not target, and views, alone", async () => {
        await anonymizeCopy(client);

        const notes = (await client.query<{ body: string }>("SELECT body FROM public.notes ORDER BY id")).rows;
        expect(notes.map(note => note.body)).toEqual(["kept as it is", "also kept"]);
        const tags = (await client.query<{ name: string }>("SELECT name FROM public.tags ORDER BY id")).rows;
        // A bare `name` is redacted only on a table of people: a tag's is not one.
        expect(tags.map(tag => tag.name)).toEqual(["postgres", "rls"]);
    });

    // The blog scaffold's `authors` is a table of people, and its names were
    // copied as they were while its addresses were replaced.
    it("redacts the names on a table of people, the blog scaffold's authors included", async () => {
        await anonymizeCopy(client);

        const authors = (await client.query<{ name: string }>("SELECT name FROM public.authors ORDER BY id")).rows;
        expect(authors.map(author => author.name)).toEqual(["Redacted", "Redacted"]);
        const speakers = (await client.query<{ name: string }>("SELECT name FROM public.speakers ORDER BY id")).rows;
        expect(speakers.map(speaker => speaker.name)).toEqual(["Redacted"]);
    });

    it("is all-or-nothing, and empties what it could not anonymize rather than leave real data", async () => {
        // A constraint no replacement can satisfy, on a table late in the pass:
        // everything before it was anonymized and committed one statement at a
        // time, and everything after it kept the real addresses.
        await client.query(`
            CREATE TABLE rebase.zz_staff (id serial PRIMARY KEY, email text CHECK (email LIKE '%@corp.example'));
            INSERT INTO rebase.zz_staff (email) VALUES ('${REAL_EMAILS[0]}');
        `);

        const outcome = await anonymizeCopy(client);

        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error("narrowing");
        expect(outcome.error).toContain("zz_staff");
        expect(outcome.emptyError).toBeNull();
        expect(outcome.emptied).toEqual(expect.arrayContaining(['"rebase"."users"', '"rebase"."zz_staff"', '"public"."authors"']));

        // No real address anywhere — not anonymized, so not kept.
        expect(await realEmailsLeft()).toEqual([]);
        const staff = await client.query("SELECT 1 FROM rebase.zz_staff");
        expect(staff.rowCount).toBe(0);
        // The sessions went with the users they belong to.
        const tokens = await client.query("SELECT 1 FROM rebase.refresh_tokens");
        expect(tokens.rowCount).toBe(0);
        // What held nothing the pass targets is still there.
        const notes = await client.query("SELECT 1 FROM public.notes");
        expect(notes.rowCount).toBe(2);
        // And the connection is usable: the transaction was rolled back, not left open.
        const after = await client.query<{ n: number }>("SELECT 1 AS n");
        expect(after.rows[0].n).toBe(1);
    });
});
