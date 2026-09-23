/**
 * The generated `schema.generated.ts` pairs both sides of a many-to-many.
 *
 * Drizzle pairs a `many()` with the `one()` on the junction that carries the
 * same `relationName`, and nothing else. The far side of the junction was named
 * by looking for a relation on the target *called the same thing as the owning
 * one* — which `tags.posts` never is — so it fell back to
 * `posts_tags_tag_id`, while `tags` declared `many(postsTags, { relationName:
 * "posts" })`. `db.query.tags.findMany({ with: { posts: true } })` threw "There
 * is not enough information to infer relation". A self-referencing link found
 * itself as its own inverse and emitted two `one()`s named alike, which drizzle
 * refuses outright.
 *
 * The runtime builds these relations from the live catalogue
 * (`config-relations.ts`, `addJunctionSides`) and gets both right; this is the
 * file a project's own code queries through, so it is loaded and queried here
 * rather than read as text.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";
import { renderDrizzleSchema } from "../src/schema/plan/render-drizzle";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";

const PACKAGE_ROOT = path.resolve(__dirname, "..");

interface GeneratedModule {
    tables: Record<string, unknown>;
    relations: Record<string, unknown>;
}

const isGeneratedModule = (value: unknown): value is GeneratedModule =>
    typeof value === "object" && value !== null && "tables" in value && "relations" in value;

/**
 * The generated file, compiled and loaded the way a project's code loads it —
 * inside this package, so `drizzle-orm` resolves to the copy the test uses.
 */
const loadGenerated = (source: string): GeneratedModule => {
    const dir = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".schema-run-"));
    try {
        const file = path.join(dir, "schema.generated.cjs");
        const { outputText } = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
        });
        fs.writeFileSync(file, outputText);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const loaded: unknown = require(file);
        if (!isGeneratedModule(loaded)) throw new Error("the generated file exports no tables/relations");
        return loaded;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

/** A database built from `schema.sql`, queried through the generated file. */
const queryThroughGenerated = async (
    collections: CollectionConfig[],
    run: (db: ReturnType<typeof drizzle>) => Promise<unknown>
): Promise<void> => {
    const plan = planSchema(collections);
    const generated = loadGenerated(renderDrizzleSchema(plan, { policies: false }));
    const client = new PGlite();
    try {
        await client.exec(renderPostgresDdl(plan, { includePolicies: false }));
        const db = drizzle(client, { schema: { ...generated.tables, ...generated.relations } });
        await run(db);
    } finally {
        await client.close();
    }
};

describe("the generated junction relations", () => {
    it("pair both declared sides of a many-to-many", async () => {
        const tags: CollectionConfig = {
            slug: "tags", table: "tags", name: "Tags",
            properties: { id: { name: "ID", type: "string", isId: "uuid" }, name: { name: "Name", type: "string" } }
        };
        const posts: CollectionConfig = {
            slug: "posts", table: "posts", name: "Posts",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
            }
        };
        tags.properties.posts = {
            name: "Posts", type: "relation", relation: { kind: "manyToMany", target: () => posts }
        };

        await queryThroughGenerated([posts, tags], async db => {
            await expect(db.query.posts.findMany({ with: { tags: true } })).resolves.toEqual([]);
            await expect(db.query.tags.findMany({ with: { posts: true } })).resolves.toEqual([]);
        });
    }, 60_000);

    it("pair a many-to-many nobody declares back", async () => {
        const tags: CollectionConfig = {
            slug: "tags", table: "tags", name: "Tags",
            properties: { id: { name: "ID", type: "string", isId: "uuid" } }
        };
        const posts: CollectionConfig = {
            slug: "posts", table: "posts", name: "Posts",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => tags } }
            }
        };

        await queryThroughGenerated([posts, tags], async db => {
            await expect(db.query.posts.findMany({ with: { tags: { with: { tag_id: true } } } })).resolves.toEqual([]);
        });
    }, 60_000);

    it("load for a self-referencing many-to-many", async () => {
        const people: CollectionConfig = {
            slug: "people", table: "people", name: "People",
            properties: { id: { name: "ID", type: "string", isId: "uuid" } }
        };
        people.properties.friends = {
            name: "Friends", type: "relation", relation: { kind: "manyToMany", target: () => people }
        };

        await queryThroughGenerated([people], async db => {
            await expect(db.query.people.findMany({ with: { friends: true } })).resolves.toEqual([]);
        });
    }, 60_000);
});
