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
        name: { type: "string" }
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

const collections = [posts, authors, tags];
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
});
