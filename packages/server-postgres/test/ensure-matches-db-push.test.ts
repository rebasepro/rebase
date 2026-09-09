/**
 * Boot-time ensure and `db push` must describe the same database.
 *
 * The two paths exist for different situations — `db push` runs from a checkout
 * against a reachable `DATABASE_URL`, boot-ensure runs inside a managed tenant
 * where nothing else can reach the database — but they compile the *same*
 * collections. If they disagree on a foreign key's name, a junction's column
 * type, or which columns a table has, then a project that was pushed once and
 * booted later ends up with two schemas, and the disagreement surfaces as a
 * constraint that cannot be added or a relation that reads as missing.
 *
 * The relation columns used to be the disagreement: ensure skipped them
 * deliberately, so a managed tenant's table arrived without the FK column its
 * own collection reads. These tests pin the agreement rather than the old
 * omission — they compare what ensure plans against what the generator writes.
 */
import { PGlite } from "@electric-sql/pglite";
import { CollectionConfig } from "@rebasepro/types";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import {
    planCollectionSchemaEnsure,
    readExistingSchema,
    type ExistingSchema
} from "../src/schema/ensure-collection-tables";

const authors: CollectionConfig = {
    slug: "authors",
    table: "authors",
    name: "Authors",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { type: "string", validation: { required: true } }
    }
} as unknown as CollectionConfig;

const tags: CollectionConfig = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { type: "string" }
    }
} as unknown as CollectionConfig;

/**
 * An auth collection, shaped like the scaffold's: it declares a subset of the
 * columns auth actually needs, and spells two of them with a `columnName`.
 * `is_anonymous` and `tokens_valid_after` are deliberately absent here — they
 * are auth's, not the developer's, and both creators must still produce them.
 */
const users: CollectionConfig = {
    slug: "users",
    table: "users",
    schema: "rebase",
    name: "Users",
    auth: { enabled: true },
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        email: { type: "string", validation: { required: true, unique: true } },
        displayName: { type: "string", columnName: "display_name" },
        emailVerified: { type: "boolean", columnName: "email_verified" },
        // A field the developer added. Not auth's, so it is generated from the
        // property like any other column.
        bio: { type: "string" }
    }
} as unknown as CollectionConfig;

const posts: CollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { type: "string" },
        author: {
            type: "relation",
            relation: { kind: "belongsTo", target: () => authors, relationName: "author" }
        },
        tags: {
            type: "relation",
            relation: { kind: "manyToMany", target: () => tags, relationName: "tags" }
        }
    }
} as unknown as CollectionConfig;

/**
 * A REQUIRED link, of both spellings.
 *
 * The fixture above has only optional ones, which is why the parity tests below
 * missed the disagreement they were written to catch: `RelationalColumnPlan`
 * carried the column's type and its constraint but not `required`, so
 * boot-ensure added `author_id` bare while `db push` made it NOT NULL. Four of
 * four required links in the audit's diff were nullable on the managed path —
 * the one with no developer in the loop.
 */
const profiles: CollectionConfig = {
    slug: "profiles",
    table: "profiles",
    name: "Profiles",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        bio: { type: "string" },
        author: {
            type: "relation",
            validation: { required: true },
            relation: { kind: "belongsTo", target: () => authors, relationName: "author" }
        },
        // The other spelling of a foreign key, on the same terms.
        primaryTag: { type: "reference", path: "tags", validation: { required: true } }
    }
} as unknown as CollectionConfig;

const collections = [posts, authors, tags, users, profiles];
const emptyDb = (): ExistingSchema => ({ tables: new Map(), enums: new Set(), constraints: new Set() });

/** Constraint names in the order the generator writes them. */
const constraintNamesIn = (ddl: string): string[] =>
    [...ddl.matchAll(/ADD CONSTRAINT "([^"]+)"/g)].map(m => m[1]).sort();

