import { customizeTable } from "@rebasepro/cms";
import type { orderItems } from "../../../backend/schema/order_items";
import { joinParts, money, included } from "./lib/display";

export const orderItemsCms = customizeTable<typeof orderItems>("order_items", {
    icon: "ReceiptText",
    group: "E-Commerce",
    hideFromNavigation: true,
    display: {
        title: "product_name",
        subtitle: ({ row }) => joinParts(
            row.sku,
            `${row.quantity ?? 0} × ${money(row.unit_price) ?? "—"}`
        ),
        image: ({ row }) => {
            const images = included(row, "product")?.images;
            return Array.isArray(images) && images.length ? String(images[0]) : undefined;
        }
    },
    form: {
        sections: [
            {
                key: "item",
                fields: ["order", "product", "product_name", "sku"]
            },
            {
                key: "amounts",
                title: "Amounts",
                readVariant: "summary",
                fields: ["quantity", "unit_price", "line_total"]
            }
        ]
    },
    fieldOrder: ["product", "product_name", "sku", "quantity", "unit_price", "line_total"],
    fields: {
        sku: {
            name: "SKU"
        },
        line_total: {
            readOnly: true
        }
    }
});
