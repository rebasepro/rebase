/**
 * Planning a collection change for MongoDB.
 *
 * The weight here is on what the changes *say*, not on what they do — because
 * on a document database they do nothing. Nothing is created, altered or
 * dropped, and the whole risk is a reader carrying over an intuition from a
 * relational database: assuming a removed property took its data with it.
 */
import type { CollectionConfig } from "@rebasepro/types";

import { classifyMongoChanges, planMongoSchemaChange } from "../src/schema/plan-schema-change";

const collection = (slug: string, properties: Record<string, unknown> = {}): CollectionConfig =>
    ({ slug, name: slug, properties }) as unknown as CollectionConfig;

const str = { type: "string", name: "S" };

describe("what changed, for a document database", () => {
    it("adding a collection creates nothing yet", async () => {
        const [change] = classifyMongoChanges([], [collection("posts")]);
        expect(change).toMatchObject({ kind: "add-collection", verdict: "safe" });
        expect(change.detail).toContain("on the first write");
    });

    it("adding a property does not rewrite existing documents", async () => {
        const [change] = classifyMongoChanges(
            [collection("posts")],
            [collection("posts", { subtitle: str })]
        );
        expect(change).toMatchObject({ kind: "add-property", verdict: "safe" });
        expect(change.detail).toContain("are not");
    });

    it("removing a property keeps the data, and says so", async () => {
        // The one a reader is most likely to get backwards. On Postgres this is
        // refused because it would drop a column; here nothing is dropped, and
        // somebody who assumes otherwise has it exactly inverted.
        const [change] = classifyMongoChanges(
            [collection("posts", { subtitle: str })],
            [collection("posts")]
        );
        expect(change).toMatchObject({ kind: "remove-property", verdict: "safe" });
        expect(change.detail).toContain("keep it");
        expect(change.detail).toContain("nothing is removed from the data");
    });

    it("removing a collection leaves every document in place", async () => {
        const [change] = classifyMongoChanges([collection("posts")], []);
        expect(change).toMatchObject({ kind: "remove-collection", verdict: "safe" });
        expect(change.detail).toContain("left exactly as they are");
    });

    it("reports no change when nothing changed", () => {
        const same = [collection("posts", { title: str })];
        expect(classifyMongoChanges(same, same)).toEqual([]);
    });
});

describe("the plan", () => {
    it("runs nothing, and is always applicable", async () => {
        const plan = await planMongoSchemaChange(
            [collection("posts")],
            [collection("posts", { subtitle: str })]
        );
        // No DDL is the whole point: there is no table to alter, so there is
        // nothing that can be refused.
        expect(plan.statements).toEqual([]);
        expect(plan.classified.applicable).toBe(true);
        expect(plan.classified.verdict).toBe("safe");
    });

    it("even for the changes Postgres refuses outright", async () => {
        const plan = await planMongoSchemaChange(
            [collection("posts", { subtitle: str })],
            []
        );
        expect(plan.classified.applicable).toBe(true);
        expect(plan.statements).toEqual([]);
    });

    it("generates no artifacts of its own", async () => {
        // Postgres commits a Drizzle schema and declarative DDL because a stale
        // one breaks the next deploy. MongoDB has neither, so the collection
        // file the caller supplies is the whole change.
        const plan = await planMongoSchemaChange([], [collection("posts")]);
        expect(plan.files).toEqual([]);
    });

    it("writes a commit message describing the change", async () => {
        const plan = await planMongoSchemaChange(
            [collection("posts")],
            [collection("posts", { subtitle: str })]
        );
        expect(plan.message).toContain("add subtitle to posts");
    });

    it("says so plainly when nothing changed", async () => {
        const same = [collection("posts")];
        expect((await planMongoSchemaChange(same, same)).message).toBe("chore(schema): no change");
    });
});
