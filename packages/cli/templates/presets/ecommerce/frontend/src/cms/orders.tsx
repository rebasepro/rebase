import { customizeTable } from "@rebasepro/cms";
import type { orders } from "../../../backend/schema/orders";

export const ordersCms = customizeTable<typeof orders>("orders", {
    icon: "Receipt",
    fields: {
        status: {
            enumLabels: {
                pending: {
                    label: "Pending",
                    color: "gray"
                },
                processing: {
                    label: "Processing",
                    color: "blue"
                },
                shipped: {
                    label: "Shipped",
                    color: "orange"
                },
                delivered: {
                    label: "Delivered",
                    color: "green"
                },
                cancelled: {
                    label: "Cancelled",
                    color: "red"
                }
            }
        },
        notes: {
            multiline: true
        },
        createdAt: {
            readOnly: true
        }
    }
});