describe("boot-ensure agrees with db push", () => {
    it("names every foreign key exactly as the generator does", async () => {
        const generated = await generatePostgresDdl(collections);
        const planned = planCollectionSchemaEnsure(collections, emptyDb())
            .actions.filter(a => a.kind === "add-constraint")
            .map(a => a.sql);

        expect(constraintNamesIn(planned.join("\n"))).toEqual(constraintNamesIn(generated));
        // Not just the names — the same target table and column too.
        expect(planned.join("\n")).toMatch(/"posts_author_id_fkey"[\s\S]*REFERENCES "public"\."authors" \("id"\)/);
    });

    it("gives a junction the same key types the generator gives it", async () => {
        const generated = await generatePostgresDdl(collections);
        const junction = planCollectionSchemaEnsure(collections, emptyDb())
            .actions.find(a => a.kind === "create-table" && a.target === "public.posts_tags");

        expect(junction).toBeDefined();
        // posts is a uuid, tags an auto-increment integer; the generator picks
        // UUID and INTEGER, and a junction column must match the key it points at.
        expect(junction!.sql).toMatch(/"post_id" UUID NOT NULL/);
        expect(junction!.sql).toMatch(/"tag_id" INTEGER NOT NULL/);
        expect(generated).toMatch(/"post_id" UUID NOT NULL/);
        expect(generated).toMatch(/"tag_id" INTEGER NOT NULL/);
    });

    it("plans a column for every column the generator declares", async () => {
        const generated = await generatePostgresDdl(collections);
        const plan = planCollectionSchemaEnsure(collections, emptyDb());
        const plannedColumns = new Set(
            plan.actions.filter(a => a.kind === "add-column").map(a => a.target.split(".").pop()!)
        );
        // Junction columns arrive with the CREATE TABLE rather than as additions.
        for (const column of ["post_id", "tag_id"]) plannedColumns.add(column);

        // Every non-id column the generator writes, ensure must also plan —
        // otherwise a managed tenant serves a table the project cannot write.
        const generatedColumns = [...generated.matchAll(/^\s+"([a-z_]+)"\s+[A-Z]/gm)].map(m => m[1]);
        const missing = generatedColumns.filter(c => c !== "id" && !plannedColumns.has(c));
        expect(missing).toEqual([]);
    });

    // ── The comparison the three tests above do not make ────────────────────
    //
    // They check that both paths mention the same columns and name constraints
    // the same way. Neither checked what a column IS, and four disagreements
    // lived behind that gap on a released version:
    //
    //   • a numeric id was BIGSERIAL here and INTEGER GENERATED BY DEFAULT AS
    //     IDENTITY there — an int8 vs int4 key for the same project, with every
    //     foreign key pointing at it typed INTEGER on both sides, and
    //     node-postgres handing int8 back as a *string* so `type: "number"`
    //     served `"1"`;
    //   • `validation.required` became NOT NULL only in the generator;
    //   • `validation.unique` became UNIQUE only in the generator;
    //   • on an auth collection the two disagreed about `email`'s nullability
    //     and about whether `is_anonymous` exists at all.
    //
    // So this compares the definitions themselves. It is deliberately an exact
    // string comparison: "equivalent enough" is the judgement that let BIGSERIAL
    // and INTEGER coexist.
    describe("column definitions, not just column names", () => {
        /** table → column → definition, parsed out of the generator's DDL. */
        const generatedColumnDefs = (ddl: string): Map<string, Map<string, string>> => {
            const tables = new Map<string, Map<string, string>>();
            const createRe = /CREATE TABLE "([^"]+)"\."([^"]+)" \(\n([\s\S]*?)\n\);/g;
            for (const [, schema, table, body] of ddl.matchAll(createRe)) {
                const columns = new Map<string, string>();
                for (const line of body.split(",\n")) {
                    const match = line.trim().match(/^"([^"]+)"\s+(.+?),?$/);
                    if (!match) continue;               // PRIMARY KEY (...) tail
                    columns.set(match[1], match[2].trim());
                }
                tables.set(`${schema}.${table}`, columns);
            }
            return tables;
        };

        /** The same map, assembled from the ensure plan's statements. */
        const plannedColumnDefs = (
            plan: ReturnType<typeof planCollectionSchemaEnsure>
        ): Map<string, Map<string, string>> => {
            const tables = new Map<string, Map<string, string>>();
            const columnsFor = (key: string) => {
                if (!tables.has(key)) tables.set(key, new Map());
                return tables.get(key)!;
            };
            for (const action of plan.actions) {
                if (action.kind === "create-table") {
                    const body = action.sql.replace(/^[\s\S]*?\(/, "").replace(/\);?\s*$/, "");
                    for (const part of body.split(", ")) {
                        const match = part.trim().match(/^"([^"]+)"\s+(.+)$/);
                        if (!match) continue;           // PRIMARY KEY (...) tail
                        columnsFor(action.target).set(match[1], match[2].trim());
                    }
                } else if (action.kind === "add-column") {
                    const match = action.sql.match(/ADD COLUMN IF NOT EXISTS "([^"]+)" (.+);$/);
                    if (!match) continue;
                    const table = action.target.split(".").slice(0, 2).join(".");
                    columnsFor(table).set(match[1], match[2].trim());
                }
            }
            return tables;
        };

        it("defines every column exactly as db push defines it", async () => {
            const fromPush = generatedColumnDefs(await generatePostgresDdl(collections));
            const fromEnsure = plannedColumnDefs(planCollectionSchemaEnsure(collections, emptyDb()));

            const disagreements: string[] = [];
            for (const [table, pushColumns] of fromPush) {
                const ensureColumns = fromEnsure.get(table);
                expect(ensureColumns).toBeDefined();
                for (const [column, pushDef] of pushColumns) {
                    const ensureDef = ensureColumns!.get(column);
                    if (ensureDef !== pushDef) {
                        disagreements.push(`${table}.${column}: push="${pushDef}" ensure="${ensureDef}"`);
                    }
                }
            }
            expect(disagreements).toEqual([]);
        });

        it("gives a numeric id the same integer type on both paths", async () => {
            const fromPush = generatedColumnDefs(await generatePostgresDdl(collections));
            const fromEnsure = plannedColumnDefs(planCollectionSchemaEnsure(collections, emptyDb()));

            // Named explicitly because the comparison above would also pass if
            // BOTH paths regressed to BIGSERIAL together — and the FK columns
            // that reference this key are INTEGER, so int8 here is a truncation
            // waiting for the sequence to pass 2^31.
            expect(fromPush.get("public.tags")!.get("id")).toBe("INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY");
            expect(fromEnsure.get("public.tags")!.get("id")).toBe("INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY");
        });

        it("carries validation.required and validation.unique onto a new table", async () => {
            const fromEnsure = plannedColumnDefs(planCollectionSchemaEnsure(collections, emptyDb()));
            expect(fromEnsure.get("public.authors")!.get("name")).toBe("TEXT NOT NULL");
        });

        it("makes a required link NOT NULL on both paths, in both spellings", async () => {
            const fromPush = generatedColumnDefs(await generatePostgresDdl(collections));
            const fromEnsure = plannedColumnDefs(planCollectionSchemaEnsure(collections, emptyDb()));

            // Named rather than left to the whole-table comparison above,
            // because this is the class the fixture used not to contain: the
            // plan boot-ensure reads carried no `required`, so the column came
            // out nullable on the managed path and NOT NULL after a push.
            for (const source of [fromPush, fromEnsure]) {
                expect(source.get("public.profiles")!.get("author_id")).toBe("UUID NOT NULL");
                expect(source.get("public.profiles")!.get("primary_tag")).toBe("INTEGER NOT NULL");
            }
            // The optional link on the same table stays nullable, on both.
            expect(fromPush.get("public.posts")!.get("author_id")).toBe("UUID");
            expect(fromEnsure.get("public.posts")!.get("author_id")).toBe("UUID");
        });

        it("withholds NOT NULL on a required link added to a table that already holds rows", () => {
            // The other half of the rule, and the reason it is not simply
            // "always NOT NULL": this module runs unattended against live
            // customer data, and a constraint checked against existing rows can
            // abort the boot. Withheld, and *reported* — the silence was the
            // bug, not the caution.
            const populated: ExistingSchema = {
                tables: new Map([["public.profiles", new Set(["id"])]]),
                enums: new Set(),
                constraints: new Set(),
                populatedTables: new Set(["public.profiles"])
            };
            const plan = planCollectionSchemaEnsure(collections, populated);
            const column = plan.actions.find(a => a.target === "public.profiles.author_id");
            expect(column!.sql).toContain('"author_id" UUID;');
            expect(column!.sql).not.toContain("NOT NULL");
            expect(plan.withheldConstraints.map(w => w.target)).toContain("public.profiles.author_id");
        });

        it("leaves an EXISTING table's added column unconstrained", () => {
            // The other half of the rule: this module runs unattended against
            // live customer data. SET NOT NULL is checked against existing rows
            // and a UNIQUE fails on existing duplicates, so a column added to a
            // table that is already there gets the type and nothing else.
            const withAuthors: ExistingSchema = {
                tables: new Map([["public.authors", new Set(["id"])]]),
                enums: new Set(),
                constraints: new Set()
            };
            const plan = planCollectionSchemaEnsure(collections, withAuthors);
            const name = plan.actions.find(a => a.target === "public.authors.name");
            expect(name!.sql).toContain('"name" TEXT;');
            expect(name!.sql).not.toContain("NOT NULL");
        });

        it("gives an auth table the same shape on both paths, including columns the collection omits", async () => {
            const fromPush = generatedColumnDefs(await generatePostgresDdl(collections));
            const fromEnsure = plannedColumnDefs(planCollectionSchemaEnsure(collections, emptyDb()));

            for (const source of [fromPush, fromEnsure]) {
                const columns = source.get("rebase.users")!;
                // Auth owns these, whatever the collection file says.
                expect(columns.get("email")).toBe("TEXT NOT NULL");
                expect(columns.get("roles")).toBe("TEXT[] DEFAULT '{}' NOT NULL");
                expect(columns.get("email_verified")).toBe("BOOLEAN DEFAULT FALSE NOT NULL");
                // Declared by no collection, needed by auth — and the reason a
                // `db push` after first boot used to plan a DROP.
                expect(columns.get("is_anonymous")).toBe("BOOLEAN DEFAULT FALSE NOT NULL");
                expect(columns.get("tokens_valid_after")).toBe("TIMESTAMP WITH TIME ZONE");
                // The developer's own field stays an ordinary generated column.
                expect(columns.get("bio")).toBe("TEXT");
            }
        });
    });

    // ── A junction that carries its own columns ──────────────────────────────
    //
    // Against a real Postgres, because the claims are about what the database
    // ends up holding: `db push` and boot-ensure both create `org_members` with
    // a `role` that is NOT NULL with a DEFAULT, and boot-ensure adds that same
    // column to a junction that already exists — which is the case a plain
    // `ADD COLUMN <type>` got wrong, dropping the default and then either
    // omitting the NOT NULL or applying it to rows that have no value.
    describe("a `through.properties` junction, applied to a live database", () => {
        const orgs = {
            slug: "orgs", table: "orgs", name: "Orgs",
            properties: { id: { type: "string", isId: "uuid" }, name: { type: "string" } }
        } as unknown as CollectionConfig;

        const withPayload = (properties: Record<string, unknown>): CollectionConfig => ({
            slug: "people", table: "people", name: "People",
            properties: {
                id: { type: "string", isId: "uuid" },
                handle: { type: "string" },
                orgs: {
                    type: "relation",
                    relation: {
                        kind: "manyToMany",
                        target: () => orgs,
                        relationName: "orgs",
                        through: {
                            table: "org_members",
                            sourceColumn: "person_id",
                            targetColumn: "org_id",
                            properties
                        }
                    }
                }
            }
        } as unknown as CollectionConfig);

        const rolePayload = {
            role: {
                type: "string",
                enum: ["owner", "member"],
                defaultValue: "member",
                validation: { required: true }
            }
        };

        /** `<type>[ NOT NULL][ DEFAULT …]` for one column, straight out of the catalogue. */
        const liveColumns = async (db: PGlite, table: string): Promise<Map<string, string>> => {
            const { rows } = await db.query<{
                column_name: string; data_type: string; udt_name: string;
                is_nullable: string; column_default: string | null;
            }>(
                "SELECT column_name, data_type, udt_name, is_nullable, column_default " +
                "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
                [table]
            );
            return new Map(rows.map(r => [
                r.column_name,
                [
                    r.data_type === "USER-DEFINED" ? r.udt_name : r.data_type,
                    r.is_nullable === "NO" ? "NOT NULL" : "",
                    r.column_default ? `DEFAULT ${r.column_default}` : ""
                ].filter(Boolean).join(" ")
            ]));
        };

        /**
         * The RLS helpers the derived policies call. Created by the auth boot
         * step in a real database; stubbed here so a `CREATE POLICY` that names
         * them parses.
         */
        const bootstrapRls = async (db: PGlite): Promise<void> => {
            await db.exec(
                "CREATE SCHEMA IF NOT EXISTS rebase;" +
                "CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;" +
                "CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text LANGUAGE sql STABLE AS $$ SELECT ''::text $$;"
            );
        };

        /** Apply a plan's statements in order, as boot-ensure does. */
        const apply = async (db: PGlite, statements: string[]): Promise<void> => {
            await bootstrapRls(db);
            for (const statement of statements) await db.exec(statement);
        };

        const asQueryable = (db: PGlite) => ({
            query: <R,>(text: string, values?: unknown[]) =>
                db.query<R>(text, values as unknown[]) as Promise<{ rows: R[] }>
        });

        it("ends up with the same columns whichever path created the table", async () => {
            const collections = [orgs, withPayload(rolePayload)];

            const pushed = new PGlite();
            const booted = new PGlite();
            try {
                await bootstrapRls(pushed);
                await pushed.exec(await generatePostgresDdl(collections));
                await apply(booted, planCollectionSchemaEnsure(collections, emptyDb()).statements);

                const fromPush = await liveColumns(pushed, "org_members");
                const fromBoot = await liveColumns(booted, "org_members");

                expect([...fromBoot.keys()].sort()).toEqual([...fromPush.keys()].sort());
                expect(fromBoot.get("role")).toEqual(fromPush.get("role"));
                // Not merely "the same on both paths" — the right thing on both.
                expect(fromPush.get("role")).toContain("NOT NULL");
                expect(fromPush.get("role")).toContain("DEFAULT 'member'");
                expect(fromPush.get("role")).toContain("org_members_role");
            } finally {
                await pushed.close();
                await booted.close();
            }
        });

        it("adds a payload column to a junction that already exists, with its default", async () => {
            const before = [orgs, withPayload({})];
            const after = [orgs, withPayload(rolePayload)];

            const db = new PGlite();
            try {
                // A junction created before the payload was declared, holding a
                // link — so NOT NULL cannot be applied blind.
                await apply(db, planCollectionSchemaEnsure(before, emptyDb()).statements);
                await db.exec(
                    "INSERT INTO public.orgs (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Acme');" +
                    "INSERT INTO public.people (id, handle) VALUES ('22222222-2222-2222-2222-222222222222', 'ada');" +
                    "INSERT INTO public.org_members (person_id, org_id) VALUES " +
                    "('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');"
                );

                const existing = await readExistingSchema(asQueryable(db), ["public", "rebase"]);
                const plan = planCollectionSchemaEnsure(after, existing);
                await apply(db, plan.statements);

                const columns = await liveColumns(db, "org_members");
                // The column arrives WITH its default — that is what makes the
                // NOT NULL safe on a table that already holds a link, and it is
                // what a bare `ADD COLUMN <type>` dropped.
                expect(columns.get("role")).toContain("DEFAULT 'member'");
                expect(columns.get("role")).toContain("NOT NULL");

                // …and the row that predates the column is backfilled by it
                // rather than left holding NULL.
                const { rows } = await db.query<{ role: string }>("SELECT role FROM public.org_members");
                expect(rows).toEqual([{ role: "member" }]);
            } finally {
                await db.close();
            }
        }, 30_000);
    });
});
