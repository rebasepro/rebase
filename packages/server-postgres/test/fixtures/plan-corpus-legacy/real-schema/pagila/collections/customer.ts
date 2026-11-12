// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import addressCollection from "./address";
import storeCollection from "./store";
import rentalCollection from "./rental";

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
            columnType: "serial",
        },
        firstName: {
            name: "First Name",
            columnName: "first_name",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
        lastName: {
            name: "Last Name",
            columnName: "last_name",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
        email: {
            name: "Email",
            columnName: "email",
            type: "string",
            admin: {
                multiline: true
            },
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
        activebool: {
            name: "Activebool",
            columnName: "activebool",
            type: "boolean",
            defaultValue: true,
            validation: {
                required: true
            },
        },
        active: {
            name: "Active",
            columnName: "active",
            type: "number",
            columnType: "integer",
        },
        createDate: {
            name: "Create Date",
            columnName: "create_date",
            type: "date",
            columnType: "date",
            databaseDefault: "sql`CURRENT_DATE`",
            validation: {
                required: true
            },
        },
        lastUpdate: {
            name: "Last Update",
            columnName: "last_update",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
        },
        address: {
            name: "Address",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: address_id -> address(address_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => addressCollection,
                localKey: "address_id"
            }
        },
        store: {
            name: "Store",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: store_id -> store(store_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => storeCollection,
                localKey: "store_id"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "rental",
            target: (): AnyCollectionConfig => rentalCollection,
            // the rental.customer_id FK points back here
            foreignKeyOnTarget: "customer_id"
        },
    ],
    admin: {
        icon: "Users",
        display: { title: "uuid" },
        listProperties: [
            "customerId",
            "firstName",
            "lastName",
            "email",
            "uuid",
            "activebool"
        ],
        propertiesOrder: [
            "customerId",
            "firstName",
            "lastName",
            "email",
            "uuid",
            "activebool",
            "active",
            "createDate",
            "lastUpdate",
            "address",
            "store"
        ]
    }
});

export default customerCollection;
