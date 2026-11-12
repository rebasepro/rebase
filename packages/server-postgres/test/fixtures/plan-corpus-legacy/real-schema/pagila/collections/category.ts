// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// Introspected as a lookup: a 16-row code list: referenced by 1 table(s), references none, 3 or fewer simple columns.

const categoryCollection = defineCollection({
    name: "Category",
    singularName: "Category",
    slug: "category",
    table: "category",
    properties: {
        categoryId: {
            name: "Category Id",
            columnName: "category_id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
        lastUpdate: {
            name: "Last Update",
            columnName: "last_update",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
            validation: {
                required: true
            },
        },
    },
    relations: [
        // The many-to-many with film through film_category is declared on
        // film only: declaring it here too would re-key film_category
        // from (film_id, category_id) on the next push.
    ],
    admin: {
        icon: "Tag",
        group: "Reference",
        display: { title: "name" },
        sort: ["lastUpdate", "desc"],
        propertiesOrder: [
            "categoryId",
            "name",
            "lastUpdate"
        ]
    }
});

export default categoryCollection;
