import { defineCollection, EntityCallbackContext } from "@rebasepro/common";
import customersCollection from "./customers";
import orderItemsCollection from "./order_items";
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { fullName, joinParts, money, relatedRecord } from "../display";

// Helper function to extract ID from relation value (which can be primitive ID or expanded object)
const getRelationId = (val: unknown): string | number | undefined => {
    if (!val) return undefined;
    if (typeof val === "object" && val !== null && "id" in val) return (val as { id: string | number }).id;
    if (typeof val === "string" || typeof val === "number") return val;
    return undefined;
};

const ordersCollection: PostgresCollectionConfig = {
    name: "Orders",
    singularName: "Order",
    slug: "orders",
    table: "orders",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        order_number: {
            name: "Order #",
            type: "string",
            validation: {
                required: true,
                unique: true
            },
            description: "Human-readable order identifier (e.g. ORD-2025-0042)"
        },
        customer: {
            name: "Customer",
            type: "relation",
            validation: {
                required: true
            },
            relation: {
                kind: "belongsTo",
                target: () => customersCollection,
            }
        },
        status: {
            name: "Status",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "pending",
            enum: [
                { id: "pending", label: "Pending", color: "orange" },
                { id: "confirmed", label: "Confirmed", color: "blue" },
                { id: "processing", label: "Processing", color: "cyan" },
                { id: "shipped", label: "Shipped", color: "purple" },
                { id: "delivered", label: "Delivered", color: "green" },
                { id: "cancelled", label: "Cancelled", color: "red" },
                { id: "refunded", label: "Refunded", color: "gray" }
            ]
        },
        payment_status: {
            name: "Payment",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "unpaid",
            enum: [
                { id: "unpaid", label: "Unpaid", color: "red" },
                { id: "paid", label: "Paid", color: "green" },
                { id: "partially_refunded", label: "Partially Refunded", color: "orange" },
                { id: "refunded", label: "Refunded", color: "gray" }
            ]
        },
        subtotal: {
            name: "Subtotal",
            type: "number",
            admin: { readOnly: true },
            description: "Sum of all line items before tax and shipping"
        },
        tax_amount: {
            name: "Tax",
            type: "number",
            defaultValue: 0,
            description: "Tax amount"
        },
        shipping_cost: {
            name: "Shipping",
            type: "number",
            defaultValue: 0,
            description: "Shipping cost"
        },
        discount_amount: {
            name: "Discount",
            type: "number",
            defaultValue: 0,
            description: "Total discount applied"
        },
        total: {
            name: "Total",
            type: "number",
            admin: { readOnly: true },
            description: "Final order total (subtotal + tax + shipping - discount)"
        },
        currency: {
            name: "Currency",
            type: "string",
            defaultValue: "USD",
            enum: [
                {
                    id: "USD",
                    label: "USD ($)"
                },
                {
                    id: "EUR",
                    label: "EUR (€)"
                },
                {
                    id: "GBP",
                    label: "GBP (£)"
                },
                {
                    id: "CAD",
                    label: "CAD (C$)"
                },
                {
                    id: "AUD",
                    label: "AUD (A$)"
                }
            ]
        },
        shipping_address: {
            name: "Shipping Address",
            type: "string",
            admin: { multiline: true },
            description: "Delivery address for this order"
        },
        tracking_number: {
            name: "Tracking Number",
            type: "string",
            description: "Shipping carrier tracking number"
        },
        notes: {
            name: "Internal Notes",
            type: "string",
            admin: { multiline: true },
            description: "Internal notes (not visible to customer)"
        },
        order_date: {
            name: "Order Date",
            type: "date",
            mode: "date_time",
            validation: {
                required: true
            }
        },
        shipped_date: {
            name: "Shipped Date",
            type: "date",
            mode: "date_time",
            admin: { clearable: true }
        },
        delivered_date: {
            name: "Delivered Date",
            type: "date",
            mode: "date_time",
            admin: { clearable: true }
        },
        created_at: {
            name: "Created at",
            type: "date",
            autoValue: "on_create",
            admin: { readOnly: true, hideFromCollection: true }
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            admin: { readOnly: true, hideFromCollection: true }
        },
        __order: {
            // Not "Order" as on tickets: on a collection *of* orders, beside
            // `order_number` and `order_date`, that name reads as the record.
            name: "Board position",
            type: "string",
            admin: {
                disabled: true,
                hideFromCollection: true
            },
            description: "Fractional index maintained by the Kanban board"
        }
    },
    // Headless relation: no property for "order_items", only used for subcollection tab
    relations: [
        {
            kind: "hasMany",
            relationName: "order_items",
            target: () => orderItemsCollection
            // No `hideFromNavigation: false` override here any more. It existed
            // because that one flag used to govern both the drawer and a parent's
            // tab strip, so a line-items table could not be kept out of the drawer
            // without also losing the tab it belongs on. `hideFromEntityViews`
            // splits the two, and order_items now says only what it means:
            // not a destination, still a tab.
        }
    ],
    callbacks: {
        beforeSave: ({ values }) => {
            // Ensure total is kept in sync if tax, shipping or discount changes
            const subtotal = Number(values.subtotal ?? 0);
            const tax = Number(values.tax_amount ?? 0);
            const shipping = Number(values.shipping_cost ?? 0);
            const discount = Number(values.discount_amount ?? 0);
            values.total = subtotal + tax + shipping - discount;
            return values;
        },
        afterSave: async ({ values, previousValues, context }) => {
            const customerId = getRelationId(values.customer) ?? getRelationId(previousValues?.customer);
            if (customerId) {
                await updateCustomerMetrics(customerId, context);
            }
        },
        afterDelete: async ({ row, context }) => {
            const customerId = getRelationId(row.customer);
            if (customerId) {
                await updateCustomerMetrics(customerId, context);
            }
        }
    },
    admin: {
        icon: "ShoppingCart",
        group: "E-Commerce",
        defaultEntityAction: "view",
        enabledViews: ["table", "kanban"],
        kanban: {
            columnProperty: "status"
        },
        // Lexicographic sort keys, so a card dragged between board columns keeps
        // its position. Without it the board runs read-only and says so in a
        // banner across the top of every column.
        orderProperty: "__order",
        // An order is the one record here that is *about* someone else, and the
        // derived roles could not say so: the board card read
        // "ORD-2026-0101 / fdbf3f73-b2cb-4558-…" — the row's own uuid, which is
        // what the card falls back to when no subtitle resolves.
        //
        // Both arms of the API are in use below. A path keeps the property's own
        // rendering, which is why `status`, `order_date` and `payment_status` are
        // named rather than computed — the chip keeps its colour, the date keeps
        // its format. A resolver is for the two values that are not on the row in
        // a readable form: the customer's name, which lives on the related
        // record, and the total, which is a bare number until it is money.
        display: {
            title: "order_number",
            subtitle: ({ entity }) => joinParts(
                fullName(relatedRecord(entity.values.customer)),
                money(entity.values.total, entity.values.currency)
            ),
            status: "status",
            date: "order_date",
            tags: "payment_status"
        },
        // The state of an order is what you check first and change least, so it
        // goes to the rail; the rest reads top to bottom as the order's life —
        // who placed it, what it came to, where it went.
        form: {
            sidebar: ["status", "payment_status", "currency"],
            sections: [
                { key: "order", properties: ["order_number", "customer", "order_date"] },
                {
                    key: "totals",
                    title: "Totals",
                    properties: ["subtotal", "tax_amount", "shipping_cost", "discount_amount", "total"],
                    // Five figures that add up to the last one. On the grid they
                    // are five equal cells, which is the one arrangement that
                    // says they are unrelated; read as a receipt they are one
                    // calculation. Read-only — the form still gets real inputs.
                    readVariant: "summary"
                },
                {
                    key: "fulfilment",
                    title: "Fulfilment",
                    properties: ["shipping_address", "tracking_number", "shipped_date", "delivered_date"]
                },
                {
                    key: "internal",
                    title: "Internal",
                    properties: ["notes"],
                    collapsed: true
                }
            ]
        },
        propertiesOrder: [
            "order_number",
            "status",
            "customer",
            "payment_status",
            "order_date",
            "subtotal",
            "tax_amount",
            "shipping_cost",
            "discount_amount",
            "total",
            "currency",
            "shipping_address",
            "tracking_number",
            "shipped_date",
            "delivered_date",
            "notes",
            "created_at",
            "updated_at",
            "id"
        ],
        filterPresets: [
            {
                label: "Shipped orders",
                filterValues: {
                    status: ["==", "shipped"]
                }
            },
            {
                label: "Pending & paid",
                filterValues: {
                    status: ["==", "pending"],
                    payment_status: ["==", "paid"]
                }
            },
            {
                label: "High-value orders (> $500)",
                filterValues: {
                    total: [">", 500]
                },
                sort: ["total", "desc"]
            },
            {
                label: "Cancelled / Refunded",
                filterValues: {
                    status: ["in", ["cancelled", "refunded"]]
                }
            }
        ]
    }
};

// Helper function to update customer lifetime value and total orders count
async function updateCustomerMetrics(customerId: string | number, context: EntityCallbackContext) {
    const { data: customerOrders } = await context.data.collection("orders").find({
        where: {
            customer: ["==", customerId],
            status: ["!=", "cancelled"] // Ignore cancelled orders
        }
    });

    const totalOrders = customerOrders.length;
    const lifetimeValue = customerOrders.reduce((sum: number, order) => {
        // Sum only paid or delivered orders
        if (order.payment_status === "paid" || order.status === "delivered") {
            return sum + Number(order.total ?? 0);
        }
        return sum;
    }, 0);

    await context.data.collection("customers").update(customerId, {
        total_orders: totalOrders,
        lifetime_value: lifetimeValue,
        is_vip: lifetimeValue >= 1000 // VIP threshold
    });
}

export default ordersCollection;
