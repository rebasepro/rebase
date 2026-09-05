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

    it("warns on a key the admin block does not have", () => {
        // It used to look the other way here, on the reasoning that the block
        // belongs to @rebasepro/cms-types and guessing at its contents would
        // reject options the panel had added. But the list it is checked
        // against — `ADMIN_COLLECTION_KEYS` — lives in core so that core can
        // read it, and cms-types type-checks it against the options in both
        // directions. It cannot fall behind the panel, so the block was simply
        // the one place where a typo produced no signal at all.
        const collection = { ...valid(), admin: { icon: "Article", somethingTheAdminAdded: true } };
        const [problem] = warnings([collection]);
        expect(problem.path).toBe("posts.admin.somethingTheAdminAdded");
        expect(errors([collection])).toEqual([]);
    });

    it("suggests the key an admin typo was one edit from", () => {
        const collection = valid();
        collection.properties.body = { name: "Body", type: "string", admin: { multilne: true } } as never;

        const [problem] = warnings([collection]);

        expect(problem.path).toBe("posts.properties.body.admin.multilne");
        expect(problem.message).toContain("Did you mean `multiline`?");
    });

    it("accepts every key the admin block really has", () => {
        const collection = valid();
        collection.properties.body = {
            name: "Body",
            type: "string",
            admin: { multiline: true, markdown: true, readOnly: false, columnWidth: 200 }
        } as never;

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
        expect(relationName?.message).not.toContain("tooling/");
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
        expect(problem.message).not.toContain("tooling/");
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

    // Not a rename with a silent fallback: the surviving key is one level up
    // and unset, so ignoring this would turn a required relation optional in
    // the generated types and nullable in the column, quietly.
    it("errors on a relation carrying its own `validation`, naming the property's", () => {
        const collection = valid();
        collection.properties.author.relation = {
            kind: "belongsTo",
            target: () => ({}),
            relationName: "author",
            validation: { required: true }
        } as never;

        const [problem] = errors([collection]);

        expect(problem.path).toBe("posts.properties.author.relation.validation");
        expect(problem.message).toContain("no longer read here");
        expect(problem.message).toContain("the property's `validation.required`");
    });

    it("errors on a `relations[]` entry carrying its own `validation`", () => {
        const collection = { ...valid(), relations: [{
            kind: "belongsTo",
            relationName: "editor",
            target: () => ({}),
            validation: { required: true }
        }] };

        const [problem] = errors([collection]);

        expect(problem.path).toBe("posts.relations[editor].validation");
        expect(problem.message).toContain("the property's `validation.required`");
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

/**
 * An enum's ids are the labels of a Postgres enum type, and Postgres will not
 * hold the same label twice.
 *
 * `CREATE TYPE "posts_status" AS ENUM ('draft', 'draft')` raises `23505` on
 * `pg_enum_typid_label_index` — verified against PGlite — and boot read every
 * `pg_catalog` unique violation as a lost race with a peer pod. So it skipped
 * the statement, the type was never created, and the column became plain `TEXT`:
 * the config said "one of these three", the database accepted any string, and
 * nothing anywhere said so.
 */
describe("enum ids and labels", () => {
    const withEnum = (values: unknown) => {
        const collection = valid();
        return {
            ...collection,
            properties: {
                ...collection.properties,
                status: { name: "Status", type: "string", enum: values }
            }
        };
    };

    it("errors on two entries sharing an id, naming the property", () => {
        const [problem] = errors([withEnum([
            { id: "draft", label: "Draft" },
            { id: "published", label: "Published" },
            { id: "draft", label: "Also draft" }
        ])]);

        expect(problem?.path).toBe("posts.properties.status.enum[2]");
        expect(problem?.message).toContain("repeats the id `draft`");
        expect(problem?.message).toMatch(/falls back to plain text/);
    });

    it("refuses to boot on it", () => {
        expect(() => assertCollectionConfigs([withEnum([
            { id: "draft", label: "Draft" },
            { id: "draft", label: "Draft again" }
        ])])).toThrow(/repeats the id/);
    });

    it("errors on a blank id", () => {
        const [problem] = errors([withEnum([{ id: "  ", label: "Nothing" }])]);
        expect(problem?.path).toBe("posts.properties.status.enum[0]");
        expect(problem?.message).toContain("blank `id`");
    });

    it("errors on a blank label", () => {
        const [problem] = errors([withEnum([{ id: "draft", label: "" }])]);
        expect(problem?.message).toContain("blank `label`");
    });

    // A repeated label is not a database error — it is two dropdown options
    // that read the same. Worth saying, not worth refusing to boot over.
    it("warns on a repeated label", () => {
        const found = warnings([withEnum([
            { id: "draft", label: "Draft" },
            { id: "wip", label: "Draft" }
        ])]);
        expect(found[0]?.message).toContain("repeats the label \"Draft\"");
        expect(errors([withEnum([
            { id: "draft", label: "Draft" },
            { id: "wip", label: "Draft" }
        ])])).toEqual([]);
    });

    it("accepts the record form, whose keys cannot collide", () => {
        expect(errors([withEnum({ draft: "Draft", published: "Published" })])).toEqual([]);
    });

    it("errors on a blank label in the record form", () => {
        const [problem] = errors([withEnum({ draft: "" })]);
        expect(problem?.path).toBe("posts.properties.status.enum.draft");
        expect(problem?.message).toContain("blank `label`");
    });

    it("says nothing about a well-formed enum", () => {
        expect(findCollectionConfigProblems([withEnum([
            { id: "draft", label: "Draft" },
            { id: "published", label: "Published" }
        ])])).toEqual([]);
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

/**
 * Two questions no collection can answer about itself.
 *
 * `CollectionRegistry` registers by slug and by table name, and
 * `_registerRecursively` returns early when the table is already there — so the
 * second collection to claim either one was dropped without a word. Its routes
 * did not exist, its relations resolved to the other collection's rows, and the
 * file sat in `config/collections` looking loaded.
 */
describe("two collections claiming one identity", () => {
    it("errors on a duplicate slug, naming both files", () => {
        const a = { ...valid(), table: "posts_a" };
        const b = { ...valid(), table: "posts_b" };

        const [problem] = errors([a, b], { sources: ["posts.ts", "blog_posts.ts"] });

        expect(problem.path).toBe("posts");
        expect(problem.message).toContain("2 collections declare `slug: \"posts\"`");
        expect(problem.message).toContain("posts.ts");
        expect(problem.message).toContain("blog_posts.ts");
    });

    it("refuses to boot on it", () => {
        expect(() => assertCollectionConfigs([
            { ...valid(), table: "posts_a" },
            { ...valid(), table: "posts_b" }
        ])).toThrow(/declare `slug: "posts"`/);
    });

    it("falls back to the index when no source is given", () => {
        const [problem] = errors([{ ...valid(), table: "a" }, { ...valid(), table: "b" }]);
        expect(problem.message).toContain("collection[0]");
        expect(problem.message).toContain("collection[1]");
    });

    it("errors on two slugs resolving to one table", () => {
        const a = { ...valid(), slug: "posts", table: "content" };
        const b = { ...valid(), slug: "articles", table: "content" };

        const [problem] = errors([a, b], { sources: ["posts.ts", "articles.ts"] });

        expect(problem.path).toBe("public.content");
        expect(problem.message).toContain("resolve to the table `public.content`");
        expect(problem.message).toContain("articles.ts");
    });

    // The table is derived from the slug when none is declared, so this is the
    // shape a duplicate usually arrives in.
    it("catches a duplicate table that nobody wrote down", () => {
        const a = { ...valid(), slug: "posts", table: undefined };
        const b = { ...valid(), slug: "posts", table: undefined };

        expect(errors([a, b]).length).toBeGreaterThan(0);
    });

    it("says it once when the slug is what collided", () => {
        // Both errors would fire — same slug, therefore same derived table —
        // and the second adds nothing the first did not say.
        const found = errors([{ ...valid(), table: undefined }, { ...valid(), table: undefined }]);
        expect(found.map(p => p.path)).toEqual(["posts"]);
    });

    it("lets two collections share a name in different schemas", () => {
        const a = { ...valid(), slug: "posts", table: "posts" };
        const b = { ...valid(), slug: "archived_posts", table: "posts", schema: "archive" };

        expect(errors([a, b])).toEqual([]);
    });

    it("says nothing about a directory of distinct collections", () => {
        const a = { ...valid(), slug: "posts", table: "posts" };
        const b = { ...valid(), slug: "authors", table: "authors" };

        expect(findCollectionConfigProblems([a, b])).toEqual([]);
    });
});

/**
 * A relation property that names no relation is a relation in name only.
 *
 * The registry noticed and answered with one `console.warn` on stdout, at the
 * moment the panel builds its registry — which in a deployed backend nobody
 * reads. Everything downstream then behaved as though the field were not a
 * relation at all: no picker in the form, no foreign key in the schema, nothing
 * from `include()`.
 */
describe("a relation property that names no relation", () => {
    const withRelationProperty = (property: unknown, relations?: unknown[]) => {
        const collection = valid();
        return {
            ...collection,
            properties: { ...collection.properties, editor: property },
            ...(relations ? { relations } : {})
        };
    };

    it("errors, naming the property and both ways to fix it", () => {
        const [problem] = errors([withRelationProperty({ name: "Editor", type: "relation" })]);

        expect(problem.path).toBe("posts.properties.editor");
        expect(problem.message).toContain("names no relation");
        expect(problem.message).toContain("`relation: { kind: …, target: … }`");
        expect(problem.message).toContain("relationName: \"editor\"");
    });

    it("refuses to boot on it", () => {
        expect(() => assertCollectionConfigs([withRelationProperty({ name: "Editor", type: "relation" })]))
            .toThrow(/names no relation/);
    });

    it("is an incoherent config, not an unknown key", () => {
        // `REBASE_STRICT_COLLECTION_CONFIG` has no bearing on it, and offering
        // that variable as the remedy would send somebody somewhere useless.
        const [problem] = errors([withRelationProperty({ name: "Editor", type: "relation" })]);
        expect(problem.kind).toBe("incoherent");
    });

    it("accepts the inline block", () => {
        expect(errors([withRelationProperty({
            name: "Editor",
            type: "relation",
            relation: { kind: "belongsTo", target: () => ({}) }
        })])).toEqual([]);
    });

    it("accepts a `relations[]` entry the property key addresses", () => {
        expect(errors([withRelationProperty(
            { name: "Editor", type: "relation" },
            [{ kind: "belongsTo", relationName: "editor", target: () => ({}) }]
        )])).toEqual([]);
    });

    it("still errors when the `relations[]` entry is called something else", () => {
        const found = errors([withRelationProperty(
            { name: "Editor", type: "relation" },
            [{ kind: "belongsTo", relationName: "reviewer", target: () => ({}) }]
        )]);
        expect(found.map(p => p.path)).toContain("posts.properties.editor");
    });
});

describe("reporting", () => {
    it("reports every problem across every collection in one pass", () => {
        // A user migrating wants the whole list, not one boot per defect.
        const a = { ...valid(), icon: "Article", group: "Content", stray: 1 };
        const b = {
            ...valid(),
            slug: "authors",
            // Its own table: `valid()` carries `table: "posts"`, and two
            // collections resolving to one table is now its own error.
            table: "authors",
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

/**
 * Every message here is read by somebody who installed `@rebasepro/server` from
 * npm, and who has none of this repository on disk.
 *
 * Two of them used to end with "Run `node
 * tooling/scripts/codemod/relations-tagged-union.mjs` to migrate the whole
 * project". `tooling/` is not in the published package, so the single actionable
 * instruction those messages carried was the one thing the reader could not do
 * — and it sat where the per-key "write this instead" should have been.
 *
 * A grep over the source would not hold this: the same string is legitimate in a
 * comment about this repo's own gates. So this asserts the property that
 * matters — no path into this repository reaches a *message* — by driving the
 * validator over every migrated key it knows and reading what comes out.
 */
describe("no message names a path inside this repository", () => {
    const everyKnownMistake = (): unknown[] => [
        // Collection-level keys that moved into the admin block.
        { ...valid(), icon: "Article", group: "Content", listProperties: ["title"] },
        // The admin block's own removed key.
        { ...valid(), admin: { icon: "Article", titleProperty: "name" } },
        // A property with presentation left at the top level, and a `ui` block.
        {
            ...valid(),
            properties: {
                ...valid().properties,
                title: { name: "Title", type: "string", readOnly: true, multiline: true },
                body: { name: "Body", type: "string", ui: { markdown: true } }
            }
        },
        // A pre-0.11 flat relation, and the fields the tagged union dropped.
        {
            ...valid(),
            properties: {
                ...valid().properties,
                author: {
                    name: "Author",
                    type: "relation",
                    target: () => ({}),
                    localKey: "author_id",
                    direction: "owning",
                    cardinality: "one",
                    inverseRelationName: "posts"
                }
            }
        },
        // A relation with no `kind` at all.
        {
            ...valid(),
            properties: {
                ...valid().properties,
                author: { name: "Author", type: "relation", relation: { target: () => ({}) } }
            }
        },
        // An unknown key, which takes the other message path.
        { ...valid(), whatIsThis: true, admin: { icon: "Article", multilne: true } }
    ];

    it("says nothing about `tooling/`, `packages/` or a `.mjs` script", () => {
        const problems = findCollectionConfigProblems(everyKnownMistake());

        // A guard over an empty list guards nothing.
        expect(problems.length).toBeGreaterThan(10);

        for (const problem of problems) {
            expect(problem.message).not.toContain("tooling/");
            expect(problem.message).not.toContain("packages/");
            expect(problem.message).not.toMatch(/\.mjs\b/);
        }
    });
});
