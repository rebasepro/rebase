/**
 * Classifying a collection change against what the ensure path can do.
 *
 * The weight here is on the ways this could wrongly say `safe`, because a
 * wrong `safe` is an editor that applies a change and reports success while
 * leaving a database that does not match its own configuration. A wrong
 * `needs-migration` only annoys somebody.
 *
 * ## What the facts change
 *
 * Three of these verdicts are not properties of the collections at all — they
 * are properties of the database the change is aimed at. Whether a NOT NULL can
 * be added is a question about rows; whether an enum value will land is a
 * question about the type. Passing `SchemaFacts` is what lets the classifier
 * answer them, and the pairs of tests below — one with the facts, one without —
 * are there to keep the no-facts answer conservative. A caller that cannot see
 * the database has to be told the change *might* diverge, because for all it
 * knows it will.
 */
import type { CollectionConfig } from "@rebasepro/types";
import {
    classifyCollectionChanges,
    summarizeChanges,
    type ChangeVerdict,
    type SchemaFacts
} from "../src/schema/classify-change";

const collection = (slug: string, properties: Record<string, unknown>): CollectionConfig =>
    ({
        slug,
        name: slug,
        properties: {
            id: { type: "string", name: "Id", isId: true },
            ...properties
        }
    }) as unknown as CollectionConfig;

const str = (over: Record<string, unknown> = {}) => ({ type: "string", name: "S", ...over });

/**
 * A database holding one table, `public.posts`, described the way the live
 * editor describes one. `rows` is the fact almost everything below turns on.
 */
const database = (options: {
    rows?: boolean;
    columns?: string[];
    notNull?: string[];
    enums?: Record<string, string[]>;
} = {}): SchemaFacts => ({
    tables: new Map([["public.posts", new Set(options.columns ?? ["id", "title", "status"])]]),
    populatedTables: new Set(options.rows ? ["public.posts"] : []),
    notNullColumns: new Set((options.notNull ?? []).map(column => `public.posts.${column}`)),
    enumValues: new Map(Object.entries(options.enums ?? {}))
});

/** The single change a one-change diff produced. */
const only = (before: CollectionConfig[], after: CollectionConfig[], facts?: SchemaFacts) => {
    const result = classifyCollectionChanges(before, after, facts);
    expect(result.changes).toHaveLength(1);
    return result.changes[0];
};

const verdictOf = (before: CollectionConfig[], after: CollectionConfig[]): ChangeVerdict =>
    classifyCollectionChanges(before, after).verdict;

describe("no change", () => {
    it("is safe and applicable", () => {
        const c = [collection("posts", { title: str() })];
        const result = classifyCollectionChanges(c, c);
        expect(result.changes).toEqual([]);
        expect(result.verdict).toBe("safe");
        expect(result.applicable).toBe(true);
    });

    it("does not care about the order of the collections", () => {
        const a = [collection("posts", {}), collection("tags", {})];
        const b = [collection("tags", {}), collection("posts", {})];
        expect(classifyCollectionChanges(a, b).changes).toEqual([]);
    });
});

describe("safe — what the ensure path expresses exactly", () => {
    it("a new collection", () => {
        const change = only([], [collection("posts", { title: str() })]);
        expect(change).toMatchObject({ kind: "add-collection", verdict: "safe", collection: "posts" });
    });

    it("a new optional property on an existing collection", () => {
        const change = only(
            [collection("posts", {})],
            [collection("posts", { subtitle: str() })]
        );
        expect(change).toMatchObject({ kind: "add-property", verdict: "safe", property: "subtitle" });
    });

    it("a required property on a *new* collection, because a fresh table takes its constraints", () => {
        // The whole collection is new, so there is no add-property change at
        // all — the table is created with its constraints intact.
        const result = classifyCollectionChanges(
            [],
            [collection("posts", { title: str({ validation: { required: true } }) })]
        );
        expect(result.changes.map(c => c.kind)).toEqual(["add-collection"]);
        expect(result.applicable).toBe(true);
    });
});

