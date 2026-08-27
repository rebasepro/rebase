import { defineCollection } from "@rebasepro/cms-types";

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
