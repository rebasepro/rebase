/**
 * Removing an enum option is a no-op on the database: PostgreSQL has no
 * `ALTER TYPE … DROP VALUE`, Atlas plans nothing, and boot never removes a
 * label. `db push` used to report success silently, so the database went on
 * accepting the removed value. These are the labels the push now names.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import type { Queryable } from "../src/schema/ensure-collection-tables";
import { findKeptEnumLabels, formatKeptEnumLabelsNotice, keptEnumLabels } from "../src/schema/enum-labels-kept";

const people = (labels: string[]) => ({
    slug: "people",
    table: "people",
    name: "People",
    properties: {
        id: { type: "string", isId: "uuid" },
        status: { type: "string", enum: labels.map(id => ({ id, label: id })) }
    }
}) as unknown as CollectionConfig;

describe("enum labels the database keeps after a collection drops them", () => {
    it("finds a label the collection no longer declares, against a real catalogue", async () => {
        const db = new PGlite();
        await db.exec(`CREATE TYPE public.people_status AS ENUM ('new', 'old', 'archived');`);
        const client: Queryable = {
            query: async <T,>(text: string) => ({ rows: (await db.query<T>(text)).rows })
        };
        const kept = await keptEnumLabels(client, [people(["new", "archived"])]);
        expect(kept).toEqual([{ type: "public.people_status", labels: ["old"] }]);
        await db.close();
    });

    it("says nothing when every label is declared, or the type is not there yet", () => {
        expect(findKeptEnumLabels([{ qualified: "public.t_s", labels: ["a", "b"] }], new Map([["public.t_s", ["a", "b"]]]))).toEqual([]);
        expect(findKeptEnumLabels([{ qualified: "public.t_s", labels: ["a"] }], new Map())).toEqual([]);
    });

    it("names the labels and the real way to retire one — not another push", () => {
        const notice = formatKeptEnumLabelsNotice([{ type: "public.people_status", labels: ["old"] }]);
        expect(notice).toContain('public.people_status: "old"');
        expect(notice).toContain("UPDATE");
        expect(notice).toContain("rebase db migrate");
    });
});
