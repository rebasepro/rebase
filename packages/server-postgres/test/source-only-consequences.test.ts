/**
 * "Edit source only" says what it leaves behind, change by change, and is
 * committed under a message that names it.
 *
 * The dialog offered it for every refusal with one sentence — "The column
 * stays, holding whatever is in it, and nothing serves it" — which is wrong for
 * most of them: a type change leaves a column still served with the old type, a
 * required property on a populated table arrives nullable at the next boot, a
 * renamed column leaves the data behind and every row reading blank. And the
 * one case that breaks the project went unsaid: removing a NOT NULL column with
 * no default (`products.sku`, 2026-09-08) makes every later insert fail with
 * 23502. The write was not committed either, so the next apply on any
 * collection met it as somebody else's work — 409, forever.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { classifyCollectionChanges, type SchemaFacts } from "../src/schema/classify-change";
import { generateSchemaCommit } from "../src/schema/generate-schema-commit";

const products = (properties: Record<string, unknown>): CollectionConfig => ({
    slug: "products",
    name: "Products",
    table: "products",
    properties: { id: { type: "string", name: "Id", isId: "uuid" }, ...properties }
}) as unknown as CollectionConfig;

const str = (over: Record<string, unknown> = {}) => ({ type: "string", name: "S", ...over });

const facts = (notNull: string[] = [], defaults: string[] = []): SchemaFacts & { columnDefaults: Set<string> } => ({
    tables: new Map([["public.products", new Set(["id", "title", "sku"])]]),
    populatedTables: new Set(["public.products"]),
    notNullColumns: new Set(notNull.map(c => `public.products.${c}`)),
    columnDefaults: new Set(defaults.map(c => `public.products.${c}`)),
    enumValues: new Map()
});

const blocking = (before: CollectionConfig, after: CollectionConfig, f?: SchemaFacts) =>
    classifyCollectionChanges([before], [after], f).changes.filter(c => c.verdict !== "safe");

describe("what an Edit source only leaves behind", () => {
    it("warns that a NOT NULL column with no default makes every insert fail", () => {
        const [change] = blocking(
            products({ title: str(), sku: str({ validation: { required: true } }) }),
            products({ title: str() }),
            facts(["sku"])
        );
        expect(change.sourceOnly).toMatch(/every insert/);
        expect(change.sourceOnly).toMatch(/DROP NOT NULL/);
    });

    it("says only that the column stays when it can take a missing value", () => {
        const [change] = blocking(
            products({ title: str(), sku: str() }),
            products({ title: str() }),
            facts()
        );
        expect(change.sourceOnly).toMatch(/stays/);
        expect(change.sourceOnly).not.toMatch(/every insert/);
    });

    it("says a type change leaves the column with its old type", () => {
        const [change] = blocking(
            products({ sku: str() }),
            products({ sku: { type: "number", name: "N" } }),
            facts()
        );
        expect(change.sourceOnly).toMatch(/TEXT/);
    });

    it("says a required property on a populated table arrives nullable", () => {
        const [change] = blocking(products({ title: str() }), products({ title: str(), code: str({ validation: { required: true } }) }), facts());
        expect(change.sourceOnly).toMatch(/nullable/);
    });

    it("says a renamed column leaves the data behind", () => {
        const [change] = blocking(products({ title: str() }), products({ title: str({ columnName: "headline" }) }), facts());
        expect(change.sourceOnly).toMatch(/"title"/);
        expect(change.sourceOnly).toMatch(/empty/);
    });

    it("is not offered for a proposal the planner refuses — the project would not start", () => {
        const changes = classifyCollectionChanges(
            [products({ code: str() })],
            [products({ code: str({ isId: true }) })]
        ).changes.filter(c => c.kind === "invalid-collection");
        expect(changes).toHaveLength(1);
        expect(changes[0].sourceOnly).toBeUndefined();
    });
});

describe("a source-only commit", () => {
    it("is planned without statements, and named for what it leaves in the database", async () => {
        const commit = await generateSchemaCommit({
            before: [products({ title: str(), sku: str() })],
            after: [products({ title: str() })],
            existing: { ...facts(), enums: new Set() },
            sourceOnly: true
        });
        expect(commit.statements).toEqual([]);
        expect(commit.classified.applicable).toBe(false);
        expect(commit.files.map(f => f.path)).toContain("backend/src/schema.generated.ts");
        expect(commit.message.split("\n")[0])
            .toBe("chore(schema): remove sku from products (source only — column products.sku kept)");
    });

    it("still refuses a normal plan of the same change", async () => {
        await expect(generateSchemaCommit({
            before: [products({ title: str(), sku: str() })],
            after: [products({ title: str() })]
        })).rejects.toThrow(/cannot be applied/);
    });
});
