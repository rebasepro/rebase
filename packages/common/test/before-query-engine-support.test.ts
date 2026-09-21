import type { CollectionConfig } from "@rebasepro/types";
import { assertBeforeQueryIsPostgresOnly } from "../src/index";

/**
 * A `beforeQuery` on a collection Postgres does not serve is refused at boot.
 *
 * Only `@rebasepro/server-postgres` compiles the hook into the read. On any
 * other engine it would look configured and narrow nothing, and a row filter
 * that narrows nothing serves every row to everybody. Both drivers call this —
 * the Postgres planner for a mixed app, the Mongo bootstrapper for a Mongo-only
 * one — so it is tested here, once, rather than through either.
 */
const scoped = { beforeQuery: () => undefined };

const collection = (slug: string, extra: Record<string, unknown> = {}): CollectionConfig =>
    ({ slug, name: slug, properties: {}, ...extra } as unknown as CollectionConfig);

describe("assertBeforeQueryIsPostgresOnly", () => {
    it.each(["mongodb", "firestore"])("refuses a hook on a %s collection, naming it and the engine", engine => {
        expect(() => assertBeforeQueryIsPostgresOnly([collection("events", { engine, callbacks: scoped })]))
            .toThrow(new RegExp(`events\\.callbacks\\.beforeQuery.*served by \`${engine}\``));
    });

    it("accepts a hook on a collection with no engine, which is Postgres", () => {
        expect(() => assertBeforeQueryIsPostgresOnly([collection("docs", { callbacks: scoped })])).not.toThrow();
    });

    it("accepts a hook on an explicitly Postgres collection", () => {
        expect(() => assertBeforeQueryIsPostgresOnly([collection("docs", { engine: "postgres", callbacks: scoped })]))
            .not.toThrow();
    });

    it("leaves a non-Postgres collection with other callbacks alone", () => {
        // `afterRead` works on every engine; only the hook that narrows a read
        // before it is compiled is engine-bound.
        expect(() => assertBeforeQueryIsPostgresOnly([
            collection("events", { engine: "mongodb", callbacks: { afterRead: ({ row }: { row: unknown }) => row } })
        ])).not.toThrow();
    });

    it("checks every collection, not only the first", () => {
        expect(() => assertBeforeQueryIsPostgresOnly([
            collection("docs", { callbacks: scoped }),
            collection("events", { engine: "mongodb", callbacks: scoped })
        ])).toThrow(/events/);
    });
});
