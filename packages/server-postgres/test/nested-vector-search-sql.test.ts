import { describe, expect, it } from "@jest/globals";
import { integer, pgTable, serial, varchar, vector } from "drizzle-orm/pg-core";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { FetchService } from "../src/services/FetchService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { recordingDb } from "./helpers/spg-b-recording-db";

/**
 * A nested listing's vector search reaches the SQL, scope and all.
 *
 * `GET /authors/1/posts?vector_search=…` has two narrowings to apply and no
 * route of its own to apply them: the relation scope, and the distance
 * ordering. `fetchCollectionForRest` resolves the nested path and hands both to
 * the same builder the root read uses — but only if the parameter is passed in
 * the first place, which the subcollection route did not do.
 *
 * Forwarding is asserted over HTTP in `packages/server/test/
 * rest-vector-search-nested.test.ts`. What that cannot see is whether the two
 * narrowings survive together once they arrive: a query ordered by distance but
 * unscoped would return another author's posts, and a scoped query ordered by
 * `id DESC` is the silent downgrade with extra steps.
 */

const postsTable = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    authorId: integer("author_id"),
    embedding: vector("embedding", { dimensions: 3 })
});

const authorsCollection: LegacyCollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { type: "number", isId: "increment" },
        posts: { type: "relation" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            target: () => postsCollection,
            foreignKeyOnTarget: "author_id"
        }
    ]
};

const postsCollection: LegacyCollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        embedding: { type: "vector", dimensions: 3 },
        author: { type: "relation" }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => authorsCollection, localKey: "author_id" }
    ]
};

/**
 * A database that records the listing a read composed, and answers `rows`
 * (none by default) — each the row's columns in table order, then its distance.
 */
function vectorDb(rows: unknown[][] = []) {
    const recording = recordingDb(({ text }) => (/^\s*select\b[\s\S]*\sfrom "posts"/i.test(text) ? rows : []));
    const listing = () => {
        const found = recording.statements().find(q => /^\s*select\b[\s\S]*\sfrom "posts"/i.test(q.text));
        if (!found) throw new Error("no listing was issued");
        return found.text;
    };
    const clause = (re: RegExp) => re.exec(listing())?.[1] ?? "";
    return {
        db: recording.db,
        select: () => clause(/^\s*select\s([\s\S]*?)\sfrom\s"posts"/i),
        where: () => clause(/\swhere\s([\s\S]*?)(?:\sorder by\s|\slimit\s|$)/i),
        orderBy: () => clause(/\sorder by\s([\s\S]*?)(?:\slimit\s|$)/i)
    };
}

function registryFor() {
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([authorsCollection, postsCollection]);
    registry.registerPgTable(postsTable, "posts");
    return registry;
}

const vectorSearch = { property: "embedding", vector: [0.1, 0.2, 0.3], threshold: 0.2 };

describe("a nested listing with a vector search", () => {
    it("orders by distance rather than by id", async () => {
        const { db, orderBy } = vectorDb();

        await new FetchService(db, registryFor())
            .fetchCollectionForRest("authors/1/posts", { vectorSearch });

        expect(orderBy()).toContain("<=>");
    });

    it("selects the distance alongside the row, so `_distance` has a value to carry", async () => {
        const { db, select } = vectorDb();

        await new FetchService(db, registryFor())
            .fetchCollectionForRest("authors/1/posts", { vectorSearch });

        expect(select()).toContain("<=>");
    });

    it("keeps the parent scope while it does so", async () => {
        // The failure this guards is not "no rows": it is another author's
        // posts, ordered impeccably by distance.
        const { db, where } = vectorDb();

        await new FetchService(db, registryFor())
            .fetchCollectionForRest("authors/1/posts", { vectorSearch });

        expect(where()).toContain("author_id");
    });

    it("applies the threshold to the rows the scoped read returns", async () => {
        // Not as a WHERE condition: the rows come back closest first, so the
        // ones inside the threshold are the front of the page, cut after the
        // read — a condition would send an iterative index scan past the page
        // looking for more (see `vector-iterative-scan.ts`).
        // id, title, author_id, embedding — then the distance.
        const { db, where } = vectorDb([
            [1, null, 1, null, 0.1],
            [2, null, 1, null, 0.2],
            [3, null, 1, null, 0.35]
        ]);

        const rows = await new FetchService(db, registryFor())
            .fetchCollectionForRest("authors/1/posts", { vectorSearch });

        expect(rows.map(row => row.id)).toEqual([1]);
        expect(where()).toContain("author_id");
        expect(where()).not.toContain(") < ");
    });
});
