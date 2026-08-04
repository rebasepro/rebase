import type { AdminCollection } from "@rebasepro/admin-types";
import {
    getDisplayPropertyKey,
    getDisplayResolver,
    hasDeclaredDisplay
} from "../../src/collections/entity-display";

/**
 * Reading `admin.display`.
 *
 * The two forms are answered by different functions on purpose: a path is
 * readable from values already in hand, a resolver may have to go to the
 * network, and a caller that cannot await (a sort comparator, an export column,
 * a server render) has to be able to ask for only the first without accidentally
 * getting the second.
 */
// The deprecation warning is deduped per collection *for the life of the
// process*, which is what keeps a fifty-row list to one console line — and what
// makes two tests sharing a slug order-dependent. Every collection built here
// gets its own.
let slugCounter = 0;

const collection = (
    display: Record<string, unknown> | undefined,
    extra: Record<string, unknown> = {}
) => ({
    name: "Exercises",
    slug: `exercises-${++slugCounter}`,
    table: "exercises",
    properties: {
        name: { name: "Name",
type: "string" }
    },
    display,
    ...extra
} as unknown as AdminCollection);

describe("getDisplayPropertyKey", () => {

    it("returns the declared path", () => {
        expect(getDisplayPropertyKey(collection({ title: "name" }), "title")).toBe("name");
        expect(getDisplayPropertyKey(collection({ image: "cover" }), "image")).toBe("cover");
    });

    it("returns nothing for a role filled by a resolver", () => {
        const c = collection({ title: () => "computed" });
        expect(getDisplayPropertyKey(c, "title")).toBeUndefined();
    });

    it("returns nothing for a role the collection never mentions", () => {
        expect(getDisplayPropertyKey(collection({ title: "name" }), "status")).toBeUndefined();
        expect(getDisplayPropertyKey(collection(undefined), "title")).toBeUndefined();
    });
});

describe("getDisplayResolver", () => {

    it("returns the declared resolver", () => {
        const resolve = () => "computed";
        expect(getDisplayResolver(collection({ subtitle: resolve }), "subtitle")).toBe(resolve);
    });

    it("returns nothing for a role declared as a path", () => {
        expect(getDisplayResolver(collection({ title: "name" }), "title")).toBeUndefined();
    });
});

describe("the deprecated titleProperty", () => {

    it("is still read when display.title is absent", () => {
        const c = collection(undefined, { titleProperty: "name" });
        expect(getDisplayPropertyKey(c, "title")).toBe("name");
    });

    it("loses to display.title when a collection sets both", () => {
        // Mid-migration. The new field is the one it means.
        const c = collection({ title: "new_key" }, { titleProperty: "old_key" });
        expect(getDisplayPropertyKey(c, "title")).toBe("new_key");
    });

    it("warns once per collection, not once per row", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const c = collection(undefined, { titleProperty: "name" });
            for (let i = 0; i < 50; i++) getDisplayPropertyKey(c, "title");
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain("admin.display.title");
        } finally {
            warn.mockRestore();
        }
    });

    it("does not leak into any other role", () => {
        const c = collection(undefined, { titleProperty: "name" });
        expect(getDisplayPropertyKey(c, "subtitle")).toBeUndefined();
        expect(getDisplayPropertyKey(c, "image")).toBeUndefined();
    });
});

describe("hasDeclaredDisplay", () => {

    it("is true for either form, false for neither", () => {
        expect(hasDeclaredDisplay(collection({ title: "name" }), "title")).toBe(true);
        expect(hasDeclaredDisplay(collection({ title: () => "x" }), "title")).toBe(true);
        expect(hasDeclaredDisplay(collection({}), "title")).toBe(false);
    });

    it("counts the deprecated field, so the heuristics stand down for it too", () => {
        // `getLeadingRelationTitleKey` asks this. A junction collection that
        // declared a title used to keep getting the leading-relation guess.
        const c = collection(undefined, { titleProperty: "name" });
        expect(hasDeclaredDisplay(c, "title")).toBe(true);
    });
});
