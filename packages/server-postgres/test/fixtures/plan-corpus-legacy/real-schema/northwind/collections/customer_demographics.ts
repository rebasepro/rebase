// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

const customerDemographicsCollection = defineCollection({
    name: "Customer Demographics",
    singularName: "Customer Demographic",
    slug: "customer_demographics",
    table: "customer_demographics",
    properties: {
        customerTypeId: {
            name: "Customer Type Id",
            columnName: "customer_type_id",
            type: "string",
            validation: {
                max: 5
            },
            isId: "manual",
            columnType: "varchar",
        },
        customerDesc: {
            name: "Customer Desc",
            columnName: "customer_desc",
            type: "string",
            admin: {
                multiline: true
            },
        },
    },
    relations: [
        // The many-to-many with customers through customer_customer_demo is declared on
        // customers only: declaring it here too would re-key customer_customer_demo
        // from (customer_id, customer_type_id) on the next push.
    ],
    admin: {
        icon: "Users",
        propertiesOrder: [
            "customerTypeId",
            "customerDesc"
        ]
    }
});

export default customerDemographicsCollection;
