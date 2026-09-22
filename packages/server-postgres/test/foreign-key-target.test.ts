/**
 * A foreign key points at the target's primary-key COLUMN, with the column's
 * own type.
 *
 * Two facts about the target reach every column that links to it — the name
 * `REFERENCES` gives, and the type the linking column is created with — and
 * both used to be read off the wrong thing:
 *
 * - the name was the primary key's *property key*. `authorId: { isId: "uuid" }`
 *   is the column `author_id`, so `REFERENCES "authors" ("authorId")` named a
 *   column that does not exist (42703). `db push` could not build its desired
 *   state at all, and at boot the constraint failed — survivably, so it was
 *   simply never there, and the failure repeated on every boot. A database
 *   adopted with `rebase schema introspect` has exactly this shape.
 * - the type was derived from `isId` alone. `id: { isId: true, columnType:
 *   "uuid" }` made every linking column TEXT, and a TEXT column cannot reference
 *   a UUID one (42804); `columnType: "bigint"` made them INTEGER, which
 *   overflows at 2^31.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { renderDrizzleSchema } from "../src/schema/plan/render-drizzle";
import type { ColumnPlan, SchemaPlan } from "../src/schema/plan/types";
import {
    ensureCollectionTables,
    planCollectionSchemaEnsure,
    readExistingSchema,
    type ExistingSchema
} from "../src/schema/ensure-collection-tables";

/** A primary key whose property key and column differ. */
const authors: CollectionConfig = {
    slug: "authors",
    table: "authors",
    name: "Authors",
    properties: {
        authorId: { name: "Author id", type: "string", isId: "uuid" },
        name: { type: "string" }
    }
};

const tags: CollectionConfig = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: {
        tagId: { name: "Tag id", type: "number", isId: "increment" },
        label: { type: "string" }
    }
};

/** Every way a column comes to point at a key: belongsTo, reference, and a junction. */
const posts: CollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        postId: { name: "Post id", type: "string", isId: "uuid" },
        title: { type: "string" },
        author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => authors } },
        editor: { name: "Editor", type: "reference", path: "authors" },
        tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
};

/** Keys whose type is stated by `columnType`, not by the id strategy. */
const uuidOrgs: CollectionConfig = {
    slug: "orgs",
    table: "orgs",
    name: "Orgs",
    properties: { id: { name: "ID", type: "string", isId: true, columnType: "uuid" } }
};
const bigOrgs: CollectionConfig = {
    slug: "big_orgs",
    table: "big_orgs",
    name: "Big orgs",
    properties: { id: { name: "ID", type: "number", isId: true, columnType: "bigint" } }
};
const serialOrgs: CollectionConfig = {
    slug: "serial_orgs",
    table: "serial_orgs",
    name: "Serial orgs",
    properties: { id: { name: "ID", type: "number", isId: true, columnType: "bigserial" } }
};
const codeOrgs: CollectionConfig = {
    slug: "code_orgs",
    table: "code_orgs",
    name: "Code orgs",
    properties: {
        code: { name: "Code", type: "string", isId: true, columnType: "varchar", validation: { max: 12 } }
    }
};
const members: CollectionConfig = {
    slug: "members",
    table: "members",
    name: "Members",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        org: { name: "Org", type: "relation", relation: { kind: "belongsTo", target: () => uuidOrgs } },
        bigOrg: { name: "Big org", type: "relation", relation: { kind: "belongsTo", target: () => bigOrgs } },
        serialOrg: { name: "Serial org", type: "reference", path: "serial_orgs" },
        codeOrg: { name: "Code org", type: "relation", relation: { kind: "belongsTo", target: () => codeOrgs } },
        orgs: { name: "Orgs", type: "relation", relation: { kind: "manyToMany", target: () => uuidOrgs } }
    }
};

const emptyDb = (): ExistingSchema => ({ tables: new Map(), enums: new Set(), constraints: new Set() });

const column = (plan: SchemaPlan, table: string, name: string): ColumnPlan => {
    const found = plan.tables.find(t => t.table === table)?.columns.find(c => c.column === name);
    if (!found) throw new Error(`no column ${table}.${name} in the plan`);
    return found;
};

const asQueryable = (db: PGlite) => ({
    query: <R,>(text: string, values?: unknown[]) =>
        db.query<R>(text, values as unknown[]) as Promise<{ rows: R[] }>
});

/** The RLS helpers the default policies call; the auth boot creates them in a real database. */
const bootstrapRls = async (db: PGlite): Promise<void> => {
    await db.exec(
        "CREATE SCHEMA IF NOT EXISTS rebase;" +
        "CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;" +
        "CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text LANGUAGE sql STABLE AS $$ SELECT ''::text $$;"
    );
};

