/**
 * The collection sets the codegen tests generated from before the generator
 * read table descriptors, kept as data so the descriptor generator can be held
 * to what the collection generator wrote for them.
 *
 * `sdk-golden/<name>.ts.txt` is the collection generator's output for each set,
 * recorded before it was replaced. `sdk-parity.test.ts` lifts each set with
 * `collectionsToTableDefs`, compiles it with `compileTables` and asserts the
 * descriptor generator writes the golden byte for byte — or that the set is
 * one the lift refuses, or that every differing line is explained by a rule of
 * that test's allow-list.
 *
 * Written loosely on purpose: several sets carry shapes the collection types
 * no longer admit (bare enum ids, a property type nothing defines), because
 * they are the shapes the generator was hardened against.
 */
import type { CollectionConfig } from "@rebasepro/types";

/** Loosely written fixture data, handed to the generator as the collections it is. */
const loose = (data: unknown[]): CollectionConfig[] => data.map(entry => entry as CollectionConfig);

const authorsCollection = {
    name: "Authors",
    singularName: "Author",
    slug: "authors",
    table: "authors",
    properties: {
        id: { name: "ID", type: "number", isId: "increment", validation: { required: true } },
        name: { name: "Name", type: "string", validation: { required: true } },
        email: { name: "Email", type: "string" }
    }
};

function relationFixtures(): Record<string, () => CollectionConfig[]> {
    const authorsNumeric = { slug: "authors", name: "authors", engine: "postgres", properties: { id: { type: "number", isId: "increment" } } };
    const authorsUuid = { slug: "authors", name: "authors", engine: "postgres", properties: { id: { type: "string", isId: "uuid" } } };
    return {
        "fk-target-key-type": () => loose([{
            slug: "posts", name: "posts", engine: "postgres",
            properties: {
                id: { type: "number", isId: "increment" },
                author: { type: "relation", relation: { kind: "belongsTo", target: () => authorsNumeric, localKey: "author_id" } }
            }
        }, authorsNumeric]),
        "fk-target-key-unknown": () => loose([{
            slug: "posts", name: "posts", engine: "postgres",
            properties: {
                id: { type: "number", isId: "increment" },
                author: {
                    type: "relation",
                    relation: { kind: "belongsTo", target: () => ({ slug: "no_properties", name: "no-properties", properties: {} }), localKey: "author_id" }
                }
            }
        }]),
        "required-relation-property": () => loose([{
            slug: "posts", name: "posts", engine: "postgres",
            properties: {
                id: { type: "number", isId: "increment" },
                author: {
                    type: "relation",
                    validation: { required: true },
                    relation: { kind: "belongsTo", target: () => authorsUuid, localKey: "author_id" }
                }
            }
        }, authorsUuid]),
        "required-relations-entry": () => loose([{
            slug: "posts", name: "posts", engine: "postgres",
            properties: {
                id: { type: "number", isId: "increment" },
                author: { type: "relation", validation: { required: true } }
            },
            relations: [{ kind: "belongsTo", relationName: "author", target: () => authorsUuid, localKey: "author_id" }]
        }, authorsUuid]),
        "many-to-many-inlined": () => {
            const tags = { slug: "tags", name: "tags", engine: "postgres", properties: { id: { type: "number", isId: "increment" } } };
            return loose([{
                slug: "posts", name: "posts", engine: "postgres",
                properties: {
                    id: { type: "number", isId: "increment" },
                    tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } }
                }
            }, tags]);
        },
        "target-outside-run": () => loose([{
            slug: "posts", name: "posts", engine: "postgres",
            properties: {
                id: { type: "number", isId: "increment" },
                author: {
                    type: "relation",
                    relation: { kind: "belongsTo", target: () => ({ slug: "authors", name: "authors", properties: {} }), localKey: "author_id" }
                }
            }
        }]),
        "relation-shadows-its-key": () => {
            const companies = { slug: "companies", name: "companies", engine: "postgres", properties: { id: { type: "string", isId: "uuid" } } };
            return loose([{
                slug: "jobs", name: "jobs", engine: "postgres",
                properties: { id: { type: "string", isId: "uuid" } },
                relations: [{ kind: "belongsTo", relationName: "companyId", target: () => companies, localKey: "company_id" }]
            }, companies]);
        }
    };
}

