// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import customerCollection from "./customer";
import invoiceLineCollection from "./invoice_line";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "invoice_date" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const invoiceCollection = defineCollection({
    name: "Invoice",
    singularName: "Invoice",
    slug: "invoice",
    table: "invoice",
    properties: {
        invoiceId: {
            name: "Invoice Id",
            columnName: "invoice_id",
            type: "number",
            isId: "manual",
            columnType: "integer",
        },
        billingAddress: {
            name: "Billing Address",
            columnName: "billing_address",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 70
            },
        },
        billingCity: {
            name: "Billing City",
            columnName: "billing_city",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
            },
        },
        billingState: {
            name: "Billing State",
            columnName: "billing_state",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
            },
        },
        billingCountry: {
            name: "Billing Country",
            columnName: "billing_country",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
            },
        },
        billingPostalCode: {
            name: "Billing Postal Code",
            columnName: "billing_postal_code",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 10
            },
        },
        total: {
            name: "Total",
            columnName: "total",
            type: "number",
            precision: 10,
            scale: 2,
            validation: {
                required: true
            },
        },
        invoiceDate: {
            name: "Invoice Date",
            columnName: "invoice_date",
            type: "date",
            validation: {
                required: true
            },
        },
        customer: {
            name: "Customer",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: customer_id -> customer(customer_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => customerCollection,
                localKey: "customer_id",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "invoice_line",
            target: (): AnyCollectionConfig => invoiceLineCollection,
            // the invoice_line.invoice_id FK points back here
            foreignKeyOnTarget: "invoice_id"
        },
    ],
    admin: {
        icon: "ShoppingCart",
        listProperties: [
            "invoiceId",
            "billingAddress",
            "billingCity",
            "billingState",
            "billingCountry",
            "billingPostalCode"
        ],
        propertiesOrder: [
            "invoiceId",
            "billingAddress",
            "billingCity",
            "billingState",
            "billingCountry",
            "billingPostalCode",
            "total",
            "invoiceDate",
            "customer"
        ]
    }
});

export default invoiceCollection;
