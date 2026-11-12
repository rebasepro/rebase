// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import customersCollection from "./customers";
import employeesCollection from "./employees";
import shippersCollection from "./shippers";
import orderDetailsCollection from "./order_details";

const ordersCollection = defineCollection({
    name: "Orders",
    singularName: "Order",
    slug: "orders",
    table: "orders",
    properties: {
        orderId: {
            name: "Order Id",
            columnName: "order_id",
            type: "number",
            isId: "manual",
        },
        shipName: {
            name: "Ship Name",
            columnName: "ship_name",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 40
            },
        },
        shipAddress: {
            name: "Ship Address",
            columnName: "ship_address",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 60
            },
        },
        shipCity: {
            name: "Ship City",
            columnName: "ship_city",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 15
            },
        },
        shipRegion: {
            name: "Ship Region",
            columnName: "ship_region",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 15
            },
        },
        shipPostalCode: {
            name: "Ship Postal Code",
            columnName: "ship_postal_code",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 10
            },
        },
        shipCountry: {
            name: "Ship Country",
            columnName: "ship_country",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 15
            },
        },
        freight: {
            name: "Freight",
            columnName: "freight",
            type: "number",
            columnType: "real",
        },
        orderDate: {
            name: "Order Date",
            columnName: "order_date",
            type: "date",
            columnType: "date",
        },
        requiredDate: {
            name: "Required Date",
            columnName: "required_date",
            type: "date",
            columnType: "date",
        },
        shippedDate: {
            name: "Shipped Date",
            columnName: "shipped_date",
            type: "date",
            columnType: "date",
        },
        customer: {
            name: "Customer",
            type: "relation",
            // mapped from foreign key: customer_id -> customers(customer_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => customersCollection,
                localKey: "customer_id",
                onDelete: "no action"
            }
        },
        employee: {
            name: "Employee",
            type: "relation",
            // mapped from foreign key: employee_id -> employees(employee_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => employeesCollection,
                localKey: "employee_id",
                onDelete: "no action"
            }
        },
        shipVia: {
            name: "ShipVia",
            type: "relation",
            // mapped from foreign key: ship_via -> shippers(shipper_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => shippersCollection,
                localKey: "ship_via",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "order_details",
            target: (): AnyCollectionConfig => orderDetailsCollection,
            // the order_details.order_id FK points back here
            foreignKeyOnTarget: "order_id"
        },
    ],
    admin: {
        icon: "ShoppingCart",
        listProperties: [
            "orderId",
            "shipName",
            "shipAddress",
            "shipCity",
            "shipRegion",
            "shipPostalCode"
        ],
        propertiesOrder: [
            "orderId",
            "shipName",
            "shipAddress",
            "shipCity",
            "shipRegion",
            "shipPostalCode",
            "shipCountry",
            "freight",
            "orderDate",
            "requiredDate",
            "shippedDate",
            "customer",
            "employee",
            "shipVia"
        ]
    }
});

export default ordersCollection;
