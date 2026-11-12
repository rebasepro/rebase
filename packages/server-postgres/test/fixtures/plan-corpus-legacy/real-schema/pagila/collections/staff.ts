// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import addressCollection from "./address";
import storeCollection from "./store";
import rentalCollection from "./rental";

const staffCollection = defineCollection({
    name: "Staff",
    singularName: "Staff",
    slug: "staff",
    table: "staff",
    properties: {
        staffId: {
            name: "Staff Id",
            columnName: "staff_id",
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
        username: {
            name: "Username",
            columnName: "username",
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
        active: {
            name: "Active",
            columnName: "active",
            type: "boolean",
            defaultValue: true,
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
            validation: {
                required: true
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
                localKey: "store_id",
                onDelete: "no action"
            }
        },
        password: {
            name: "Password",
            columnName: "password",
            type: "string",
            admin: {
                multiline: true
            },
        },
        picture: {
            name: "Picture",
            columnName: "picture",
            type: "binary",
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "rental",
            target: (): AnyCollectionConfig => rentalCollection,
            // the rental.staff_id FK points back here
            foreignKeyOnTarget: "staff_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "firstName" },
        sort: ["lastUpdate", "desc"],
        listProperties: [
            "staffId",
            "firstName",
            "lastName",
            "username",
            "email",
            "active"
        ],
        propertiesOrder: [
            "staffId",
            "firstName",
            "lastName",
            "username",
            "email",
            "active",
            "lastUpdate",
            "address",
            "store",
            "password",
            "picture"
        ]
    }
});

export default staffCollection;
