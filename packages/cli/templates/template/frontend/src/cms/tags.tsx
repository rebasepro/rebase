import { customizeTable } from "@rebasepro/cms";
import type { tags } from "../../../backend/schema/tags";

export const tagsCms = customizeTable<typeof tags>("tags", {
    icon: "Tag",
    fields: {
        name: {
            name: "Tag Name"
        }
    }
});
