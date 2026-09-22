import { describe, expect, test } from "@jest/globals";
import { Entity } from "@rebasepro/types";
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
    const entities: Entity<{ name: string }>[] = [
        { id: 1, path: "people", values: { name: "Ada" } },
        { id: 2, path: "people", values: { name: "Bob" } }
    ];

    test("merges both kinds of additional field into one record per row", async () => {
        const additional = await resolveAdditionalExportValues({
            entities,
            exportFields: [{ key: "total", builder: ({ entity }) => `total-${entity.id}` }],
            additionalFields: [{ key: "shout", name: "Shout", value: ({ entity }) => `${entity.values.name}!` }],
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
            exportFields: undefined,
            additionalFields: [{ key: "shout", name: "Shout", value: ({ entity }) => `${entity.values.name}!` }],
            context
        })).toEqual([{ shout: "Ada!" }, { shout: "Bob!" }]);

        expect(await resolveAdditionalExportValues({
            entities,
            exportFields: [{ key: "total", builder: async ({ entity }) => `total-${entity.id}` }],
            additionalFields: undefined,
            context
        })).toEqual([{ total: "total-1" }, { total: "total-2" }]);
    });

    test("an additional field with no value contributes no column", async () => {
        expect(await resolveAdditionalExportValues({
            entities,
            exportFields: undefined,
            additionalFields: [{ key: "badge", name: "Badge" }],
            context
        })).toEqual([{}, {}]);
    });
});
