// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import ordersCollection from "./orders";

// Introspected as a lookup: a 6-row code list: referenced by 1 table(s), references none, 3 or fewer simple columns.

const shippersCollection = defineCollection({
    name: "Shippers",
    singularName: "Shipper",
    slug: "shippers",
    table: "shippers",
    properties: {
        shipperId: {
            name: "Shipper Id",
            columnName: "shipper_id",
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
        phone: {
            name: "Phone",
            columnName: "phone",
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
            // the orders.ship_via FK points back here
            foreignKeyOnTarget: "ship_via"
        },
    ],
    admin: {
        icon: "Database",
        group: "Reference",
        display: { title: "companyName" },
        propertiesOrder: [
            "shipperId",
            "companyName",
            "phone"
        ]
    }
});

export default shippersCollection;
