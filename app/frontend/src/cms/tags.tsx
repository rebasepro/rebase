import { customizeTable } from "@rebasepro/cms";
import type { tags } from "../../../backend/schema/tags";

export const tagsCms = customizeTable<typeof tags>("tags", {
    icon: "Tag",
    group: "Content",
    hideFromNavigation: true,
    hideFromEntityViews: true,
    display: {
        title: "name"
    },
    fields: {
        name: {
            name: "Tag Name"
        }
    }
});
