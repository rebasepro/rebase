import { defineCollection } from "@rebasepro/cms-types";

const ordersCollection = defineCollection({
    name: "Orders",
    singularName: "Order",
    slug: "orders",
    table: "orders",
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
        },
        customerEmail: {
            name: "Customer Email",
            type: "string",
            columnName: "customer_email",
            validation: { required: true }
        },
        status: {
            name: "Status",
            type: "string",
            enum: [
                {
                    id: "pending",
                    label: "Pending",
                    color: "gray"
                },
                {
                    id: "processing",
                    label: "Processing",
                    color: "blue"
                },
                {
                    id: "shipped",
                    label: "Shipped",
                    color: "orange"
                },
                {
                    id: "delivered",
                    label: "Delivered",
                    color: "green"
                },
                {
                    id: "cancelled",
                    label: "Cancelled",
                    color: "red"
                }
            ]
        },
        total: {
            name: "Total",
            type: "number",
            validation: { required: true }
        },
        notes: {
            name: "Notes",
            type: "string",
            admin: {
                multiline: true
            }
        },
        createdAt: {
            name: "Created At",
            type: "date",
            columnName: "created_at",
            autoValue: "on_create",
            admin: {
                readOnly: true
            }
        }
    },
    admin: {
        icon: "Receipt"
    }
});

export default ordersCollection;
