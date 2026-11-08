import { describe, expect, test } from "@jest/globals";
import type { CollectionConfig, Entity } from "@rebasepro/types";
import { RebaseContext } from "@rebasepro/cms-types";
import { resolveAdditionalExportValues } from "../../src/data_export/export/additional_fields";
import { getEntityCSVExportableData } from "../../src/data_export/export/export";

/**
 * A collection can add export columns two ways — `exportable.additionalFields`
 * and `additionalFields` with a `value` — and each resolves to one record per
 * row. The two per-row arrays were concatenated rather than merged, so an
 * export of two rows came out as four: the first two with the extra columns of
 * one kind blank, the last two with no id and only the other kind.
 */
describe("resolveAdditionalExportValues", () => {

    const context = {} as RebaseContext;
    const people: CollectionConfig = {
        slug: "people",
        name: "People",
        properties: { name: { type: "string" }, born: { type: "date", columnType: "date" } }
    };
    const entities: Entity<{ id: number; name: string }>[] = [
        { id: 1, path: "people", values: { id: 1, name: "Ada" } },
        { id: 2, path: "people", values: { id: 2, name: "Bob" } }
    ];

    test("merges both kinds of additional field into one record per row", async () => {
        const additional = await resolveAdditionalExportValues({
            entities,
            collection: people,
            exportFields: [{ key: "total", builder: ({ row }) => `total-${row.id}` }],
            additionalFields: [{ key: "shout", name: "Shout", value: ({ row }) => `${row.name}!` }],
            context
        });

        expect(additional).toEqual([
            { total: "total-1", shout: "Ada!" },
            { total: "total-2", shout: "Bob!" }
        ]);

        const headers = ["id", "name", "total", "shout"].map(key => ({ key, label: key }));
        expect(getEntityCSVExportableData(entities, additional, { name: { type: "string" } }, headers, "string"))
            .toEqual([
                [1, "Ada", "total-1", "Ada!"],
                [2, "Bob", "total-2", "Bob!"]
            ]);
    });

    test("with only one kind, one record per row", async () => {
        expect(await resolveAdditionalExportValues({
            entities,
            collection: people,
            exportFields: undefined,
            additionalFields: [{ key: "shout", name: "Shout", value: ({ row }) => `${row.name}!` }],
            context
        })).toEqual([{ shout: "Ada!" }, { shout: "Bob!" }]);

        expect(await resolveAdditionalExportValues({
            entities,
            collection: people,
            exportFields: [{ key: "total", builder: async ({ row }) => `total-${row.id}` }],
            additionalFields: undefined,
            context
        })).toEqual([{ total: "total-1" }, { total: "total-2" }]);
    });

    test("an additional field with no value contributes no column", async () => {
        expect(await resolveAdditionalExportValues({
            entities,
            collection: people,
            exportFields: undefined,
            additionalFields: [{ key: "badge", name: "Badge" }],
            context
        })).toEqual([{}, {}]);
    });

    test("both kinds are handed the row as the server sends it", async () => {
        const seen: Record<string, unknown>[] = [];
        await resolveAdditionalExportValues({
            entities: [{ id: 1, path: "people", values: { id: 1, name: "Ada", born: new Date("1815-12-10T00:00:00.000Z") } }],
            collection: people,
            exportFields: [{ key: "a", builder: ({ row }) => { seen.push(row); return ""; } }],
            additionalFields: [{ key: "b", name: "B", value: ({ row }) => { seen.push(row); return ""; } }],
            context
        });
        expect(seen).toEqual([
            { id: 1, name: "Ada", born: "1815-12-10" },
            { id: 1, name: "Ada", born: "1815-12-10" }
        ]);
    });
});