describe("diverges — applied in part, and nothing says so", () => {
    it("a required property added to an existing collection arrives nullable", () => {
        const change = only(
            [collection("posts", {})],
            [collection("posts", { subtitle: str({ validation: { required: true } }) })]
        );
        expect(change).toMatchObject({ kind: "add-property", verdict: "diverges" });
        expect(change.detail).toContain("NOT NULL");
        expect(change.remedy).toContain("backfill");
    });

    it("making an existing property required does not add the constraint", () => {
        const change = only(
            [collection("posts", { title: str() })],
            [collection("posts", { title: str({ validation: { required: true } }) })]
        );
        expect(change).toMatchObject({ kind: "change-required", verdict: "diverges" });
        expect(change.detail).toContain("keep accepting nulls");
    });

    it("tightening a required property on a table that holds rows", () => {
        const change = only(
            [collection("posts", { title: str() })],
            [collection("posts", { title: str({ validation: { required: true } }) })],
            database({ rows: true })
        );
        expect(change).toMatchObject({ kind: "change-required", verdict: "diverges" });
        expect(change.remedy).toContain("Backfill");
    });

    it("a new enum value, when the type's current values are not known", () => {
        // No facts: the type may or may not already carry the value, and an
        // editor that guessed would be guessing about whether writes will fail.
        const change = only(
            [collection("posts", { status: str({ enum: ["draft", "live"] }) })],
            [collection("posts", { status: str({ enum: ["draft", "live", "archived"] }) })]
        );
        expect(change).toMatchObject({ kind: "add-enum-value", verdict: "diverges" });
        expect(change.detail).toContain("archived");
    });
});

describe("safe once the database is in view", () => {
    it("relaxing a required property drops the constraint", () => {
        const change = only(
            [collection("posts", { title: str({ validation: { required: true } }) })],
            [collection("posts", { title: str() })],
            database({ rows: true, notNull: ["title"] })
        );
        // Loosening cannot fail and cannot lose data, so rows are irrelevant.
        expect(change).toMatchObject({ kind: "change-required", verdict: "safe" });
        expect(change.detail).toContain("drops NOT NULL");
    });

    it("a new enum value lands, once the type's values are in view", () => {
        const change = only(
            [collection("posts", { status: str({ enum: ["draft", "live"] }) })],
            [collection("posts", { status: str({ enum: ["draft", "live", "archived"] }) })],
            database({ enums: { "public.posts_status": ["draft", "live"] } })
        );
        expect(change).toMatchObject({ kind: "add-enum-value", verdict: "safe" });
        expect(change.detail).toContain("archived");
    });

    it("a required property added to an empty table arrives NOT NULL", () => {
        const change = only(
            [collection("posts", {})],
            [collection("posts", { body: str({ validation: { required: true } }) })],
            database({ rows: false })
        );
        expect(change).toMatchObject({ kind: "add-property", verdict: "safe" });
        expect(change.detail).toContain("NOT NULL");
    });

    it("the same property on a populated table does not", () => {
        const change = only(
            [collection("posts", {})],
            [collection("posts", { body: str({ validation: { required: true } }) })],
            database({ rows: true })
        );
        expect(change).toMatchObject({ kind: "add-property", verdict: "diverges" });
        expect(change.remedy).toContain("backfill");
    });

    it("tightening on an empty table sets the constraint", () => {
        const change = only(
            [collection("posts", { title: str() })],
            [collection("posts", { title: str({ validation: { required: true } }) })],
            database({ rows: false })
        );
        expect(change).toMatchObject({ kind: "change-required", verdict: "safe" });
        expect(change.detail).toContain("NOT NULL");
    });

    it("is not applicable, so an editor cannot apply it unattended", () => {
        expect(classifyCollectionChanges(
            [collection("posts", {})],
            [collection("posts", { x: str({ validation: { required: true } }) })]
        ).applicable).toBe(false);
    });
});

