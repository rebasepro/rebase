import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { orders } from "../../../backend/schema/orders";
import { text, copyToClipboard } from "./lib/actions";
import { joinParts, fullName, included, money } from "./lib/display";

export const ordersCms = customizeTable<typeof orders>("orders", {
    icon: "ShoppingCart",
    group: "E-Commerce",
    entityActions: [
        {
            key: "ship",
            name: "Mark as shipped",
            icon: "Truck",
            collapsed: false,
            isEnabled: ({ row }) => row?.payment_status === "paid"
                && ["pending", "confirmed", "processing"].includes(String(row?.status)),
            disabledReason: ({ row }) => {
                const status = String(row?.status);
                if (status === "shipped" || status === "delivered") return "Already shipped";
                if (status === "cancelled" || status === "refunded") return `This order was ${status}`;
                return "Waiting for payment";
            },
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id, {
                    status: "shipped",
                    shipped_date: new Date().toISOString(),
                    tracking_number: text(row.tracking_number)
                        ?? `1Z${Math.random().toString(36).slice(2, 12).toUpperCase()}`
                }, "Order marked as shipped")
        },
        {
            key: "deliver",
            name: "Mark as delivered",
            icon: "PackageCheck",
            collapsed: false,
            isEnabled: ({ row }) => row?.status === "shipped",
            disabledReason: ({ row }) => row?.status === "delivered"
                ? "Already delivered"
                : "Ship the order first",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id,
                    { status: "delivered", delivered_date: new Date().toISOString() }, "Order marked as delivered")
        },
        {
            key: "copy_tracking",
            name: "Copy tracking number",
            icon: "ClipboardCopy",
            isEnabled: ({ row }) => Boolean(text(row?.tracking_number)),
            disabledReason: () => "No tracking number yet — it is set when the order ships",
            onClick: ({ row, context }) => row &&
                copyToClipboard(context, String(row.tracking_number), "Tracking number copied")
        },
        {
            key: "refund",
            name: "Refund",
            icon: "Undo2",
            isEnabled: ({ row }) => row?.payment_status === "paid",
            disabledReason: ({ row }) => String(row?.payment_status).includes("refunded")
                ? "Already refunded"
                : "Nothing to refund: the order is not paid",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id,
                    { payment_status: "refunded", status: "refunded" }, "Order refunded")
        }
    ],
    defaultEntityAction: "view",
    defaultViewMode: "table",
    kanban: {
        columnField: "status",
        orderField: "__order"
    },
    display: {
        title: "order_number",
        subtitle: ({ row }) => joinParts(
            fullName(included(row, "customer")),
            money(row.total, row.currency)
        ),
        status: "status",
        date: "order_date",
        tags: "payment_status"
    },
    form: {
        sidebar: ["status", "payment_status", "currency"],
        sections: [
            {
                key: "order",
                fields: ["order_number", "customer", "order_date"]
            },
            {
                key: "totals",
                title: "Totals",
                readVariant: "summary",
                fields: ["subtotal", "tax_amount", "shipping_cost", "discount_amount", "total"]
            },
            {
                key: "fulfilment",
                title: "Fulfilment",
                fields: ["shipping_address", "tracking_number", "shipped_date", "delivered_date"]
            },
            {
                key: "internal",
                title: "Internal",
                collapsed: true,
                fields: ["notes"]
            }
        ]
    },
    fieldOrder: [
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
                status: [
                    "in",
                    ["cancelled", "refunded"]
                ]
            }
        }
    ],
    fields: {
        order_number: {
            name: "Order #"
        },
        status: {
            enumLabels: {
                pending: {
                    label: "Pending",
                    color: "orange"
                },
                confirmed: {
                    label: "Confirmed",
                    color: "blue"
                },
                processing: {
                    label: "Processing",
                    color: "cyan"
                },
                shipped: {
                    label: "Shipped",
                    color: "purple"
                },
                delivered: {
                    label: "Delivered",
                    color: "green"
                },
                cancelled: {
                    label: "Cancelled",
                    color: "red"
                },
                refunded: {
                    label: "Refunded",
                    color: "gray"
                }
            }
        },
        payment_status: {
            name: "Payment",
            enumLabels: {
                unpaid: {
                    label: "Unpaid",
                    color: "red"
                },
                paid: {
                    label: "Paid",
                    color: "green"
                },
                partially_refunded: {
                    label: "Partially Refunded",
                    color: "orange"
                },
                refunded: {
                    label: "Refunded",
                    color: "gray"
                }
            }
        },
        subtotal: {
            readOnly: true
        },
        tax_amount: {
            name: "Tax"
        },
        shipping_cost: {
            name: "Shipping"
        },
        discount_amount: {
            name: "Discount"
        },
        total: {
            readOnly: true
        },
        currency: {
            enumLabels: {
                USD: "USD ($)",
                EUR: "EUR (€)",
                GBP: "GBP (£)",
                CAD: "CAD (C$)",
                AUD: "AUD (A$)"
            }
        },
        shipping_address: {
            multiline: true
        },
        notes: {
            name: "Internal Notes",
            multiline: true
        },
        order_date: {
            mode: "date_time"
        },
        shipped_date: {
            mode: "date_time",
            clearable: true
        },
        delivered_date: {
            mode: "date_time",
            clearable: true
        },
        created_at: {
            name: "Created at",
            readOnly: true,
            hidden: true
        },
        updated_at: {
            name: "Updated at",
            readOnly: true,
            hidden: true
        },
        __order: {
            name: "Board position",
            disabled: true,
            hidden: true
        }
    }
});
