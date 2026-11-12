// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import productsCollection from "./products";

const suppliersCollection = defineCollection({
    name: "Suppliers",
    singularName: "Supplier",
    slug: "suppliers",
    table: "suppliers",
    properties: {
        supplierId: {
            name: "Supplier Id",
            columnName: "supplier_id",
            type: "number",
            isId: "manual",
        },
        companyName: {
            name: "Company Name",
            columnName: "company_name",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 40
            },
        },
        contactName: {
            name: "Contact Name",
            columnName: "contact_name",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 30
            },
        },
        contactTitle: {
            name: "Contact Title",
            columnName: "contact_title",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 30
            },
        },
        phone: {
            name: "Phone",
            columnName: "phone",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 24
            },
        },
        address: {
            name: "Address",
            columnName: "address",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 60
            },
        },
        city: {
            name: "City",
            columnName: "city",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 15
            },
        },
        region: {
            name: "Region",
            columnName: "region",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 15
            },
        },
        postalCode: {
            name: "Postal Code",
            columnName: "postal_code",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 10
            },
        },
        country: {
            name: "Country",
            columnName: "country",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 15
            },
        },
        fax: {
            name: "Fax",
            columnName: "fax",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 24
            },
        },
        homepage: {
            name: "Homepage",
            columnName: "homepage",
            type: "string",
            admin: {
                multiline: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "products",
            target: (): AnyCollectionConfig => productsCollection,
            // the products.supplier_id FK points back here
            foreignKeyOnTarget: "supplier_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "companyName" },
        listProperties: [
            "supplierId",
            "companyName",
            "contactName",
            "contactTitle",
            "phone",
            "address"
        ],
        propertiesOrder: [
            "supplierId",
            "companyName",
            "contactName",
            "contactTitle",
            "phone",
            "address",
            "city",
            "region",
            "postalCode",
            "country",
            "fax",
            "homepage"
        ]
    }
});

export default suppliersCollection;