/** `table.constraint -> referenced column` for every foreign key in `public`. */
const liveForeignKeys = async (db: PGlite): Promise<Map<string, string>> => {
    const { rows } = await db.query<{ tbl: string; name: string; target: string }>(
        `SELECT c.conrelid::regclass::text AS tbl, c.conname AS name, a.attname AS target
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = c.confkey[1]
         WHERE c.contype = 'f'`
    );
    return new Map(rows.map(r => [`${r.tbl}.${r.name}`, r.target]));
};

describe("a foreign key references the target's primary-key column", () => {
    const plan = planSchema([authors, tags, posts]);

    it("names the column, not the property key, on every kind of link", () => {
        expect(column(plan, "posts", "author_id").foreignKey?.targetColumn).toBe("author_id");
        expect(column(plan, "posts", "editor").foreignKey?.targetColumn).toBe("author_id");
        expect(column(plan, "posts_tags", "post_id").foreignKey?.targetColumn).toBe("post_id");
        expect(column(plan, "posts_tags", "tag_id").foreignKey?.targetColumn).toBe("tag_id");
    });

    it("writes the column into schema.sql", () => {
        const ddl = renderPostgresDdl(plan);
        expect(ddl).toContain('FOREIGN KEY ("author_id") REFERENCES "public"."authors" ("author_id")');
        expect(ddl).toContain('FOREIGN KEY ("editor") REFERENCES "public"."authors" ("author_id")');
        expect(ddl).toContain('FOREIGN KEY ("post_id") REFERENCES "public"."posts" ("post_id")');
        expect(ddl).toContain('FOREIGN KEY ("tag_id") REFERENCES "public"."tags" ("tag_id")');
        expect(ddl).not.toMatch(/REFERENCES "public"\."\w+" \("(authorId|postId|tagId)"\)/);
    });

    it("still references the property key in schema.generated.ts, where the table is keyed by it", () => {
        const drizzle = renderDrizzleSchema(plan);
        expect(drizzle).toContain("(): AnyPgColumn => authors.authorId");
        expect(drizzle).toContain("(): AnyPgColumn => posts.postId");
        expect(drizzle).toContain("(): AnyPgColumn => tags.tagId");
    });

    it("applies: schema.sql creates every constraint on a fresh database", async () => {
        const db = new PGlite();
        try {
            await bootstrapRls(db);
            await db.exec(renderPostgresDdl(plan));
            const fks = await liveForeignKeys(db);
            expect(fks.get("posts.posts_author_id_fkey")).toBe("author_id");
            expect(fks.get("posts.posts_editor_fkey")).toBe("author_id");
            expect(fks.get("posts_tags.posts_tags_tag_id_fkey")).toBe("tag_id");
        } finally {
            await db.close();
        }
    }, 30_000);

    it("applies: boot creates every constraint, with no failure recorded", async () => {
        const db = new PGlite();
        try {
            const outcome = await ensureCollectionTables(asQueryable(db), [authors, tags, posts]);
            expect(outcome.failures).toEqual([]);
            const fks = await liveForeignKeys(db);
            expect(fks.get("posts.posts_author_id_fkey")).toBe("author_id");
            expect(fks.get("posts.posts_editor_fkey")).toBe("author_id");
            expect(fks.get("posts_tags.posts_tags_post_id_fkey")).toBe("post_id");
            expect(fks.get("posts_tags.posts_tags_tag_id_fkey")).toBe("tag_id");
        } finally {
            await db.close();
        }
    }, 30_000);

    it("creates the constraints an older boot failed to add, on the next boot", async () => {
        // The state an older release left behind: every table and column is
        // there, and every foreign key is missing, because each `ADD
        // CONSTRAINT` failed with 42703 and a failed constraint is survivable.
        const db = new PGlite();
        try {
            const aged = planCollectionSchemaEnsure([authors, tags, posts], emptyDb());
            for (const action of aged.actions) {
                if (action.kind !== "add-constraint") await db.exec(action.sql);
            }
            expect((await liveForeignKeys(db)).size).toBe(0);

            const existing = await readExistingSchema(asQueryable(db), ["public"]);
            const next = planCollectionSchemaEnsure([authors, tags, posts], existing);
            expect(next.actions.filter(a => a.kind === "add-constraint").map(a => a.target).sort()).toEqual([
                "public.posts.posts_author_id_fkey",
                "public.posts.posts_editor_fkey",
                "public.posts_tags.posts_tags_post_id_fkey",
                "public.posts_tags.posts_tags_tag_id_fkey"
            ]);

            const outcome = await ensureCollectionTables(asQueryable(db), [authors, tags, posts]);
            expect(outcome.failures).toEqual([]);
            expect((await liveForeignKeys(db)).size).toBe(4);
        } finally {
            await db.close();
        }
    }, 30_000);
});

