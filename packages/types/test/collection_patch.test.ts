/**
 * A panel save is what the person changed, not the collection.
 *
 * The collection editor holds a collection as JSON, and JSON drops everything
 * that makes a collection file more than data — a handler, a shared property,
 * an imported enum. A save that posted the whole collection deleted all of it.
 * The difference between what the editor loaded and what it saves cannot
 * contain any of it, because it was dropped from both sides equally.
 */
import {
    applyCollectionPatch,
    collectionPatchProblems,
    diffCollections,
    nestCollectionPatchPaths
} from "../src/types/collection_patch";

/** What the panel holds for a collection whose file has code in it. */
const books = () => {
    const statusProperty = {
        name: "Status",
        type: "string",
        enum: [{ id: "draft", label: "Draft", color: "grayLight" }],
        Field: () => null
    };
    return {
        name: "Books",
        slug: "books",
        table: "books",
        properties: {
            title: { name: "Title", type: "string" },
            status: statusProperty,
            author: { type: "relation", relation: { kind: "belongsTo", target: () => ({ slug: "authors" }) } }
        },
        // The panel's flat view model: the block merged on top, the block kept.
        icon: "Book",
        group: "Library",
        admin: {
            icon: "Book",
            group: "Library",
            entityActions: [{ key: "publish", name: "Publish", onClick: async () => undefined }],
            additionalFields: [{ key: "shout", name: "Shout", value: () => "" }]
        }
    };
};

describe("diffCollections", () => {
    it("is empty when nothing changed", () => {
        expect(diffCollections(books(), books())).toEqual([]);
    });

    it("is exactly the renamed key when only the name changed", () => {
        const loaded = books();
        const saving = { ...books(), name: "Books (renamed)" };
        expect(diffCollections(loaded, saving)).toEqual([
            { op: "set", path: ["name"], value: "Books (renamed)" }
        ]);
    });

    it("never mentions what JSON dropped — handlers, a shared field, a thunk", () => {
        const saving = books();
        saving.name = "Renamed";
        const paths = diffCollections(books(), saving).map(op => op.path.join("."));
        expect(paths).toEqual(["name"]);
    });

    it("moves a flat presentation key into `admin`", () => {
        const saving = { ...books(), icon: "Library" };
        expect(diffCollections(books(), saving)).toEqual([
            { op: "set", path: ["admin", "icon"], value: "Library" }
        ]);
    });

    it("sees a cleared presentation field even though the loaded `admin` copy still has it", () => {
        const saving: Record<string, unknown> = books();
        delete saving.group;
        expect(diffCollections(books(), saving)).toEqual([
            { op: "remove", path: ["admin", "group"] }
        ]);
    });

    it("moves a property's flat presentation key into the property's `admin`", () => {
        const saving = books();
        (saving.properties.title as Record<string, unknown>).readOnly = true;
        expect(diffCollections(books(), saving)).toEqual([
            { op: "set", path: ["properties", "title", "admin", "readOnly"], value: true }
        ]);
    });

    it("does not mistake a property named `admin` for the admin block", () => {
        const loaded = { properties: { admin: { name: "Admin", type: "boolean" } } };
        const saving = { properties: { admin: { name: "Admin", type: "boolean", readOnly: true } } };
        expect(diffCollections(loaded, saving)).toEqual([
            { op: "set", path: ["properties", "admin", "admin", "readOnly"], value: true }
        ]);
    });

    it("nests a whole property it adds", () => {
        const saving = books();
        (saving.properties as Record<string, unknown>).summary = { name: "Summary", type: "string", multiline: true };
        expect(diffCollections(books(), saving)).toEqual([
            { op: "set", path: ["properties", "summary"], value: { name: "Summary", type: "string", admin: { multiline: true } } }
        ]);
    });

    it("sets an array whole when it changed, and leaves an unchanged one alone", () => {
        const saving = books();
        saving.properties.status.enum = [...saving.properties.status.enum, { id: "scheduled", label: "Scheduled", color: "blueLight" }];
        const ops = diffCollections(books(), saving);
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({ op: "set", path: ["properties", "status", "enum"] });
    });

    it("lets the flat value win over the loaded `admin` copy", () => {
        const loaded = { icon: "A", admin: { icon: "A" } };
        const saving = { icon: "B", admin: { icon: "C" } };
        const ops = diffCollections(loaded, saving);
        expect(applyCollectionPatch({ admin: { icon: "A" } }, ops)).toEqual({ admin: { icon: "B" } });
    });
});

