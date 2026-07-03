import { SnapshotCollection } from "@rebasepro/types";

const tagsCollection: SnapshotCollection = {
    name: "Tags",
    singularName: "Tag",
    slug: "tags",
    table: "tags",
    icon: "Tag",
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
    }
};

export default tagsCollection;
