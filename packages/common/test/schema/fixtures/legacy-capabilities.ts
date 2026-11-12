/**
 * Hand-written legacy collections covering every row of the Property → plan
 * table (`.rebase-audits` `pg-schema.md` §3.2) and every collection-level
 * field the planner reads (§3.1), for the bridge round trip.
 *
 * Written in the *canonical* legacy form — the one `lowerTables` produces when
 * the planner gives two spellings the same column (an enum's values as
 * `{ id, label }` entries, a native array naming its `columnType` and its
 * `of`, relations in `relations` addressed by name from a relation property,
 * a `varchar`'s length in `validation.max` unless it is 255…) — so the round
 * trip can be compared by deep equality. What the round trip deliberately
 * ignores is listed beside the test, not here.
 */
import type {
    CollectionCallbacks,
    PostgresCollectionConfig,
    PostgresProperty,
    PropertyCallbacks,
    SecurityRule
} from "@rebasepro/types";

/** A `columnType` the planner reads and the legacy union never named (`smallint`, `smallserial`). */
export function withColumnType<P extends PostgresProperty>(property: P, columnType: string): P {
    Reflect.set(property, "columnType", columnType);
    return property;
}

/** A date default as the string the planner reads, which the legacy `Date` type cannot hold for a `time`. */
export function withDateDefault<P extends PostgresProperty>(property: P, value: string): P {
    Reflect.set(property, "defaultValue", value);
    return property;
}

export const readCallbacks: CollectionCallbacks = {
    afterRead: ({ row }) => ({ ...row, masked: true })
};

export const trimCallbacks: PropertyCallbacks = {
    beforeSave: ({ value }) => (typeof value === "string" ? value.trim() : value)
};

export const DOCUMENT_RULES: SecurityRule[] = [
    { operation: "select", access: "public" },
    { name: "documents_owner_write", operations: ["insert", "update", "delete"], ownerField: "ownerId" }
];

export const tags: PostgresCollectionConfig = {
    slug: "tags",
    name: "tags",
    table: "tags",
    properties: {
        id: { type: "string", isId: "uuid" },
        label: { type: "string" }
    }
};

export const authors: PostgresCollectionConfig = {
    slug: "authors",
    name: "authors",
    table: "authors",
    properties: {
        id: { type: "string", isId: "uuid" },
        name: { type: "string", validation: { required: true } },
        // Field rules on relation properties: per-role access, and kept off the wire.
        posts: { type: "relation", access: { read: ["admin", "editor"], write: ["admin"] } },
        profile: { type: "relation", excludeFromApi: true }
    },
    relations: [
        { kind: "hasMany", relationName: "posts", target: () => posts, foreignKeyOnTarget: "author_id" },
        { kind: "hasOne", relationName: "profile", target: () => profiles, foreignKeyOnTarget: "author_id", sourceKey: "id" }
    ]
};

export const profiles: PostgresCollectionConfig = {
    slug: "profiles",
    name: "profiles",
    table: "profiles",
    properties: {
        id: { type: "number", isId: "increment" },
        bio: { type: "string" },
        author: { type: "relation", validation: { required: true, unique: true } }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => authors, localKey: "author_id" }
    ]
};

export const posts: PostgresCollectionConfig = {
    slug: "posts",
    name: "posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        // The relation-property form: the foreign key is planned here.
        author: { type: "relation", validation: { required: true }, access: { write: ["admin"] } },
        // The explicit-FK form: `editorId` owns the column, `editor` its constraint.
        editor: { type: "relation", excludeFromApi: true },
        editorId: { type: "string", columnType: "uuid", description: "Who edited it last" },
        tags: { type: "relation", access: { read: ["editor"], write: [] } },
        tagsVia: { type: "relation", access: { read: ["admin"] } }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => authors, localKey: "author_id", onDelete: "cascade", onUpdate: "cascade" },
        { kind: "belongsTo", relationName: "editor", target: () => authors, localKey: "editor_id", index: false },
        {
            kind: "manyToMany",
            relationName: "tags",
            target: () => tags,
            through: {
                table: "post_tags",
                sourceColumn: "post_id",
                targetColumn: "tag_id",
                properties: { position: { type: "number", columnType: "integer" } }
            },
            onDelete: "cascade"
        },
        {
            kind: "via",
            relationName: "tagsVia",
            target: () => tags,
            cardinality: "many",
            joinPath: [
                { table: "post_tags", on: { from: "id", to: "post_id" } },
                { table: "tags", on: { from: "tag_id", to: "id" } }
            ]
        }
    ]
};

