import { enumValueLabel, labelFromIdentifier, singularLabel } from "../src/labels";

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
        ["needs_review", "Needs Review"],
        ["order_items", "Order Items"]
    ])("%s reads %s", (identifier, label) => {
        expect(labelFromIdentifier(identifier)).toBe(label);
    });
});

describe("singularLabel", () => {
    it.each([
        ["Posts", "Post"],
        ["Categories", "Category"],
        ["Addresses", "Address"],
        ["Boxes", "Box"],
        ["People", "Person"],
        ["Status", "Status"],
        ["Address", "Address"],
        ["Analysis", "Analysis"],
        ["News", "News"],
        ["Order Items", "Order Item"]
    ])("%s → %s", (label, singularized) => {
        expect(singularLabel(label)).toBe(singularized);
    });

    it("changes only the last word", () => {
        expect(singularLabel("Blog Posts")).toBe("Blog Post");
    });
});

describe("enumValueLabel", () => {
    it("reads a string value as its identifier and a number as itself", () => {
        expect(enumValueLabel("needs_review")).toBe("Needs Review");
        expect(enumValueLabel(3)).toBe("3");
    });
});
