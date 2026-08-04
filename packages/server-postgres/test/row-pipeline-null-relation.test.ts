/**
 * A null relation must stay null through the REST pipeline.
 *
 * `typeof null === "object"`, so the `!== null` in `toRestRow`'s relation branch
 * is the only thing between an unset relation and `renderTarget(null)` — which
 * spreads to `{}`, an empty object a client reads as "a row with no columns"
 * rather than "no row". Nullable `belongsTo` is the common case (a post with no
 * author yet), so this is not an edge.
 *
 * This assertion used to live in `fetch-service-branches.test.ts`, reaching into
 * `FetchService` with `(service as any).fetchWithDrizzleQuery(...)` — a private
 * method with no callers, which `docs/bug-classes.md` had already recorded as
 * dead. The test was the only thing keeping it alive, and testing a code path
 * nothing runs is worse than not testing it: the guarantee reads as covered
 * while the path that actually serves it is untested. The dead method is gone
 * and the assertion now runs against `toRestRow`, which is what production uses.
 */
import { CollectionConfig } from "@rebasepro/types";
import { toRestRow } from "../src/services/row-pipeline";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const authorsCollection = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: {
        id: { name: "Id", type: "number", isId: true },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

const postsCollection = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { name: "Id", type: "number", isId: true },
        title: { name: "Title", type: "string" },
        author: { name: "Author", type: "relation", relationName: "author" }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => authorsCollection,
            localKey: "author_id"
        }
    ]
} as unknown as CollectionConfig;

function makeRegistry(): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    registry.registerCollection?.(authorsCollection);
    registry.registerCollection?.(postsCollection);
    return registry;
}

describe("toRestRow: a relation that is not set", () => {
    const registry = makeRegistry();

    it("leaves an absent belongsTo null rather than making it {}", () => {
        const rest = toRestRow({ id: 1, title: "Orphan", author: null }, postsCollection, registry);

        expect(rest.author).toBeNull();
        // Stated separately: `toBeNull` would also pass on a value that is
        // null-ish for the wrong reason, and `{}` is the specific wrong answer.
        expect(rest.author).not.toEqual({});
    });

    it("still inlines a relation that is set", () => {
        const rest = toRestRow(
            { id: 2, title: "Attributed", author: { id: 9, name: "Ada" } },
            postsCollection,
            registry
        );

        expect(rest.author).toMatchObject({ id: 9, name: "Ada" });
    });

    it("leaves an undefined relation alone too", () => {
        // Drizzle omits the key entirely when a join finds nothing, which takes
        // a different branch from an explicit null.
        const rest = toRestRow({ id: 3, title: "No key at all" }, postsCollection, registry);

        expect(rest.author).toBeUndefined();
    });
});
