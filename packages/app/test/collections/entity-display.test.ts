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

describe("hasDeclaredDisplay", () => {

    it("is true for either form, false for neither", () => {
        expect(hasDeclaredDisplay(collection({ title: "name" }), "title")).toBe(true);
        expect(hasDeclaredDisplay(collection({ title: () => "x" }), "title")).toBe(true);
        expect(hasDeclaredDisplay(collection({}), "title")).toBe(false);
    });

    it("is false for a role the collection says nothing about, so the heuristics run", () => {
        // `getLeadingRelationTitleKey` asks this: a collection that declares a
        // title must not also get the leading-relation guess.
        expect(hasDeclaredDisplay(collection({ subtitle: "name" }), "title")).toBe(false);
    });
});
