// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import cityCollection from "./city";
import customerCollection from "./customer";
import staffCollection from "./staff";
import storeCollection from "./store";

const addressCollection = defineCollection({
    name: "Address",
    singularName: "Address",
    slug: "address",
    table: "address",
    properties: {
        addressId: {
            name: "Address Id",
            columnName: "address_id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        phone: {
            name: "Phone",
            columnName: "phone",
            type: "string",
            admin: {
                multiline: true
            },
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
        city: {
            name: "City",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: city_id -> city(city_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => cityCollection,
                localKey: "city_id"
            }
        },
        address: {
            name: "Address",
            columnName: "address",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
        address2: {
            name: "Address2",
            columnName: "address2",
            type: "string",
            admin: {
                multiline: true
            },
        },
        district: {
            name: "District",
            columnName: "district",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
        postalCode: {
            name: "Postal Code",
            columnName: "postal_code",
            type: "string",
            admin: {
                multiline: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "customer",
            target: (): AnyCollectionConfig => customerCollection,
            // the customer.address_id FK points back here
            foreignKeyOnTarget: "address_id"
        },
        {
            kind: "hasMany",
            relationName: "staff",
            target: (): AnyCollectionConfig => staffCollection,
            // the staff.address_id FK points back here
            foreignKeyOnTarget: "address_id"
        },
        {
            kind: "hasMany",
            relationName: "store",
            target: (): AnyCollectionConfig => storeCollection,
            // the store.address_id FK points back here
            foreignKeyOnTarget: "address_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "address" },
        sort: ["lastUpdate", "desc"],
        listProperties: [
            "addressId",
            "phone",
            "lastUpdate",
            "city",
            "address",
            "address2"
        ],
        propertiesOrder: [
            "addressId",
            "phone",
            "lastUpdate",
            "city",
            "address",
            "address2",
            "district",
            "postalCode"
        ]
    }
});

export default addressCollection;