function rowInsertUpdateFixtures(): Record<string, () => CollectionConfig[]> {
    const authors = { slug: "authors", name: "authors", properties: { id: { type: "number", isId: "increment" } } };
    const posts = {
        slug: "posts", name: "posts",
        properties: {
            id: { type: "string", isId: "uuid" },
            title: { type: "string", validation: { required: true } },
            subtitle: { type: "string" },
            secret: { type: "string", excludeFromApi: true },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
        }
    };
    return {
        "row-insert-update": () => loose([posts, authors]),
        "relation-renamed-from-property": () => loose([{
            slug: "posts", name: "posts",
            properties: {
                id: { type: "string", isId: "uuid" },
                author: {
                    type: "relation",
                    relation: { kind: "belongsTo", relationName: "author_rel", target: () => authors, localKey: "author_id" }
                }
            }
        }, authors]),
        "composite-key": () => loose([{
            slug: "company_translation", name: "company_translation",
            properties: {
                id: { type: "number", isId: true },
                locale: { type: "string", isId: "manual" },
                name: { type: "string" }
            }
        }])
    };
}

function excludedFixtures(): Record<string, () => CollectionConfig[]> {
    const owners = { slug: "owners", name: "owners", properties: { id: { name: "ID", type: "string", isId: "uuid" } } };
    const vault = {
        slug: "vault", name: "vault",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            label: { name: "Label", type: "string", validation: { required: true } },
            owner: { name: "Owner", type: "relation", relation: { kind: "belongsTo", target: () => owners, localKey: "owner_id" } },
            credential: { name: "Credential", type: "string", excludeFromApi: true },
            attempts: { name: "Attempts", type: "number", validation: { required: true }, excludeFromApi: true },
            lockedOut: { name: "Locked out", type: "boolean", excludeFromApi: true },
            rotatedAt: { name: "Rotated at", type: "date", excludeFromApi: true },
            recoveryCodes: { name: "Recovery codes", type: "array", of: { name: "Code", type: "string" }, excludeFromApi: true },
            internalNotes: { name: "Internal notes", type: "map", properties: { note: { name: "Note", type: "string" } }, excludeFromApi: true },
            legacyOwner: { name: "Legacy owner", type: "string", columnName: "owner_id", excludeFromApi: true },
            auditor: {
                name: "Auditor",
                type: "relation",
                relation: { kind: "belongsTo", target: () => owners, localKey: "auditor_id" },
                excludeFromApi: true
            }
        }
    };
    return { "exclude-from-api": () => loose([vault, owners]) };
}

function includeGraph(): CollectionConfig[] {
    const authors = {
        slug: "authors", name: "authors",
        properties: { id: { type: "string", isId: "uuid" }, name: { type: "string", validation: { required: true } } }
    };
    const comments = {
        slug: "comments", name: "comments",
        properties: {
            id: { type: "string", isId: "uuid" },
            body: { type: "string", validation: { required: true } },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
        }
    };
    const posts = {
        slug: "posts", name: "posts",
        properties: {
            id: { type: "string", isId: "uuid" },
            title: { type: "string", validation: { required: true } },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } },
            comments: { type: "relation", relation: { kind: "hasMany", target: () => comments, foreignKeyOnTarget: "post_id" } }
        }
    };
    return loose([authors, comments, posts]);
}

