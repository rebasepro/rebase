import { defineCollection } from "@rebasepro/cms-types";

const authorsCollection = defineCollection({
    name: "Authors",
    singularName: "Author",
    slug: "authors",
    table: "authors",
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
    admin: {
        icon: "Person",
        propertiesOrder: [
            "id",
            "name",
            "email",
            "picture"
        ]
    }
});

export default authorsCollection;
