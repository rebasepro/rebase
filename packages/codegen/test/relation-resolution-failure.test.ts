import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { generateTypedefs } from "../src/generate-types";
import type { CollectionConfig } from "@rebasepro/types";

/**
 * What the generated `Database` type contains when a collection's relations
 * cannot be resolved.
 *
 * `resolveCollectionRelations` throws when a target thunk cannot be evaluated —
 * a circular import is the usual cause, and the boot-time relation validator
 * calls that out by name. Here it was caught with `catch { /* ignore *\/ }`,
 * leaving `resolvedRelations` empty, and generation carried on.
 *
 * The output is then a `Database` type for that collection with no relation
 * fields and, worse, none of the foreign-key columns those relations imply —
 * because the FK columns are emitted from the resolved relations, not from the
 * properties. So `data.posts.find({ where: { author_id: … } })` stops
 * typechecking against a column that exists in the database, and the error
 * surfaces in the user's code with nothing pointing back at generation.
 *
 * Silently emitting an incomplete type is the failure worth refusing to be
 * quiet about.
 */
const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { id: { type: "string", isId: true }, title: { type: "string" } },
    relations: [{
        kind: "belongsTo",
        relationName: "author",
        localKey: "author_id",
        target: () => { throw new Error("Cannot access 'users' before initialization"); }
    }]
} as unknown as CollectionConfig;

describe("generateTypedefs when relations cannot be resolved", () => {
    let warn: ReturnType<typeof jest.spyOn>;

    beforeEach(() => { warn = jest.spyOn(console, "warn").mockImplementation(() => { /* quiet */ }); });
    afterEach(() => warn.mockRestore());

    it("still generates the rest of the file", () => {
        const output = generateTypedefs([posts]);

        expect(output).toContain("posts");
        expect(output).toContain("title");
    });

    it("says which collection lost its relations, and why", () => {
        generateTypedefs([posts]);

        const said = warn.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
        expect(said).toContain("posts");
        expect(said).toMatch(/before initialization/);
    });

    it("does not warn for a collection whose relations resolve", () => {
        const users = {
            slug: "users", name: "Users", table: "users",
            properties: { id: { type: "string", isId: true } }
        } as unknown as CollectionConfig;
        const ok = {
            ...posts,
            relations: [{ kind: "belongsTo", relationName: "author", localKey: "author_id", target: () => users }]
        } as unknown as CollectionConfig;

        generateTypedefs([ok, users]);

        expect(warn).not.toHaveBeenCalled();
    });
});
