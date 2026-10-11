import type { CollectionConfig, EnumValueConfig, StringProperty } from "@rebasepro/types";
import { enumToObjectEntries } from "../src/util/enums";
import { resolvePropertyEnum } from "../src/util/resolutions";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";

/**
 * `enum: ["draft", "published"]` — a plain list of values — is what a JS
 * collection config (or one cast past the types) writes, and what the DDL and
 * codegen both read: the Postgres enum type was created with the right labels
 * and the generated union was right. Only the admin disagreed: its readers took
 * every entry for `{ id, label }`, found neither on a string, and filtered the
 * dropdown down to nothing. Three readers of one field, one of them empty.
 */
describe("a string-array enum reaches the admin as its values", () => {
    // What a JS config hands over: the type does not describe it, the runtime gets it.
    const plain = ["draft", "published", "archived"] as unknown as EnumValueConfig[];
    const expected = [
        { id: "draft", label: "draft" },
        { id: "published", label: "published" },
        { id: "archived", label: "archived" }
    ];

    it("normalises each string to an entry whose id and label are the value", () => {
        expect(enumToObjectEntries(plain)).toEqual(expected);
    });

    it("keeps a number value a number", () => {
        expect(enumToObjectEntries([1, 2] as unknown as EnumValueConfig[])).toEqual([
            { id: 1, label: "1" },
            { id: 2, label: "2" }
        ]);
    });

    it("resolves to a dropdown with every value, not an empty one", () => {
        const property: StringProperty = { name: "Status", type: "string", enum: plain };
        expect(resolvePropertyEnum(property).enum).toEqual(expected);
    });

    it("is normalised once, at the registry, for every downstream reader", () => {
        const posts: CollectionConfig = {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: { status: { name: "Status", type: "string", enum: plain } }
        };
        const registry = new CollectionRegistry([posts]);
        const status = registry.get("posts")?.properties.status as StringProperty;
        expect(status.enum).toEqual(expected);
    });
});