describe("needs-migration — the ensure path cannot express it at all", () => {
    it("removing a collection", () => {
        const change = only([collection("posts", {})], []);
        expect(change).toMatchObject({ kind: "remove-collection", verdict: "needs-migration" });
        expect(change.detail).toContain("everything in it");
    });

    it("removing a property", () => {
        const change = only(
            [collection("posts", { subtitle: str() })],
            [collection("posts", {})]
        );
        expect(change).toMatchObject({ kind: "remove-property", verdict: "needs-migration" });
    });

    it("changing a property's type", () => {
        const change = only(
            [collection("posts", { views: str() })],
            [collection("posts", { views: { type: "number", name: "V" } })]
        );
        expect(change).toMatchObject({ kind: "change-property-type", verdict: "needs-migration" });
        expect(change.detail).toContain("string to number");
    });

    it("narrowing a string's declared maximum, which changes the column width", () => {
        const change = only(
            [collection("posts", { title: str({ validation: { max: 500 } }) })],
            [collection("posts", { title: str({ validation: { max: 50 } }) })]
        );
        expect(change.kind).toBe("change-property-type");
    });

    it("changing a vector's dimensions", () => {
        const change = only(
            [collection("docs", { embedding: { type: "vector", name: "E", dimensions: 1536 } })],
            [collection("docs", { embedding: { type: "vector", name: "E", dimensions: 768 } })]
        );
        expect(change.kind).toBe("change-property-type");
    });

    it("renaming the underlying column", () => {
        const change = only(
            [collection("posts", { title: str() })],
            [collection("posts", { title: str({ columnName: "headline" }) })]
        );
        expect(change).toMatchObject({ kind: "rename-column", verdict: "needs-migration" });
        expect(change.detail).toContain("headline");
        expect(change.remedy).toContain("created");
    });

    it("changing the primary key", () => {
        const change = only(
            [collection("posts", { code: str() })],
            [collection("posts", { code: str({ isId: true }) })]
        );
        expect(change).toMatchObject({ kind: "change-primary-key", verdict: "needs-migration" });
    });

    it("removing an enum value, which Postgres cannot do at all", () => {
        const change = only(
            [collection("posts", { status: str({ enum: ["draft", "live"] }) })],
            [collection("posts", { status: str({ enum: ["draft"] }) })]
        );
        expect(change).toMatchObject({ kind: "remove-enum-value", verdict: "needs-migration" });
        expect(change.remedy).toContain("Recreate the type");
    });
});

describe("the overall verdict is the worst one present", () => {
    it("one blocked change condemns an otherwise safe batch", () => {
        const before = [collection("posts", { old: str() })];
        const after = [collection("posts", { fresh: str() }), collection("tags", {})];
        // add-property (safe) + add-collection (safe) + remove-property (blocked)
        const result = classifyCollectionChanges(before, after);
        expect(result.changes.map(c => c.verdict).sort()).toEqual(["needs-migration", "safe", "safe"]);
        expect(result.verdict).toBe("needs-migration");
        expect(result.applicable).toBe(false);
    });

    it("diverges outranks safe but not needs-migration", () => {
        expect(verdictOf(
            [collection("posts", {})],
            [collection("posts", { a: str(), b: str({ validation: { required: true } }) })]
        )).toBe("diverges");
    });

    it("an empty diff is safe", () => {
        expect(verdictOf([], [])).toBe("safe");
    });
});

describe("summarizeChanges", () => {
    it("says nothing changed", () => {
        expect(summarizeChanges(classifyCollectionChanges([], []))).toBe("No schema changes.");
    });

    it("counts by verdict, worst first", () => {
        const before = [collection("posts", { gone: str() })];
        const after = [collection("posts", { added: str() })];
        const summary = summarizeChanges(classifyCollectionChanges(before, after));
        expect(summary).toContain("2 change(s)");
        expect(summary.indexOf("needs-migration")).toBeLessThan(summary.indexOf("safe"));
    });
});
