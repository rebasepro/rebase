import { SnapshotCollection } from "@rebasepro/types";

const authorsCollection: SnapshotCollection = {
    name: "Authors",
    singularName: "Author",
    slug: "authors",
    table: "authors",
    icon: "Person",
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
        },
        name: {
            name: "Name",
            type: "string",
            validation: {
                required: true
            }
        },
        email: {
            name: "Email",
            type: "string",
            validation: {
                required: true
            }
        },
        picture: {
            name: "Picture",
            type: "string",
            storage: {
                storagePath: "author_pictures/"
            }
        }
    },
    propertiesOrder: [
        "id",
        "name",
        "email",
        "picture"
    ]
};

export default authorsCollection;
