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
import { CollectionConfig } from "@rebasepro/types";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { planCollectionSchemaEnsure, type ExistingSchema } from "../src/schema/ensure-collection-tables";

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

const collections = [posts, authors, tags, users];
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
});
