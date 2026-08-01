import { resolveDriftCheckName } from "../src/PostgresBootstrapper";
import type { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";

/**
 * Which table the boot-time drift check goes looking for.
 *
 * This is the whole of a bug that ran in production: `usage-daily` declares
 * `table: "usage_daily"`, the adapter had not registered that table, and the
 * check reported the database as missing a table called `usage-daily` — the
 * SLUG. That name does not exist and should never exist, so nobody could find
 * it, and the remediation the caller prints ("run `rebase db push`") would have
 * created it beside the correct one.
 *
 * The distinction that matters: a declared `table` is an answer, and the
 * registry not knowing about it is the very condition being reported. Consulting
 * the registry to decide what to *call* the table meant the name degraded
 * exactly when the message mattered most.
 */
describe("resolveDriftCheckName", () => {
    const base = {
        name: "Daily Usage",
        properties: {}
    };

    const relational = (over: Record<string, unknown>): CollectionConfig =>
        ({ ...base,
...over } as unknown as PostgresCollectionConfig) as unknown as CollectionConfig;

    it("uses the declared table even when the registry has never heard of it", () => {
        // The production case, exactly: nothing registered.
        expect(
            resolveDriftCheckName(relational({ slug: "usage-daily",
table: "usage_daily" }), [])
        ).toBe("usage_daily");
    });

    it("still uses the declared table when the registry knows a table by the slug", () => {
        // A registry entry named after the slug must not outrank an explicit
        // `table`. This is the ordering that produced the wrong name.
        expect(
            resolveDriftCheckName(relational({ slug: "usage-daily",
table: "usage_daily" }), ["usage-daily"])
        ).toBe("usage_daily");
    });

    it("uses the registered name when the collection declares no table", () => {
        expect(
            resolveDriftCheckName(relational({ slug: "posts" }), ["posts"])
        ).toBe("posts");
    });

    it("falls back to the slug when nothing is declared and nothing is registered", () => {
        // The honest last resort: for a collection with no `table`, the slug IS
        // the table name, so reporting it is correct rather than invented.
        expect(
            resolveDriftCheckName(relational({ slug: "posts" }), [])
        ).toBe("posts");
    });

    it("never reports a name that is neither declared nor registered", () => {
        // The invariant the bug violated, stated directly: whatever comes back
        // is either what the author wrote or something the registry actually
        // holds. A name assembled from neither is unfindable by definition.
        //
        // The slug is only one of those things when no `table` is declared —
        // there the slug IS the table name. Once a `table` is declared the slug
        // names nothing, so it must not sit in the acceptable set: that is what
        // the production bug reported, and an acceptable set that always
        // included the slug would have watched it go by.
        const cases: Array<{ col: CollectionConfig; registered: string[] }> = [
            { col: relational({ slug: "usage-daily",
table: "usage_daily" }),
registered: [] },
            { col: relational({ slug: "usage-daily",
table: "usage_daily" }),
registered: ["usage-daily"] },
            { col: relational({ slug: "posts" }),
registered: ["posts"] },
            { col: relational({ slug: "posts" }),
registered: [] }
        ];

        for (const { col, registered } of cases) {
            const resolved = resolveDriftCheckName(col, registered);
            const declared = (col as PostgresCollectionConfig).table;
            const acceptable = declared ? [declared] : [...registered, col.slug];
            expect(acceptable).toContain(resolved);
        }
    });
});