describe("a column pointing at a key has the key's own type", () => {
    const plan = planSchema([uuidOrgs, bigOrgs, serialOrgs, codeOrgs, members]);

    it("follows `columnType`, not only the id strategy", () => {
        expect(column(plan, "members", "org_id").type).toEqual({ kind: "uuid" });
        expect(column(plan, "members", "big_org_id").type).toEqual({ kind: "bigint" });
        expect(column(plan, "members", "code_org_id").type).toEqual({ kind: "varchar", length: 12 });
        expect(column(plan, "members_orgs", "org_id").type).toEqual({ kind: "uuid" });
    });

    it("points at a serial key with the plain integer of the same width, not a second sequence", () => {
        expect(column(plan, "serial_orgs", "id").type).toEqual({ kind: "bigserial" });
        expect(column(plan, "members", "serial_org").type).toEqual({ kind: "bigint" });
    });

    it("keeps an identity key's INTEGER, whatever its `columnType` says", () => {
        const counters: CollectionConfig = {
            slug: "counters",
            table: "counters",
            name: "Counters",
            properties: { id: { name: "ID", type: "number", isId: "increment", columnType: "bigint" } }
        };
        const hits: CollectionConfig = {
            slug: "hits",
            table: "hits",
            name: "Hits",
            properties: {
                counter: { name: "Counter", type: "relation", relation: { kind: "belongsTo", target: () => counters } }
            }
        };
        const identityPlan = planSchema([counters, hits]);
        expect(column(identityPlan, "counters", "id").type).toEqual({ kind: "integer" });
        expect(column(identityPlan, "hits", "counter_id").type).toEqual({ kind: "integer" });
    });

    it("applies: boot creates every constraint, with no failure recorded", async () => {
        const db = new PGlite();
        try {
            const outcome = await ensureCollectionTables(
                asQueryable(db), [uuidOrgs, bigOrgs, serialOrgs, codeOrgs, members]);
            expect(outcome.failures).toEqual([]);
            const fks = await liveForeignKeys(db);
            expect(fks.get("members.members_org_id_fkey")).toBe("id");
            expect(fks.get("members.members_big_org_id_fkey")).toBe("id");
            expect(fks.get("members.members_serial_org_fkey")).toBe("id");
            expect(fks.get("members.members_code_org_id_fkey")).toBe("code");
            expect(fks.get("members_orgs.members_orgs_org_id_fkey")).toBe("id");
        } finally {
            await db.close();
        }
    }, 30_000);

    it("applies: schema.sql creates every constraint on a fresh database", async () => {
        const db = new PGlite();
        try {
            await bootstrapRls(db);
            await db.exec(renderPostgresDdl(plan));
            expect((await liveForeignKeys(db)).size).toBe(6);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("reports a linking column an older release created with the wrong type, rather than altering it", async () => {
        // An older boot created `org_id` as TEXT and then failed its foreign key
        // (42804). Boot never changes an existing column's type, so the
        // constraint still cannot be added — but it is said, with the statement
        // that fixes it, instead of failing the same way on every boot.
        const seats: CollectionConfig = {
            slug: "seats",
            table: "seats",
            name: "Seats",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                org: { name: "Org", type: "relation", relation: { kind: "belongsTo", target: () => uuidOrgs } },
                orgs: { name: "Orgs", type: "relation", relation: { kind: "manyToMany", target: () => uuidOrgs } }
            }
        };
        const db = new PGlite();
        try {
            await db.exec(
                'CREATE TABLE "public"."orgs" ("id" UUID PRIMARY KEY);' +
                'CREATE TABLE "public"."seats" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "org_id" TEXT);' +
                'CREATE TABLE "public"."orgs_seats" ("seat_id" UUID NOT NULL, "org_id" TEXT NOT NULL, ' +
                'PRIMARY KEY ("seat_id", "org_id"));'
            );
            const existing = await readExistingSchema(asQueryable(db), ["public"]);
            const next = planCollectionSchemaEnsure([uuidOrgs, seats], existing);
            expect(next.columnTypeDrift).toEqual([
                { table: "public.orgs_seats", column: "org_id", declared: "UUID", actual: "text" },
                { table: "public.seats", column: "org_id", declared: "UUID", actual: "text" }
            ]);
            expect(next.actions.filter(a => a.kind === "add-column" && a.target.endsWith(".org_id"))).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);
});
