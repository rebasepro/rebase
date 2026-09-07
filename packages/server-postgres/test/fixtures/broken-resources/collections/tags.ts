import { defineCollection } from "@rebasepro/common";

/** One valid collection, so the only thing wrong is the sibling `resources.ts`. */
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
            type: "string"
        }
    }
});

export default tagsCollection;