/** Every column kind and option, on one table. */
export const everything: PostgresCollectionConfig = {
    slug: "everything",
    name: "everything",
    table: "everything",
    properties: {
        id: { type: "string", isId: "uuid" },
        // ── strings
        status: { type: "string", enum: [{ id: "draft", label: "draft" }, { id: "live", label: "live" }], validation: { required: true }, defaultValue: "draft" },
        uuidCol: { type: "string", columnType: "uuid" },
        vc: { type: "string", columnType: "varchar", validation: { max: 100 } },
        vcDefault: { type: "string", columnType: "varchar" },
        vc255: { type: "string", columnType: "varchar", validation: { max: 255 } },
        ch: { type: "string", columnType: "char", validation: { max: 3 } },
        title: {
            type: "string",
            validation: { required: true, requiredMessage: "A title, please", min: 2, max: 200, matches: "^[A-Z]", matchesMessage: "Capitalise it", trim: true },
            defaultValue: "Untitled",
            description: "The title",
            callbacks: trimCallbacks
        },
        code: { type: "string", validation: { matches: /^x+$/i, length: 4, lowercase: true, uppercase: false } },
        contact: { type: "string", email: true, url: true, validation: { unique: true } },
        file: {
            type: "string",
            storage: {
                storagePath: "files/",
                storageSource: "media",
                acceptedFiles: ["image/*"],
                maxSize: 1024,
                imageResize: { maxWidth: 10, mode: "cover" },
                public: true,
                fileName: "{file}",
                metadata: { cache: "1d" },
                includeBucketUrl: false,
                storeUrl: true
            }
        },
        createdBy: { type: "string", autoValue: "user_on_create" },
        updatedBy: { type: "string", autoValue: "user_on_update", columnType: "uuid" },
        assignee: { type: "string", userSelect: true },
        reviewer: { type: "string", columnType: "uuid", userSelect: true, autoValue: "user_on_create" },
        secret: { type: "string", excludeFromApi: true },
        hrNote: { type: "string", access: { read: ["hr"], write: ["hr"] } },
        dbOwned: { type: "string", databaseDefault: true },
        shortId: { type: "string", databaseDefault: "sql`gen_short_id()`" },
        renamed: { type: "string", columnName: "renamed_col" },
        // ── numbers
        salary: { type: "number", access: { read: ["hr"], write: [] } },
        count: { type: "number", validation: { integer: true, min: 0 } },
        small: withColumnType<PostgresProperty>({ type: "number" }, "smallint"),
        smallSerial: withColumnType<PostgresProperty>({ type: "number" }, "smallserial"),
        big: { type: "number", columnType: "bigint" },
        ser: { type: "number", columnType: "serial" },
        bigSer: { type: "number", columnType: "bigserial" },
        r: { type: "number", columnType: "real" },
        dp: { type: "number", columnType: "double precision" },
        intCol: { type: "number", columnType: "integer", defaultValue: 3 },
        money: { type: "number", precision: 10, scale: 2 },
        numericInt: { type: "number", columnType: "numeric", validation: { integer: true } },
        rating: { type: "number", enum: [{ id: 1, label: "1" }, { id: 2, label: "2" }] },
        bounded: { type: "number", validation: { lessThan: 10, moreThan: 1, positive: true, negative: false, max: 9 } },
        // ── boolean
        active: { type: "boolean", defaultValue: true, validation: { required: true } },
        // ── dates
        day: withDateDefault<PostgresProperty>({ type: "date", columnType: "date" }, "2024-12-25"),
        at: withDateDefault<PostgresProperty>({ type: "date", columnType: "time" }, "09:00"),
        createdAt: { type: "date", autoValue: "on_create" },
        updatedAt: { type: "date", autoValue: "on_update", validation: { required: true } },
        windowed: { type: "date", validation: { min: new Date("2020-01-01T00:00:00.000Z"), max: new Date("2030-01-01T00:00:00.000Z") } },
        // ── documents
        meta: { type: "map" },
        metaJson: { type: "map", columnType: "json" },
        address: {
            type: "map",
            properties: {
                street: { type: "string", validation: { required: true, max: 80 } },
                zip: { type: "number", enum: [{ id: 1, label: "1" }] },
                verified: { type: "boolean", defaultValue: false },
                since: { type: "date", autoValue: "on_create" },
                checkedBy: { type: "string", autoValue: "user_on_update" },
                approver: { type: "string", userSelect: true },
                spot: { type: "geopoint" },
                lines: { type: "array", of: { type: "string" }, validation: { max: 3 } },
                // Unique items in a nested array: its `uniqueItems`.
                refs: { type: "array", of: { type: "string" }, validation: { uniqueInArray: true } },
                avatar: { type: "string", storage: { storagePath: "avatars/" } }
            }
        },
        bag: { type: "map", keyValue: true },
        mapDefault: { type: "map", defaultValue: { a: 1 } },
        geo: { type: "geopoint", defaultValue: { latitude: 1, longitude: 2 } },
        // ── arrays
        labels: { type: "array", columnType: "text[]", of: { type: "string" } },
        watchers: { type: "array", columnType: "text[]", of: { type: "string", userSelect: true } },
        codes: { type: "array", columnType: "text[]", of: { type: "string", enum: [{ id: "x", label: "x" }], validation: { max: 4 } } },
        nums: { type: "array", columnType: "integer[]", of: { type: "number", validation: { integer: true } } },
        flags: { type: "array", columnType: "boolean[]", of: { type: "boolean" } },
        amounts: { type: "array", columnType: "numeric[]", of: { type: "number" }, defaultValue: [1, 2] },
        photos: { type: "array", columnType: "text[]", of: { type: "string", storage: { storagePath: "photos/" } } },
        limited: { type: "array", columnType: "text[]", of: { type: "string" }, validation: { required: true, min: 1, max: 3 } },
        // `uniqueInArray` on the array: `uniqueItems`; on a field of its object items: `uniqueBy`.
        distinctTags: { type: "array", columnType: "text[]", of: { type: "string" }, validation: { uniqueInArray: true } },
        lineItems: {
            type: "array",
            columnType: "jsonb",
            of: { type: "map", properties: { sku: { type: "string", validation: { uniqueInArray: true } }, qty: { type: "number" } } }
        },
        events: { type: "array", columnType: "jsonb", of: { type: "date" } },
        docs: { type: "array", columnType: "json", of: { type: "map", properties: { a: { type: "string" } } } },
        blocks: {
            type: "array",
            columnType: "jsonb",
            oneOf: {
                properties: { text: { type: "string" }, image: { type: "string", storage: { storagePath: "img/" } } },
                typeField: "kind"
            }
        },
        anything: { type: "array", columnType: "jsonb" },
        // ── vectors, binary
        embedding: { type: "vector", dimensions: 3, index: { method: "hnsw", distance: ["cosine", "inner_product"], m: 16, efConstruction: 64 } },
        rough: { type: "vector", dimensions: 3, index: { method: "ivfflat", distance: "l2", lists: 10 } },
        unindexed: { type: "vector", dimensions: 3, index: false, validation: { required: true } },
        blob: { type: "binary", validation: { unique: true } }
    }
};

