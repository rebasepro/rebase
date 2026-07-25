import type { PostgresCollectionConfig } from "@rebasepro/types";

const tagsCollection: PostgresCollectionConfig = {
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
};

export default tagsCollection;
