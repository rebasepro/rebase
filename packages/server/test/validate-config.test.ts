import { describe, expect, it, jest } from "@jest/globals";

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

    it("does not look inside the admin block for keys it simply does not know", () => {
        // The block belongs to @rebasepro/cms-types, which the server may not
        // import. Guessing at its contents here would reject keys the panel adds.
        const collection = { ...valid(), admin: { icon: "Article", somethingTheAdminAdded: true } };
        expect(findCollectionConfigProblems([collection])).toEqual([]);
    });

    it("does name a key the admin block used to have", () => {
        // The one exception, and the reason it is an exception: nothing reads
        // `admin.titleProperty` any more, so leaving it silent means a title
        // that reverts to the derived one with no way to tell why.
        const collection = { ...valid(), admin: { icon: "Article", titleProperty: "name" } };
        const [problem] = errors([collection]);
        expect(problem.path).toBe("posts.admin.titleProperty");
        expect(problem.message).toContain("admin.display.title");
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

/**
 * A pattern that will not compile is not a strict rule — it is no rule.
 *
 * `toPattern` in `write-validation.ts` rebuilds the `RegExp` per request and
 * answers `undefined` when it cannot, and the caller reads
 * `if (pattern && !pattern.test(value))`. So an unclosed bracket does not
 * reject writes: it removes the check, every value passes, and the author goes
 * on believing something guards that column.
 */
describe("a `validation.matches` that cannot compile", () => {
    const withMatches = (matches: unknown) => {
        const collection = valid();
        return {
            ...collection,
            properties: {
                ...collection.properties,
                slug: { name: "Slug", type: "string", validation: { matches } }
            }
        };
    };

    it("errors, naming the pattern and what it would cost", () => {
        const [problem] = errors([withMatches("[a-z")]);
        expect(problem?.path).toBe("posts.properties.slug.validation.matches");
        expect(problem?.message).toContain("[a-z");
        expect(problem?.message).toMatch(/every value passes/);
    });

    it("refuses to boot on it, as it does for a renamed key", () => {
        expect(() => assertCollectionConfigs([withMatches("(unclosed")])).toThrow(/not a valid regular expression/);
    });

    it("accepts a pattern that does compile", () => {
        expect(errors([withMatches("^[a-z0-9-]+$")])).toEqual([]);
    });

    it("says nothing about a RegExp literal, which the engine already compiled", () => {
        expect(errors([withMatches(/^[a-z]+$/)])).toEqual([]);
    });

    it("says nothing when there is no `matches` rule", () => {
        expect(errors([valid()])).toEqual([]);
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
        // `propertiesOrder` is an admin key on a COLLECTION and a core key on a
        // map — `MapProperty` declares it — so at the top level of a map it is
        // correct and must stay accepted.
        //
        // `previewProperties` is not. It is declared on `AdminMapOptions`, not
        // on `MapProperty`, and it is in `ADMIN_PROPERTY_KEYS`. This test used
        // to assert it was accepted here too, on the strength of a comment
        // calling both "core keys on a map" — agreeing with the allowlist
        // rather than with the type. The allowlist did list it, so nothing
        // disagreed, and the consequence was that writing it here parsed clean
        // and then nothing read it.
        const collection = valid();
        (collection.properties as Record<string, unknown>).meta = {
            name: "Meta",
            type: "map",
            properties: { a: { name: "A", type: "string" } },
            propertiesOrder: ["a"]
        };

        expect(findCollectionConfigProblems([collection])).toEqual([]);
    });

    it("sends a map's previewProperties to the admin block, where it is read", () => {
        const collection = valid();
        (collection.properties as Record<string, unknown>).meta = {
            name: "Meta",
            type: "map",
            properties: { a: { name: "A", type: "string" } },
            previewProperties: ["a"]
        };

        const problems = findCollectionConfigProblems([collection]);
        expect(problems.length).toBeGreaterThan(0);
        expect(JSON.stringify(problems)).toContain("admin");

        const nested = valid();
        (nested.properties as Record<string, unknown>).meta = {
            name: "Meta",
            type: "map",
            properties: { a: { name: "A", type: "string" } },
            admin: { previewProperties: ["a"] }
        };
        expect(findCollectionConfigProblems([nested])).toEqual([]);
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

/**
 * A Kanban board is two declarations that have to agree, and every way of
 * getting it wrong parses, boots, serves rows and renders a board. The panel
 * shows an amber bar to whoever opens the board; nothing told whoever started
 * the server, which is how a collection ships with a board that cannot be
 * reordered and nobody notices for weeks.
 */
describe("a Kanban board's two halves", () => {
    const board = (admin: Record<string, unknown>, extraProperties: Record<string, unknown> = {}) => ({
        ...valid(),
        properties: {
            ...valid().properties,
            status: { name: "Status", type: "string", enum: [{ id: "todo", label: "To do" }] },
            ...extraProperties
        },
        admin: { icon: "Article", ...admin }
    });

    const orderKey = {
        __order: {
            name: "Order",
            type: "string",
            admin: { disabled: true, hideFromCollection: true }
        }
    };

    it("passes when both halves are declared", () => {
        const collection = board(
            { kanban: { columnProperty: "status" }, orderProperty: "__order" },
            orderKey
        );
        expect(findCollectionConfigProblems([collection])).toEqual([]);
    });

    it("warns when `kanban` is declared without an `orderProperty`", () => {
        const problems = warnings([board({ kanban: { columnProperty: "status" } })]);
        expect(problems).toHaveLength(1);
        expect(problems[0].path).toBe("posts.admin.orderProperty");
        expect(problems[0].message).toContain("no `orderProperty`");
    });

    it("warns on a board reached through `enabledViews` alone", () => {
        // `kanban` is optional — listing the view is enough to render one.
        const problems = warnings([board({ enabledViews: ["table", "kanban"] })]);
        expect(problems).toHaveLength(1);
        expect(problems[0].path).toBe("posts.admin.orderProperty");
    });

    it("warns on a board reached through `defaultViewMode` alone", () => {
        const problems = warnings([board({ defaultViewMode: "kanban" })]);
        expect(problems).toHaveLength(1);
    });

    it("boots on that warning — the board works, it just does not reorder", () => {
        expect(() => assertCollectionConfigs([board({ kanban: { columnProperty: "status" } })]))
            .not.toThrow();
    });

    it("says nothing about a collection that has no board", () => {
        expect(findCollectionConfigProblems([board({ enabledViews: ["table", "cards"] })])).toEqual([]);
    });

    it("errors when `orderProperty` names no property", () => {
        const problems = errors([board(
            { kanban: { columnProperty: "status" }, orderProperty: "sortOrder" }
        )]);
        expect(problems).toHaveLength(1);
        expect(problems[0].message).toContain("names no property");
    });

    it("errors when `orderProperty` names a number — an order key is a string", () => {
        // The documented example said `type: "number"` for a long time. Stored
        // values can never be valid `fractional-indexing` keys, so the board
        // offers to initialise itself forever and the initialisation then fails
        // writing a string into a numeric column.
        const problems = errors([board(
            { kanban: { columnProperty: "status" }, orderProperty: "sortOrder" },
            { sortOrder: { name: "Sort Order", type: "number" } }
        )]);
        expect(problems).toHaveLength(1);
        expect(problems[0].path).toBe("posts.properties.sortOrder");
        expect(problems[0].message).toContain('type: "string"');
    });

    it("refuses to boot on a non-string order property", () => {
        expect(() => assertCollectionConfigs([board(
            { kanban: { columnProperty: "status" }, orderProperty: "sortOrder" },
            { sortOrder: { name: "Sort Order", type: "number" } }
        )])).toThrow(/order key is a string/);
    });

    it("checks `orderProperty` even on a collection with no board — it orders tables too", () => {
        const problems = errors([board({ orderProperty: "nope" })]);
        expect(problems).toHaveLength(1);
        expect(problems[0].message).toContain("names no property");
    });

    it("stays quiet when the properties are not declared inline to check against", () => {
        const collection = { ...board({ orderProperty: "__order" }), properties: undefined };
        expect(errors([collection]).filter(p => p.path.includes("orderProperty"))).toEqual([]);
    });
});

describe("the two kinds of problem are reported apart", () => {
    /**
     * They used to share one header. Once a semantic check existed, that header
     * announced "unrecognised key(s) ... ignored" over a problem that was
     * neither, and pointed at REBASE_STRICT_COLLECTION_CONFIG — a switch that
     * would not have changed anything about it.
     */
    const boardWithoutOrder = () => ({
        ...valid(),
        admin: { icon: "Article", kanban: { columnProperty: "status" } },
        properties: {
            ...valid().properties,
            status: { name: "Status", type: "string", enum: [{ id: "todo", label: "To do" }] }
        }
    });

    it("tags an unrecognised key as a key problem", () => {
        const problems = findCollectionConfigProblems([{ ...valid(), whatIsThis: true }]);
        expect(problems.map(p => p.kind)).toEqual(["key"]);
    });

    it("tags a renamed key as a key problem too — same remedy, different confidence", () => {
        const problems = findCollectionConfigProblems([{ ...valid(), views: [] }]);
        expect(problems.every(p => p.kind === "key")).toBe(true);
    });

    it("tags an incoherent board as its own kind", () => {
        expect(findCollectionConfigProblems([boardWithoutOrder()]).map(p => p.kind))
            .toEqual(["incoherent"]);
    });

    it("does not offer strict mode as a remedy for an incoherent config", () => {
        const logged: string[] = [];
        const spy = jest.spyOn(console, "warn").mockImplementation(m => { logged.push(String(m)); });
        try {
            assertCollectionConfigs([boardWithoutOrder()]);
        } finally {
            spy.mockRestore();
        }
        const output = logged.join("\n");
        expect(output).toContain("cannot do");
        expect(output).not.toContain("REBASE_STRICT_COLLECTION_CONFIG");
        expect(output).not.toContain("unrecognised key");
    });

    it("still offers it for an unrecognised key", () => {
        const logged: string[] = [];
        const spy = jest.spyOn(console, "warn").mockImplementation(m => { logged.push(String(m)); });
        try {
            assertCollectionConfigs([{ ...valid(), whatIsThis: true }]);
        } finally {
            spy.mockRestore();
        }
        expect(logged.join("\n")).toContain("REBASE_STRICT_COLLECTION_CONFIG");
    });
});
