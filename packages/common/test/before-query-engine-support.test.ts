import type { CollectionCallbacks, CollectionConfig } from "@rebasepro/types";
import { assertBeforeQueryIsPostgresOnly } from "../src/index";

/**
 * A `beforeQuery` on a collection Postgres does not serve is refused at boot.
 *
 * Only `@rebasepro/server-postgres` compiles the hook into the read. On any
 * other engine it would look configured and narrow nothing, and a row filter
 * that narrows nothing serves every row to everybody. The Postgres planner calls
 * this for a mixed app, so it is tested here, once, rather than through it.
 */
const scoped: CollectionCallbacks = { beforeQuery: () => undefined };

type Engine = "postgres" | "firestore";

/** A collection on `engine` (none means Postgres) carrying `callbacks`. */
function collection(slug: string, { engine, callbacks }: { engine?: Engine; callbacks?: CollectionCallbacks } = {}): CollectionConfig {
    const base = { slug, name: slug, properties: {}, callbacks };
    if (engine === "firestore") return { ...base, engine };
    return { ...base, engine };
}

describe("assertBeforeQueryIsPostgresOnly", () => {
    it.each<Engine>(["firestore"])("refuses a hook on a %s collection, naming it and the engine", engine => {
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
            collection("events", { engine: "firestore", callbacks: { afterRead: ({ row }) => row } })
        ])).not.toThrow();
    });

    it("checks every collection, not only the first", () => {
        expect(() => assertBeforeQueryIsPostgresOnly([
            collection("docs", { callbacks: scoped }),
            collection("events", { engine: "firestore", callbacks: scoped })
        ])).toThrow(/events/);
    });
});
