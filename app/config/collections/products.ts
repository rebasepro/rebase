import { EntityCollection } from "@rebasepro/types";

const productsCollection: EntityCollection = {
    name: "Products",
    singularName: "Product",
    slug: "products",
    table: "products",
    icon: "Inventory",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "number",
            validation: {
                required: true
            }
        },
        name: {
            name: "Name",
            type: "string",
            validation: {
                required: true
            }
        },
        description: {
            name: "Description",
            type: "string",
            multiline: true
        },
        price: {
            name: "Price",
            type: "number",
            validation: {
                required: true
            }
        },
        stock: {
            name: "Stock",
            type: "number",
            validation: {
                required: true
            }
        },
        category: {
            name: "Category",
            type: "string",
            enum: [
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "pink" },
                { id: "home", label: "Home", color: "orange" }
            ]
        }
    }
};

productsCollection.securityRules = [
    {
        name: "test_policy",
        mode: "permissive",
        operation: "all",
        pgRoles: ["public"],
        using: "true"
    }
];

export default productsCollection;
