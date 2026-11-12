import { customizeTable } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";

export const postsCms = customizeTable<typeof posts>("posts", {
    icon: "Article",
    fields: {
        content: {
            markdown: true
        },
        status: {
            enumLabels: {
                draft: {
                    label: "Draft",
                    color: "gray"
                },
                review: {
                    label: "In Review",
                    color: "orange"
                },
                published: {
                    label: "Published",
                    color: "green"
                }
            }
        }
    }
});