/** No key: the planner's implicit `id`. */
export const notes: PostgresCollectionConfig = {
    slug: "notes",
    name: "notes",
    table: "notes",
    properties: { body: { type: "string" } }
};

/** A composite key, in declaration order. */
export const translations: PostgresCollectionConfig = {
    slug: "translations",
    name: "translations",
    table: "translations",
    properties: {
        locale: { type: "string", isId: true },
        key: { type: "string", isId: "sql`gen_key()`" },
        value: { type: "string" }
    }
};

/** The auth table. */
export const users: PostgresCollectionConfig = {
    slug: "users",
    name: "users",
    table: "users",
    auth: {
        enabled: true,
        roles: { editor: { name: "Editor", scopes: ["posts:write"] } },
        personalKeys: true
    },
    properties: {
        id: { type: "string", isId: "uuid" },
        email: { type: "string", validation: { required: true, unique: true } }
    }
};

/** A materialized view. */
export const postTitles: PostgresCollectionConfig = {
    slug: "post_titles",
    name: "post_titles",
    table: "post_titles",
    view: { query: "SELECT id, title FROM posts", materialized: true, roles: ["admin", "editor"] },
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" }
    },
    indexes: [{ on: ["title"], reason: "titles by name" }]
};

/** Every collection-level field the planner reads. */
export const documents: PostgresCollectionConfig = {
    slug: "documents",
    name: "documents",
    table: "documents_table",
    schema: "docs",
    dataSource: "analytics",
    description: "Shared documents",
    metadata: { owner: "docs-team" },
    properties: {
        id: { type: "string", isId: "uuid" },
        orgId: { type: "string", validation: { required: true } },
        ownerId: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        meta: { type: "map" },
        deletedAt: { type: "date" }
    },
    securityRules: DOCUMENT_RULES,
    disableDefaultPolicies: true,
    tenant: { field: "orgId", from: { claim: "org_id" }, bypassRoles: ["admin", "support"] },
    softDelete: { field: "deletedAt" },
    history: true,
    strictWrites: false,
    search: { fields: ["title", "body"], language: "english" },
    indexes: [
        {
            on: ["orgId", { prop: "title", direction: "desc", nulls: "last" }],
            unique: true,
            include: ["body"],
            where: { and: [{ prop: "deletedAt", op: "is null" }, { prop: "title", op: "in", value: ["a", "b"] }] },
            reason: "titles per organisation"
        },
        { using: "gin", on: ["meta"], reason: "metadata lookups" },
        { using: "brin", on: ["deletedAt"], reason: "trash scans" }
    ],
    callbacks: readCallbacks
};

export const ALL: PostgresCollectionConfig[] = [tags, authors, profiles, posts, everything, notes, translations, users, postTitles, documents];
