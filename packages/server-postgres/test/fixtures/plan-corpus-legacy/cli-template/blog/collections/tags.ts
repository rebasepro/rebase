// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

const tagsCollection = defineCollection({
    name: "Tags",
    singularName: "Tag",
    slug: "tags",
    table: "tags",
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
        },
        name: {
            name: "Tag Name",
            type: "string",
            validation: {
                required: true
            }
        }
    },
    admin: {
        icon: "Tag"
    }
});

export default tagsCollection;
