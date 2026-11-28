import type { AdminCollection } from "@rebasepro/cms-types";
import { resolveFormLayout } from "../../src/collections/form-layout";

describe("resolveFormLayout — secondary field disclosure", () => {
    it("tucks admin.secondary fields into a collapsed 'More properties' section without dropping them", () => {
        const collection: AdminCollection<Record<string, unknown>> = {
            slug: "posts",
            name: "Posts",
            properties: {
                title: { name: "Title", type: "string" },
                body: { name: "Body", type: "string" },
                externalId: { name: "External ID", type: "string", admin: { secondary: true } },
                sortOrder: { name: "Sort order", type: "number", admin: { secondary: true } }
            }
        };

        const layout = resolveFormLayout({
            collection,
            fieldKeys: ["title", "body", "externalId", "sortOrder"],
            status: "existing"
        });

        expect(layout.sections).toHaveLength(2);
        expect(layout.sections[0].key).toBe("__main");
        expect(layout.sections[0].fields.map((f) => f.key)).toEqual(["title", "body"]);

        expect(layout.sections[1].key).toBe("__secondary");
        expect(layout.sections[1].title).toBe("More properties");
        expect(layout.sections[1].collapsible).toBe(true);
        expect(layout.sections[1].collapsed).toBe(true);
        expect(layout.sections[1].fields.map((f) => f.key)).toEqual(["externalId", "sortOrder"]);
    });
});
