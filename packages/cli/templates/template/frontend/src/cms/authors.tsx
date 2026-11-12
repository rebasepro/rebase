import { customizeTable } from "@rebasepro/cms";
import type { authors } from "../../../backend/schema/authors";

export const authorsCms = customizeTable<typeof authors>("authors", {
    icon: "Person",
    fieldOrder: ["id", "name", "email", "picture"]
});
