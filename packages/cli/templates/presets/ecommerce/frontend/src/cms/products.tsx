import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    icon: "ShoppingCart",
    fields: {
        description: {
            markdown: true
        },
        status: {
            enumLabels: {
                draft: {
                    label: "Draft",
                    color: "gray"
                },
                active: {
                    label: "Active",
                    color: "green"
                },
                archived: {
                    label: "Archived",
                    color: "orange"
                }
            }
        }
    }
});
