import { customizeTable } from "@rebasepro/cms";
import type { categories } from "../../../backend/schema/categories";

export const categoriesCms = customizeTable<typeof categories>("categories", {
    icon: "Category",
    fieldOrder: ["id", "name", "slug", "description", "icon"],
    fields: {
        description: {
            multiline: true
        }
    }
});
