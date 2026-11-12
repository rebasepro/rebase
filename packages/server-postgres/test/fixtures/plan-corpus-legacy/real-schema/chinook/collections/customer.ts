// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import employeeCollection from "./employee";
import invoiceCollection from "./invoice";

const customerCollection = defineCollection({
    name: "Customer",
    singularName: "Customer",
    slug: "customer",
    table: "customer",
    properties: {
        customerId: {
            name: "Customer Id",
            columnName: "customer_id",
            type: "number",
            isId: "manual",
            columnType: "integer",
        },
        firstName: {
            name: "First Name",
            columnName: "first_name",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 40
            },
        },
        lastName: {
            name: "Last Name",
            columnName: "last_name",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 20
            },
        },
        email: {
            name: "Email",
            columnName: "email",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 60
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
        state: {
            name: "State",
            columnName: "state",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
            },
        },
        company: {
            name: "Company",
            columnName: "company",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 80
            },
        },
        address: {
            name: "Address",
            columnName: "address",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 70
            },
        },
        city: {
            name: "City",
            columnName: "city",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
            },
        },
        country: {
            name: "Country",
            columnName: "country",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
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
        fax: {
            name: "Fax",
            columnName: "fax",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 24
            },
        },
        supportRep: {
            name: "SupportRep",
            type: "relation",
            // mapped from foreign key: support_rep_id -> employee(employee_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => employeeCollection,
                localKey: "support_rep_id",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "invoice",
            target: (): AnyCollectionConfig => invoiceCollection,
            // the invoice.customer_id FK points back here
            foreignKeyOnTarget: "customer_id"
        },
    ],
    admin: {
        icon: "Users",
        display: { title: "firstName" },
        listProperties: [
            "customerId",
            "firstName",
            "lastName",
            "email",
            "phone",
            "state"
        ],
        propertiesOrder: [
            "customerId",
            "firstName",
            "lastName",
            "email",
            "phone",
            "state",
            "company",
            "address",
            "city",
            "country",
            "postalCode",
            "fax",
            "supportRep"
        ]
    }
});

export default customerCollection;
