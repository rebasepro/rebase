import { describe, expect, it } from "@jest/globals";

import {
    assertCollectionConfigs,
    findCollectionConfigProblems,
    unknownKeyPolicyFromEnv
} from "../src/collections/validate-config";

/**
 * The point of this validator is that a config written against an older version
 * used to load clean. Every case below is a shape that produced no signal at
 * all: the key was read by nobody, so the feature it configured was simply
 * absent, and the boot succeeded.
 */

const valid = () => ({
    name: "Posts",
    singularName: "Post",
    slug: "posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string", validation: { required: true } },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        author: {
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: () => ({}), relationName: "author" }
        }
    },
    admin: { icon: "Article" }
});

const errors = (collections: unknown[], options = {}) =>
    findCollectionConfigProblems(collections, options).filter(p => p.severity === "error");

const warnings = (collections: unknown[], options = {}) =>
    findCollectionConfigProblems(collections, options).filter(p => p.severity === "warning");

describe("a current-era config", () => {
    it("passes clean", () => {
        expect(findCollectionConfigProblems([valid()])).toEqual([]);
    });

    it("does not look inside the admin block", () => {
        // The block belongs to @rebasepro/admin-types, which the server may not
        // import. Guessing at its contents here would reject keys the panel adds.
        const collection = { ...valid(), admin: { icon: "Article", somethingTheAdminAdded: true } };
        expect(findCollectionConfigProblems([collection])).toEqual([]);
    });
});

describe("known-renamed keys", () => {
    it("errors on a relation property's flat `relationName`, naming the replacement", () => {
        const collection = valid();
        collection.properties.author = {
            name: "Author",
            type: "relation",
            relationName: "author",
            target: () => ({})
        } as never;

        const found = errors([collection]);

        expect(found).toHaveLength(2);
        const relationName = found.find(p => p.path === "posts.properties.author.relationName");
        expect(relationName?.message).toContain("no longer read here");
        expect(relationName?.message).toContain("move `relationName` inside `relation`");
        expect(relationName?.message).toContain("relations-tagged-union.mjs");
    });

    it("errors on `direction`, which the tagged union replaced rather than moved", () => {
        const collection = valid();
        collection.properties.author = {
            name: "Author",
            type: "relation",
            direction: "inverse",
            cardinality: "many"
        } as never;

        const messages = errors([collection]).map(p => p.message).join("\n");

        expect(messages).toContain("`direction` was removed");
        expect(messages).toContain("`hasMany`");
        expect(messages).toContain("implied by the relation's `kind`");
    });

    it("errors on a collection-level `icon`, which moved into the admin block", () => {
        const collection = { ...valid(), icon: "Article" };

        const [problem] = errors([collection]);

        expect(problem.path).toBe("posts.icon");
        expect(problem.message).toContain("moved into the collection's `admin` block in 0.11");
        expect(problem.message).toContain("admin: { icon: … }");
        expect(problem.message).toContain("collections-admin-block.mjs");
    });

    it("errors on a property-level `ui`, which became `admin`", () => {
        const collection = valid();
        collection.properties.body = { name: "Body", type: "string", ui: { markdown: true } } as never;

        const [problem] = errors([collection]);

        expect(problem.path).toBe("posts.properties.body.ui");
        expect(problem.message).toContain("`ui` was renamed to `admin` in 0.11");
    });

    it("errors on a presentation key left at the top of a property", () => {
        const collection = valid();
        collection.properties.title = { name: "Title", type: "string", readOnly: true } as never;

        const [problem] = errors([collection]);

        expect(problem.path).toBe("posts.properties.title.readOnly");
        expect(problem.message).toContain("belongs in the property's `admin` block");
    });

    it("still accepts `relationName` in the place it survives — inside the relation", () => {
        // The rename is positional: the key exists, one level down.
        expect(findCollectionConfigProblems([valid()])).toEqual([]);
    });

    it("errors on a relation with no `kind`", () => {
        const collection = valid();
        collection.properties.author.relation = { target: () => ({}) } as never;

        const [problem] = errors([collection]);

        expect(problem.message).toContain("became a tagged union in 0.11");
        expect(problem.message).toContain("belongsTo, hasOne, hasMany, manyToMany, via");
    });

    it("errors on a link field that does not belong to the kind", () => {
        const collection = valid();
        collection.properties.author.relation = {
            kind: "hasMany",
            target: () => ({}),
            localKey: "author_id"
        } as never;

        const [problem] = errors([collection]);

        expect(problem.path).toBe("posts.properties.author.relation.localKey");
        expect(problem.message).toContain("not valid on a \"hasMany\" relation");
    });
});

