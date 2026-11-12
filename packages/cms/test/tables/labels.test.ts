import { describe, expect, it } from "@jest/globals";
import { tableLabels } from "../../src/tables";

// The identifier rule itself (`labelFromIdentifier`, `singularLabel`) is
// tested where it lives, in @rebasepro/utils (test/labels.test.ts).
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

    it("reads the name as an identifier", () => {
        expect(tableLabels({ name: "photoURL" }).name).toBe("Photo URL");
    });
});