function writeTypesGraph(): CollectionConfig[] {
    const profiles = { slug: "profiles", name: "profiles", properties: { id: { type: "number", isId: "increment" } } };
    const comments: Record<string, unknown> = { slug: "comments", name: "comments" };
    const posts = {
        slug: "posts", name: "posts",
        properties: {
            id: { type: "string", isId: "uuid" },
            title: { type: "string", validation: { required: true } },
            moderator: { type: "relation", excludeFromApi: true, relation: { kind: "belongsTo", target: () => authors, localKey: "moderator_id" } },
            reviewer: { type: "relation", access: { write: [] }, relation: { kind: "belongsTo", target: () => authors, localKey: "reviewer_id" } }
        }
    };
    const authors = {
        slug: "authors", name: "authors",
        properties: {
            id: { type: "number", isId: "increment" },
            name: { type: "string", validation: { required: true } },
            profile: { type: "relation", relation: { kind: "hasOne", target: () => profiles, foreignKeyOnTarget: "author_id" } },
            profileVia: {
                type: "relation",
                relation: { kind: "via", cardinality: "one", target: () => profiles, joinPath: [{ table: "profiles", on: { from: "id", to: "author_id" } }] }
            },
            teamProfile: {
                type: "relation",
                relation: {
                    kind: "via", cardinality: "one", target: () => profiles,
                    joinPath: [
                        { table: "teams", on: { from: "team_id", to: "id" } },
                        { table: "profiles", on: { from: "id", to: "team_id" } }
                    ]
                }
            },
            commentsVia: {
                type: "relation",
                relation: {
                    kind: "via", cardinality: "many", target: () => comments,
                    joinPath: [
                        { table: "authors_comments", on: { from: "id", to: "author_id" } },
                        { table: "comments", on: { from: "comment_id", to: "id" } }
                    ]
                }
            },
            roleComments: {
                type: "relation",
                relation: {
                    kind: "via", cardinality: "many", target: () => comments,
                    joinPath: [
                        { table: "author_roles", on: { from: "id", to: "author_id" } },
                        { table: "roles_comments", on: { from: "role_id", to: "role_id" } },
                        { table: "comments", on: { from: "comment_id", to: "id" } }
                    ]
                }
            }
        }
    };
    comments.properties = {
        id: { type: "number", isId: "increment" },
        body: { type: "string", validation: { required: true } },
        post: { type: "relation", validation: { required: true }, relation: { kind: "belongsTo", target: () => posts, localKey: "post_id" } },
        author: { type: "relation", validation: { required: true }, relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" } }
    };
    return loose([authors, comments, posts, profiles]);
}

/**
 * Every set, by name. A function per set, so each run builds fresh objects
 * (the lift caches per collection object, and the generator must not depend
 * on a previous run).
 */
export const LEGACY_FIXTURES: Record<string, () => CollectionConfig[]> = {
    "authors": () => loose([authorsCollection]),
    "basic-types": () => loose([{
        slug: "types_collection", name: "types_collection",
        properties: {
            bool: { type: "boolean" },
            dt: { type: "date" },
            geo: { type: "geopoint" },
            vec: { type: "vector", dimensions: 3 },
            bin: { type: "binary" }
        }
    }]),
    "unknown-property-type": () => loose([{
        slug: "types_collection", name: "types_collection",
        properties: { unknown: { type: "something-weird" } }
    }]),
    "firestore-reference": () => loose([{
        slug: "refs_collection", name: "refs_collection", engine: "firestore",
        properties: { ref: { type: "reference" } }
    }]),
    "string-enum-ids": () => loose([{ slug: "posts", name: "posts", properties: { status: { type: "string", enum: ["draft", "published"] } } }]),
    "string-enum-objects": () => loose([{
        slug: "posts", name: "posts",
        properties: { status: { type: "string", enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }] } }
    }]),
    "string-enum-record": () => loose([{
        slug: "posts", name: "posts",
        properties: { status: { type: "string", enum: { draft: "Draft", published: "Published" } } }
    }]),
    "number-enum-ids": () => loose([{ slug: "posts", name: "posts", properties: { level: { type: "number", enum: [1, 2, 3] } } }]),
    "number-enum-objects": () => loose([{
        slug: "posts", name: "posts",
        properties: { level: { type: "number", enum: [{ id: 10, label: "Low" }, { id: 20, label: "High" }] } }
    }]),
    "number-enum-record": () => loose([{ slug: "posts", name: "posts", properties: { level: { type: "number", enum: { 1: "Low", 2: "High" } } } }]),
    "map-nested": () => loose([{
        slug: "users", name: "users",
        properties: { profile: { type: "map", properties: { age: { type: "number" }, tagline: { type: "string" } } } }
    }]),
    "map-open": () => loose([{ slug: "users", name: "users", properties: { metadata: { type: "map" } } }]),
    "array-of": () => loose([{ slug: "articles", name: "articles", properties: { tags: { type: "array", of: { type: "string" } } } }]),
    "array-open": () => loose([{ slug: "articles", name: "articles", properties: { generic: { type: "array" } } }]),
    "insert-optional": () => loose([{ slug: "books", name: "books", properties: { title: { type: "string" } } }]),
    "insert-required": () => loose([{ slug: "books", name: "books", properties: { title: { type: "string", validation: { required: true } } } }]),
    "day-key": () => loose([{
        name: "Scores", slug: "scores",
        properties: {
            day: { name: "Day", type: "date", columnType: "date", isId: "manual" },
            sid: { name: "Player", type: "string", isId: "manual" }
        }
    }]),
    "database-default": () => loose([{
        slug: "books", name: "books",
        properties: { code: { type: "string", validation: { required: true }, databaseDefault: true } }
    }]),
    "increment-key": () => loose([{ slug: "books", name: "books", properties: { id: { type: "number", isId: "increment", validation: { required: true } } } }]),
    "uuid-key": () => loose([{ slug: "books", name: "books", properties: { id: { type: "string", isId: "uuid", validation: { required: true } } } }]),
    "manual-key": () => loose([{ slug: "books", name: "books", properties: { id: { type: "string", isId: "manual", validation: { required: true } } } }]),
    "true-key": () => loose([{ slug: "books", name: "books", properties: { id: { type: "string", isId: true, validation: { required: true } } } }]),
    "update-optionality": () => loose([{
        slug: "books", name: "books",
        properties: {
            id: { type: "number", isId: "increment", validation: { required: true } },
            title: { type: "string", validation: { required: true } }
        }
    }]),
    ...relationFixtures(),
    ...rowInsertUpdateFixtures(),
    ...excludedFixtures(),
    "slug-order": () => loose([
        { slug: "authors", name: "authors", properties: { name: { type: "string" } } },
        { slug: "articles", name: "articles", properties: { title: { type: "string" } } }
    ]),
    "reserved-accessors": () => loose(["table", "collection", "then", "toJSON", "posts"].map(slug => ({
        slug, name: slug, properties: { title: { type: "string" } }
    }))),
    "realistic": () => {
        const authors = {
            slug: "authors",
            properties: { id: { type: "number", isId: "increment" }, name: { type: "string", validation: { required: true } } }
        };
        return loose([{
            slug: "posts",
            properties: {
                id: { type: "string", isId: "uuid" },
                title: { type: "string", validation: { required: true } },
                status: { type: "string", enum: ["draft", "published"] },
                meta: { type: "map", properties: { views: { type: "number" } } },
                tags: { type: "array", of: { type: "string" } },
                author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
            }
        }, authors]);
    },
    "non-identifier-keys": () => loose([{
        slug: "rows",
        properties: { "user id": { type: "string" }, "order": { type: "number" }, "créé_à": { type: "date" } }
    }]),
    "non-identifier-slug": () => loose([{ slug: "my-notes", properties: { a: { type: "string" } } }]),
    "digit-slug": () => loose([{ slug: "2fa_codes", properties: { id: { type: "string", isId: true } } }]),
    "keyword-names": () => loose([
        { slug: "default", properties: { class: { type: "string" }, function: { type: "number" } } },
        { slug: "import", properties: { a: { type: "string" } } }
    ]),
    "separator-keys": () => loose([{ slug: "posts", properties: { "my-field": { type: "string" }, "my_field": { type: "number" } } }]),
    "enum-escaping": () => loose([{ slug: "posts", properties: { status: { type: "string", enum: ['a"b', "c\\d", "e\nf", "`${x}`"] } } }]),
    "enum-object-key-escaping": () => loose([{ slug: "kinds", properties: { kind: { type: "string", enum: { "a-1": "A one", 'b"2': "B two" } } } }]),
    "hostile-slug": () => loose([{ slug: 'posts", OWNED: globalThis, x: "', properties: { title: { type: "string" } } }]),
    "hostile-enum": () => loose([{
        slug: "posts",
        properties: { status: { type: "string", enum: ['a"; }; }; };\nexport const OWNED = 1;\ninterface I { x: "'] } }
    }]),
    "hostile-key": () => loose([{
        slug: "posts",
        properties: { 'a: string; }; }; };\nexport const OWNED = 1;\ninterface I { b': { type: "string" } }
    }]),
    "hostile-foreign-key": () => loose([{
        slug: "posts",
        properties: { id: { type: "string", isId: "uuid" } },
        relations: [{
            kind: "belongsTo",
            relationName: "author",
            target: () => ({ slug: "authors", properties: { id: { type: "string", isId: "uuid" } } }),
            localKey: 'author_id?: string; }; }; };\nexport const OWNED = 1;\ninterface I { x'
        }]
    }]),
    "include-graph": includeGraph,
    "write-types-graph": writeTypesGraph,
    "unresolvable-relation": () => loose([{
        slug: "posts", name: "Posts", table: "posts",
        properties: { id: { type: "string", isId: true }, title: { type: "string" } },
        relations: [{
            kind: "belongsTo",
            relationName: "author",
            localKey: "author_id",
            target: () => { throw new Error("Cannot access 'users' before initialization"); }
        }]
    }]),
    "resolvable-relation": () => {
        const users = { slug: "users", name: "Users", table: "users", properties: { id: { type: "string", isId: true } } };
        return loose([{
            slug: "posts", name: "Posts", table: "posts",
            properties: { id: { type: "string", isId: true }, title: { type: "string" } },
            relations: [{ kind: "belongsTo", relationName: "author", localKey: "author_id", target: () => users }]
        }, users]);
    }
};