describe("unrecognised keys", () => {
    it("warns rather than failing, because configs carry legitimate metadata", () => {
        const collection = { ...valid(), somethingOfOurOwn: true };

        expect(errors([collection])).toEqual([]);
        const [warning] = warnings([collection]);
        expect(warning.path).toBe("posts.somethingOfOurOwn");
        expect(warning.message).toContain("not a known collection key");
    });

    it("boots on a warning", () => {
        expect(() => assertCollectionConfigs([{ ...valid(), somethingOfOurOwn: true }])).not.toThrow();
    });

    /**
     * `search` was added to `PostgresCollectionConfig`, typechecked everywhere,
     * shipped, and was discarded right here at boot — the deployed backend
     * logged "`search` is not a known collection key and is being ignored" and
     * served the old behaviour. The feature was declared and did nothing, which
     * is worse than not having it: the config says the column is indexed.
     *
     * A compile-time assertion in `validate-config.ts` now makes the list
     * unable to drift from the types. This is the runtime half — it fails if
     * the key is dropped from the list even where the types still permit it.
     */
    it("accepts the `search` block, which was ignored in production once", () => {
        const collection = {
            ...valid(),
            search: {
                language: "spanish",
                unaccent: true,
                fields: [{ path: "title", weight: "A" }, "body"]
            }
        };

        expect(errors([collection])).toEqual([]);
        expect(warnings([collection])).toEqual([]);
    });

    it("still warns for a key that really is unknown, beside a valid `search`", () => {
        const collection = {
            ...valid(),
            search: { fields: ["title"] },
            searrch: { fields: ["title"] }
        };

        const paths = warnings([collection]).map(w => w.path);
        expect(paths).toContain("posts.searrch");
        expect(paths).not.toContain("posts.search");
    });

    it("escalates to an error when asked", () => {
        const collections = [{ ...valid(), somethingOfOurOwn: true }];

        expect(errors(collections, { unknownKeys: "error" })).toHaveLength(1);
        expect(() => assertCollectionConfigs(collections, { unknownKeys: "error" })).toThrow(/somethingOfOurOwn/);
    });

    it("can be silenced entirely", () => {
        expect(findCollectionConfigProblems([{ ...valid(), somethingOfOurOwn: true }], { unknownKeys: "off" })).toEqual([]);
    });

    it("reads its default from the environment", () => {
        expect(unknownKeyPolicyFromEnv({})).toBe("warn");
        expect(unknownKeyPolicyFromEnv({ REBASE_STRICT_COLLECTION_CONFIG: "error" })).toBe("error");
        expect(unknownKeyPolicyFromEnv({ REBASE_STRICT_COLLECTION_CONFIG: "1" })).toBe("error");
        expect(unknownKeyPolicyFromEnv({ REBASE_STRICT_COLLECTION_CONFIG: "off" })).toBe("off");
        expect(unknownKeyPolicyFromEnv({ REBASE_STRICT_COLLECTION_CONFIG: "nonsense" })).toBe("warn");
    });

    it("keeps a nested property's own keys apart from the collection's", () => {
        // `propertiesOrder` and `previewProperties` are admin keys on a collection
        // and core keys on a map. The codemod had to get this right too.
        const collection = valid();
        (collection.properties as Record<string, unknown>).meta = {
            name: "Meta",
            type: "map",
            properties: { a: { name: "A", type: "string" } },
            propertiesOrder: ["a"],
            previewProperties: ["a"]
        };

        expect(findCollectionConfigProblems([collection])).toEqual([]);
    });
});

describe("reporting", () => {
    it("reports every problem across every collection in one pass", () => {
        // A user migrating wants the whole list, not one boot per defect.
        const a = { ...valid(), icon: "Article", group: "Content", stray: 1 };
        const b = {
            ...valid(),
            slug: "authors",
            hideFromNavigation: true,
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                bio: { name: "Bio", type: "string", ui: { markdown: true }, alsoStray: 1 }
            }
        };

        const problems = findCollectionConfigProblems([a, b]);

        expect(problems.filter(p => p.severity === "error").map(p => p.path).sort()).toEqual([
            "authors.hideFromNavigation",
            "authors.properties.bio.ui",
            "posts.group",
            "posts.icon"
        ]);
        expect(problems.filter(p => p.severity === "warning").map(p => p.path).sort()).toEqual([
            "authors.properties.bio.alsoStray",
            "posts.stray"
        ]);
    });

    it("names every error in the thrown message, not just the first", () => {
        const collection = { ...valid(), icon: "Article", group: "Content", defaultSize: "s" };

        let message = "";
        try {
            assertCollectionConfigs([collection]);
        } catch (e) {
            message = (e as Error).message;
        }

        expect(message).toContain("3 problem(s)");
        expect(message).toContain("posts.icon");
        expect(message).toContain("posts.group");
        expect(message).toContain("posts.defaultSize");
    });

    it("falls back to the index when a collection has no slug to name it by", () => {
        const problems = findCollectionConfigProblems([{ name: "Nameless", properties: {} }]);

        expect(problems[0].path).toBe("collection[0]");
        expect(problems[0].message).toContain("no `slug`");
    });

    it("recurses into arrays and maps", () => {
        const collection = valid();
        (collection.properties as Record<string, unknown>).blocks = {
            name: "Blocks",
            type: "array",
            of: {
                name: "Block",
                type: "map",
                properties: {
                    text: { name: "Text", type: "string", ui: { markdown: true } }
                }
            }
        };

        const [problem] = errors([collection]);

        expect(problem.path).toBe("posts.properties.blocks.of.properties.text.ui");
    });
});
