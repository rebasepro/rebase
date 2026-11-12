// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import invoiceCollection from "./invoice";
import trackCollection from "./track";

const invoiceLineCollection = defineCollection({
    name: "Invoice Line",
    singularName: "Invoice Line",
    slug: "invoice_line",
    table: "invoice_line",
    properties: {
        invoiceLineId: {
            name: "Invoice Line Id",
            columnName: "invoice_line_id",
            type: "number",
            isId: "manual",
            columnType: "integer",
        },
        unitPrice: {
            name: "Unit Price",
            columnName: "unit_price",
            type: "number",
            precision: 10,
            scale: 2,
            validation: {
                required: true
            },
        },
        quantity: {
            name: "Quantity",
            columnName: "quantity",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        invoice: {
            name: "Invoice",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: invoice_id -> invoice(invoice_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => invoiceCollection,
                localKey: "invoice_id",
                onDelete: "no action"
            }
        },
        track: {
            name: "Track",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: track_id -> track(track_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => trackCollection,
                localKey: "track_id",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "ShoppingCart",
        propertiesOrder: [
            "invoiceLineId",
            "unitPrice",
            "quantity",
            "invoice",
            "track"
        ]
    }
});

export default invoiceLineCollection;
