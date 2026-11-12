// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import customerCollection from "./customer";
import inventoryCollection from "./inventory";
import staffCollection from "./staff";

const rentalCollection = defineCollection({
    name: "Rental",
    singularName: "Rental",
    slug: "rental",
    table: "rental",
    properties: {
        rentalId: {
            name: "Rental Id",
            columnName: "rental_id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        uuid: {
            name: "Uuid",
            columnName: "uuid",
            type: "string",
            columnType: "uuid",
            databaseDefault: "sql`uuidv7()`",
            validation: {
                required: true,
                unique: true
            },
        },
        rentalDate: {
            name: "Rental Date",
            columnName: "rental_date",
            type: "date",
            validation: {
                required: true
            },
        },
        returnDate: {
            name: "Return Date",
            columnName: "return_date",
            type: "date",
        },
        lastUpdate: {
            name: "Last Update",
            columnName: "last_update",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
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
                localKey: "customer_id"
            }
        },
        inventory: {
            name: "Inventory",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: inventory_id -> inventory(inventory_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => inventoryCollection,
                localKey: "inventory_id"
            }
        },
        staff: {
            name: "Staff",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: staff_id -> staff(staff_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => staffCollection,
                localKey: "staff_id"
            }
        },
    },
    admin: {
        icon: "Database",
        display: { title: "uuid" },
        sort: ["lastUpdate", "desc"],
        listProperties: [
            "rentalId",
            "uuid",
            "rentalDate",
            "returnDate",
            "lastUpdate",
            "customer"
        ],
        propertiesOrder: [
            "rentalId",
            "uuid",
            "rentalDate",
            "returnDate",
            "lastUpdate",
            "customer",
            "inventory",
            "staff"
        ]
    }
});

export default rentalCollection;
