import { describe, expect, it } from "@jest/globals";
import { labelFromIdentifier, singularLabel, tableLabels } from "../../src/tables";

describe("labelFromIdentifier", () => {
    it.each([
        ["first_name", "First Name"],
        ["firstName", "First Name"],
        ["FirstName", "First Name"],
        ["heroImage", "Hero Image"],
        ["author_id", "Author ID"],
        ["id", "ID"],
        ["photoURL", "Photo URL"],
        ["website_url", "Website URL"],
        ["__order", "Order"],
        ["needs_review", "Needs Review"]
    ])("%s reads %s", (identifier, label) => {
        expect(labelFromIdentifier(identifier)).toBe(label);
    });
});

describe("tableLabels", () => {
    it("names order_items 'Order Items', one of them an 'Order Item'", () => {
        expect(tableLabels({ name: "order_items" })).toEqual({ name: "Order Items", singularName: "Order Item" });
    });

    it.each([
        ["posts", "Post"],
        ["categories", "Category"],
        ["addresses", "Address"],
        ["boxes", "Box"],
        ["people", "Person"],
        ["status", "Status"],
        ["address", "Address"],
        ["analysis", "Analysis"],
        ["news", "News"]
    ])("%s → %s", (name, singular) => {
        expect(tableLabels({ name }).singularName).toBe(singular);
    });

    it("changes only the last word", () => {
        expect(singularLabel("Blog Posts")).toBe("Blog Post");
    });
});
