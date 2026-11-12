// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import ordersCollection from "./orders";
import customerDemographicsCollection from "./customer_demographics";

const customersCollection = defineCollection({
    name: "Customers",
    singularName: "Customer",
    slug: "customers",
    table: "customers",
    properties: {
        customerId: {
            name: "Customer Id",
            columnName: "customer_id",
            type: "string",
            validation: {
                max: 5
            },
            isId: "manual",
            columnType: "varchar",
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
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "orders",
            target: (): AnyCollectionConfig => ordersCollection,
            // the orders.customer_id FK points back here
            foreignKeyOnTarget: "customer_id"
        },
        {
            kind: "manyToMany",
            relationName: "customer_demographics",
            target: (): AnyCollectionConfig => customerDemographicsCollection,
            through: {
                table: "customer_customer_demo",
                sourceColumn: "customer_id",
                targetColumn: "customer_type_id"
            }
        },
    ],
    admin: {
        icon: "Users",
        display: { title: "companyName" },
        listProperties: [
            "customerId",
            "companyName",
            "contactName",
            "contactTitle",
            "phone",
            "address"
        ],
        propertiesOrder: [
            "customerId",
            "companyName",
            "contactName",
            "contactTitle",
            "phone",
            "address",
            "city",
            "region",
            "postalCode",
            "country",
            "fax"
        ]
    }
});

export default customersCollection;
