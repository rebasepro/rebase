// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import addressCollection from "./address";
import customerCollection from "./customer";
import inventoryCollection from "./inventory";
import staffCollection from "./staff";

const storeCollection = defineCollection({
    name: "Store",
    singularName: "Store",
    slug: "store",
    table: "store",
    properties: {
        storeId: {
            name: "Store Id",
            columnName: "store_id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        managerStaffId: {
            name: "Manager Staff Id",
            columnName: "manager_staff_id",
            type: "number",
            columnType: "integer",
            validation: {
                required: true,
                unique: true
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
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "customer",
            target: (): AnyCollectionConfig => customerCollection,
            // the customer.store_id FK points back here
            foreignKeyOnTarget: "store_id"
        },
        {
            kind: "hasMany",
            relationName: "inventory",
            target: (): AnyCollectionConfig => inventoryCollection,
            // the inventory.store_id FK points back here
            foreignKeyOnTarget: "store_id"
        },
        {
            kind: "hasMany",
            relationName: "staff",
            target: (): AnyCollectionConfig => staffCollection,
            // the staff.store_id FK points back here
            foreignKeyOnTarget: "store_id"
        },
    ],
    admin: {
        icon: "Database",
        sort: ["lastUpdate", "desc"],
        propertiesOrder: [
            "storeId",
            "managerStaffId",
            "lastUpdate",
            "address"
        ]
    }
});

export default storeCollection;