describe("nestCollectionPatchPaths", () => {
    it("leaves an already nested patch as it is", () => {
        const patch = [{ op: "set" as const, path: ["admin", "defaultFilter"], value: { status: ["==", "x"] } }];
        expect(nestCollectionPatchPaths(patch)).toEqual(patch);
    });

    it("reaches into a map's children and a block's properties", () => {
        expect(nestCollectionPatchPaths([
            { op: "set", path: ["properties", "seo", "properties", "slug", "readOnly"], value: true },
            { op: "set", path: ["properties", "body", "oneOf", "properties", "text", "markdown"], value: true },
            { op: "set", path: ["properties", "tags", "of", "previewAsTag"], value: true }
        ]).map(op => op.path.join("."))).toEqual([
            "properties.seo.properties.slug.admin.readOnly",
            "properties.body.oneOf.properties.text.admin.markdown",
            "properties.tags.of.admin.previewAsTag"
        ]);
    });
});

describe("applyCollectionPatch", () => {
    it("changes only what the patch names, and shares the rest by reference", () => {
        const current = books();
        const next = applyCollectionPatch(current, [{ op: "set", path: ["name"], value: "Renamed" }]);
        expect(next.name).toBe("Renamed");
        expect(next.properties).toBe(current.properties);
        expect(next.properties.author.relation.target).toBe(current.properties.author.relation.target);
        expect(current.name).toBe("Books");
    });

    it("creates the objects a deep `set` needs", () => {
        expect(applyCollectionPatch({ name: "x" }, [
            { op: "set", path: ["admin", "defaultFilter"], value: { a: 1 } }
        ])).toEqual({ name: "x", admin: { defaultFilter: { a: 1 } } });
    });

    it("treats removing a key that is not there as nothing to do", () => {
        const current = { name: "x" };
        expect(applyCollectionPatch(current, [{ op: "remove", path: ["admin", "group"] }])).toEqual({ name: "x" });
    });

    it("refuses a path that reaches a prototype", () => {
        expect(() => applyCollectionPatch({}, [{ op: "set", path: ["__proto__", "polluted"], value: true }])).toThrow();
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
});

describe("collectionPatchProblems", () => {
    it("accepts a well-formed patch", () => {
        expect(collectionPatchProblems([{ op: "set", path: ["name"], value: "x" }, { op: "remove", path: ["admin", "group"] }])).toEqual([]);
    });

    it("refuses a malformed one, saying where", () => {
        expect(collectionPatchProblems({})).toHaveLength(1);
        expect(collectionPatchProblems([{ op: "move", path: ["a"] }])[0]).toMatch(/patch\[0\]/);
        expect(collectionPatchProblems([{ op: "set", path: [] }])[0]).toMatch(/non-empty/);
        expect(collectionPatchProblems([{ op: "set", path: ["constructor", "x"], value: 1 }])[0]).toMatch(/constructor/);
    });

    it("refuses the runtime's resolved relation, at any depth", () => {
        expect(collectionPatchProblems([
            { op: "set", path: ["properties", "author", "resolvedRelation"], value: {} }
        ])[0]).toMatch(/resolvedRelation/);
        expect(collectionPatchProblems([
            { op: "set", path: ["properties"], value: { author: { type: "relation", resolvedRelation: { kind: "belongsTo" } } } }
        ])[0]).toMatch(/resolvedRelation/);
    });
});
