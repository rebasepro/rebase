/**
 * One collection set with every cell of the property→column matrix in it.
 *
 * Three modules compile a `Property` into a column and they have to agree. The
 * cheapest way to find out that they do not is to hand all three the same
 * exhaustive input and compare, which is what `property-matrix-agreement`,
 * `generated-schema-compiles` and the boot/push parity tests do with this file.
 *
 * Grouped, so that a generator throwing on one group does not hide the others,
 * and so the configurations that are *refused* — an empty enum, a composite
 * primary key, `isId: "cuid"` — can be exercised without poisoning the set the
 * agreement tests walk. Those three are exported on their own and deliberately
 * left out of {@link everything}.
 */
import type { CollectionConfig } from "@rebasepro/types";

const C = (c: unknown): CollectionConfig => c as CollectionConfig;

// ───────────────────────── A. string sub-options ─────────────────────────
export const strProps = C({
    slug: "str_props", table: "str_props", name: "StrProps",
    properties: {
        id: { type: "string", isId: "uuid" },
        plain: { type: "string" },
        req: { type: "string", validation: { required: true } },
        uniq: { type: "string", validation: { unique: true } },
        enumArr: { type: "string", enum: ["a", "b"] },
        enumObj: { type: "string", enum: [{ id: "p", label: "P" }, { id: "q", label: "Q" }] },
        enumReq: { type: "string", enum: ["a", "b"], validation: { required: true } },
        colUuid: { type: "string", columnType: "uuid" },
        colChar: { type: "string", columnType: "char", validation: { max: 3 } },
        colVarchar: { type: "string", columnType: "varchar", validation: { max: 100 } },
        colVarcharNoMax: { type: "string", columnType: "varchar" },
        colText: { type: "string", columnType: "text" },
        maxOnly: { type: "string", validation: { max: 50 } },
        multiline: { type: "string", multiline: true },
        markdown: { type: "string", markdown: true },
        email: { type: "string", email: true },
        url: { type: "string", url: true },
        storage: { type: "string", storage: { storagePath: "uploads" } },
        withDefault: { type: "string", defaultValue: "hello" },
        colName: { type: "string", columnName: "custom_col" },
        readOnly: { type: "string", readOnly: true },
        disabled: { type: "string", disabled: true },
        minMax: { type: "string", validation: { min: 2, max: 10, matches: "^a" } },
        "spaced name": { type: "string" },
        excluded: { type: "string", excludeFromApi: true }
    }
});

// ── Refused configurations. Each one produced a broken database in silence;
//    they live here so a test can assert the refusal, and out of `everything`.
export const emptyEnum = C({ slug: "empty_enum", table: "empty_enum", name: "x", properties: { id: { type: "string", isId: "uuid" }, enumEmpty: { type: "string", enum: [] } } });
export const emptyEnumNumber = C({ slug: "empty_enum_num", table: "empty_enum_num", name: "x", properties: { id: { type: "string", isId: "uuid" }, enumEmpty: { type: "number", enum: [] } } });

// ───────────────────────── B. string id variants ─────────────────────────
export const strIdTrue = C({ slug: "str_id_true", table: "str_id_true", name: "x", properties: { code: { type: "string", isId: true }, v: { type: "string" } } });
export const strIdManual = C({ slug: "str_id_manual", table: "str_id_manual", name: "x", properties: { code: { type: "string", isId: "manual" }, v: { type: "string" } } });
export const strIdCuid = C({ slug: "str_id_cuid", table: "str_id_cuid", name: "x", properties: { id: { type: "string", isId: "cuid" }, v: { type: "string" } } });
export const strIdSql = C({ slug: "str_id_sql", table: "str_id_sql", name: "x", properties: { id: { type: "string", isId: "sql`gen_id()`" }, v: { type: "string" } } });
export const strIdSqlBare = C({ slug: "str_id_sql_bare", table: "str_id_sql_bare", name: "x", properties: { id: { type: "string", isId: "gen_random_uuid()::text" }, v: { type: "string" } } });
export const strIdUuidReqUnique = C({ slug: "str_id_uuid_ru", table: "str_id_uuid_ru", name: "x", properties: { id: { type: "string", isId: "uuid", validation: { required: true, unique: true } }, v: { type: "string" } } });
export const strIdUuidVarchar = C({ slug: "str_id_uuid_vc", table: "str_id_uuid_vc", name: "x", properties: { id: { type: "string", isId: "uuid", columnType: "varchar" }, v: { type: "string" } } });
export const noIdAtAll = C({ slug: "no_id", table: "no_id", name: "x", properties: { v: { type: "string" } } });
export const idNamedButNotFlagged = C({ slug: "id_named", table: "id_named", name: "x", properties: { id: { type: "string" }, v: { type: "string" } } });
export const idNumberNamedButNotFlagged = C({ slug: "id_num_named", table: "id_num_named", name: "x", properties: { id: { type: "number" }, v: { type: "string" } } });

// ───────────────────────── C. number sub-options ─────────────────────────
export const numProps = C({
    slug: "num_props", table: "num_props", name: "NumProps",
    properties: {
        id: { type: "number", isId: "increment" },
        plain: { type: "number" },
        integer: { type: "number", validation: { integer: true } },
        req: { type: "number", validation: { required: true } },
        uniq: { type: "number", validation: { unique: true } },
        ctInteger: { type: "number", columnType: "integer" },
        ctReal: { type: "number", columnType: "real" },
        ctDouble: { type: "number", columnType: "double precision" },
        ctNumeric: { type: "number", columnType: "numeric" },
        ctBigint: { type: "number", columnType: "bigint" },
        ctSerial: { type: "number", columnType: "serial" },
        ctBigserial: { type: "number", columnType: "bigserial" },
        ctSmallint: { type: "number", columnType: "smallint" },
        enumNum: { type: "number", enum: [1, 2, 3] },
        enumNumReal: { type: "number", enum: [1.5, 2.5], columnType: "real" },
        withDefault: { type: "number", defaultValue: 5 },
        minMax: { type: "number", validation: { min: 0, max: 100 } },
        integerReal: { type: "number", validation: { integer: true }, columnType: "real" }
    }
});
export const numIdTrue = C({ slug: "num_id_true", table: "num_id_true", name: "x", properties: { code: { type: "number", isId: true }, v: { type: "string" } } });
export const numIdManual = C({ slug: "num_id_manual", table: "num_id_manual", name: "x", properties: { code: { type: "number", isId: "manual" }, v: { type: "string" } } });
export const numIdSql = C({ slug: "num_id_sql", table: "num_id_sql", name: "x", properties: { id: { type: "number", isId: "sql`nextval('s')`" }, v: { type: "string" } } });
export const numIdIncBigint = C({ slug: "num_id_inc_bigint", table: "num_id_inc_bigint", name: "x", properties: { id: { type: "number", isId: "increment", columnType: "bigint" }, v: { type: "string" } } });
export const numIdIncBigserial = C({ slug: "num_id_inc_bigserial", table: "num_id_inc_bigserial", name: "x", properties: { id: { type: "number", isId: "increment", columnType: "bigserial" }, v: { type: "string" } } });
export const numIdSerial = C({ slug: "num_id_serial", table: "num_id_serial", name: "x", properties: { id: { type: "number", isId: true, columnType: "serial" }, v: { type: "string" } } });
export const numIdIncRequired = C({ slug: "num_id_inc_req", table: "num_id_inc_req", name: "x", properties: { id: { type: "number", isId: "increment", validation: { required: true } }, v: { type: "string" } } });

// ───────────────────────── E. boolean / date / map ─────────────────────────
export const boolDateMap = C({
    slug: "bdm", table: "bdm", name: "bdm",
    properties: {
        b: { type: "boolean" },
        bReq: { type: "boolean", validation: { required: true } },
        bDef: { type: "boolean", defaultValue: true },
        bUniq: { type: "boolean", validation: { unique: true } },
        d: { type: "date" },
        dDate: { type: "date", columnType: "date" },
        dTime: { type: "date", columnType: "time" },
        dTs: { type: "date", columnType: "timestamp" },
        dCreate: { type: "date", autoValue: "on_create" },
        dUpdate: { type: "date", autoValue: "on_update" },
        dCreateReq: { type: "date", autoValue: "on_create", validation: { required: true } },
        dDateCreate: { type: "date", columnType: "date", autoValue: "on_create" },
        dDef: { type: "date", defaultValue: new Date("2020-01-01") },
        dUniq: { type: "date", validation: { unique: true } },
        m: { type: "map" },
        mJson: { type: "map", columnType: "json" },
        mJsonb: { type: "map", columnType: "jsonb" },
        mReq: { type: "map", validation: { required: true } },
        mDef: { type: "map", defaultValue: { a: 1 } },
        mProps: { type: "map", properties: { a: { type: "string" }, n: { type: "number" } } },
        mUniq: { type: "map", validation: { unique: true } }
    }
});

// ───────────────────────── F. arrays ─────────────────────────
export const arrays = C({
    slug: "arrs", table: "arrs", name: "arrs",
    properties: {
        ofString: { type: "array", of: { type: "string" } },
        ofNumber: { type: "array", of: { type: "number" } },
        ofInteger: { type: "array", of: { type: "number", validation: { integer: true } } },
        ofBigint: { type: "array", of: { type: "number", columnType: "bigint" } },
        ofBoolean: { type: "array", of: { type: "boolean" } },
        ofEnum: { type: "array", of: { type: "string", enum: ["a", "b"] } },
        ofUuid: { type: "array", of: { type: "string", columnType: "uuid" } },
        ofDate: { type: "array", of: { type: "date" } },
        ofMap: { type: "array", of: { type: "map", properties: { a: { type: "string" } } } },
        ofReference: { type: "array", of: { type: "reference", path: "str_props" } },
        ofGeopoint: { type: "array", of: { type: "geopoint" } },
        ofTuple: { type: "array", of: [{ type: "string" }, { type: "number" }] },
        noOf: { type: "array" },
        ctJson: { type: "array", columnType: "json", of: { type: "string" } },
        ctJsonb: { type: "array", columnType: "jsonb", of: { type: "string" } },
        ctTextArr: { type: "array", columnType: "text[]" },
        ctIntArr: { type: "array", columnType: "integer[]" },
        ctBoolArr: { type: "array", columnType: "boolean[]" },
        ctNumArr: { type: "array", columnType: "numeric[]" },
        req: { type: "array", of: { type: "string" }, validation: { required: true } },
        uniq: { type: "array", of: { type: "string" }, validation: { unique: true } },
        withDefault: { type: "array", of: { type: "string" }, defaultValue: ["x"] },
        minMax: { type: "array", of: { type: "string" }, validation: { min: 1, max: 5, uniqueInArray: true } }
    }
});

// ───────────────────────── G. geopoint / vector / binary ─────────────────────────
export const misc = C({
    slug: "misc", table: "misc", name: "misc",
    properties: {
        geo: { type: "geopoint" },
        geoReq: { type: "geopoint", validation: { required: true } },
        geoDef: { type: "geopoint", defaultValue: { latitude: 1, longitude: 2 } },
        vec: { type: "vector", dimensions: 3 },
        vecReq: { type: "vector", dimensions: 3, validation: { required: true } },
        vecIdx: { type: "vector", dimensions: 4, index: { method: "hnsw", distance: "cosine" } },
        vecWide: { type: "vector", dimensions: 3000 },
        vecUniq: { type: "vector", dimensions: 3, validation: { unique: true } },
        bin: { type: "binary" },
        binReq: { type: "binary", validation: { required: true } },
        binUniq: { type: "binary", validation: { unique: true } }
    }
});

// ───────────────────────── H. references ─────────────────────────
export const uuidTarget = C({ slug: "uuid_target", table: "uuid_target", name: "x", properties: { id: { type: "string", isId: "uuid" }, v: { type: "string" } } });
export const intTarget = C({ slug: "int_target", table: "int_target", name: "x", properties: { id: { type: "number", isId: "increment" }, v: { type: "string" } } });
export const textTarget = C({ slug: "text_target", table: "text_target", name: "x", properties: { code: { type: "string", isId: true }, v: { type: "string" } } });
export const refs = C({
    slug: "refs", table: "refs", name: "refs",
    properties: {
        toUuid: { type: "reference", path: "uuid_target" },
        toInt: { type: "reference", path: "int_target" },
        toText: { type: "reference", path: "text_target" },
        toUnknown: { type: "reference", path: "nope" },
        toUuidReq: { type: "reference", path: "uuid_target", validation: { required: true } },
        toIntUniq: { type: "reference", path: "int_target", validation: { unique: true } },
        toUuidDef: { type: "reference", path: "uuid_target", defaultValue: { id: "x", path: "uuid_target" } },
        toUuidCol: { type: "reference", path: "uuid_target", columnName: "custom_ref" }
    }
});

// ───────────────────────── I. relations ─────────────────────────
export const authors: CollectionConfig = C({
    slug: "authors", table: "authors", name: "Authors",
    properties: {
        id: { type: "string", isId: "uuid" },
        name: { type: "string" },
        posts: { type: "relation", relationName: "posts" },
        profile: { type: "relation", relationName: "profile" },
        commentsVia: { type: "relation", relationName: "commentsVia" }
    },
    relations: [
        { kind: "hasMany", relationName: "posts", target: () => posts, foreignKeyOnTarget: "author_id" },
        { kind: "hasOne", relationName: "profile", target: () => profiles, foreignKeyOnTarget: "author_id" },
        { kind: "via", relationName: "commentsVia", target: () => comments, path: [{ to: () => posts, foreignKeyOnTarget: "author_id" }, { to: () => comments, foreignKeyOnTarget: "post_id" }] }
    ]
});
export const profiles: CollectionConfig = C({
    slug: "profiles", table: "profiles", name: "Profiles",
    properties: {
        id: { type: "string", isId: "uuid" },
        bio: { type: "string" },
        author: { type: "relation", relationName: "author", validation: { required: true } }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => authors, localKey: "author_id" }
    ]
});
export const posts: CollectionConfig = C({
    slug: "posts", table: "posts", name: "Posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        author: { type: "relation", relationName: "author", validation: { required: true } },
        editor: { type: "relation", relationName: "editor" },
        parent: { type: "relation", relationName: "parent" },
        comments: { type: "relation", relationName: "comments" },
        tags: { type: "relation", relationName: "tags" }
    },
    relations: [
        { kind: "belongsTo", relationName: "author", target: () => authors, localKey: "author_id", onDelete: "cascade", onUpdate: "cascade" },
        { kind: "belongsTo", relationName: "editor", target: () => authors, localKey: "editor_id" },
        { kind: "belongsTo", relationName: "parent", target: () => posts, localKey: "parent_id", onDelete: "set null" },
        { kind: "hasMany", relationName: "comments", target: () => comments, foreignKeyOnTarget: "post_id" },
        { kind: "manyToMany", relationName: "tags", target: () => tags, through: { table: "post_tags", sourceColumn: "post_id", targetColumn: "tag_id" }, onDelete: "restrict" }
    ]
});
export const comments: CollectionConfig = C({
    slug: "comments", table: "comments", name: "Comments",
    properties: {
        id: { type: "string", isId: "uuid" },
        body: { type: "string" },
        // explicit FK property AND relation, camelCase key with columnName
        postId: { type: "number", columnName: "post_id", validation: { integer: true } },
        post: { type: "relation", relationName: "post" }
    },
    relations: [
        { kind: "belongsTo", relationName: "post", target: () => posts, localKey: "post_id", onDelete: "cascade" }
    ]
});
export const tags: CollectionConfig = C({
    slug: "tags", table: "tags", name: "Tags",
    properties: {
        id: { type: "string", isId: "uuid" },
        label: { type: "string" },
        posts: { type: "relation", relationName: "posts" }
    },
    relations: [
        { kind: "manyToMany", relationName: "posts", target: () => posts, through: { table: "post_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
    ]
});
// Relation with no explicit localKey (derived) and a relation property carrying columnName
export const derivedFk: CollectionConfig = C({
    slug: "derived_fk", table: "derived_fk", name: "x",
    properties: {
        id: { type: "string", isId: "uuid" },
        category: { type: "relation", relationName: "category", columnName: "cat_ref" }
    },
    relations: [
        { kind: "belongsTo", relationName: "category", target: () => tags }
    ]
});

// ───────────────────────── N. record-form enums (separate: ensure throws on them) ─────────────────────────
export const strEnumRec = C({ slug: "str_enum_rec", table: "str_enum_rec", name: "x", properties: { id: { type: "string", isId: "uuid" }, enumRec: { type: "string", enum: { x: "X", y: "Y" } } } });
export const numEnumRec = C({ slug: "num_enum_rec", table: "num_enum_rec", name: "x", properties: { id: { type: "number", isId: "increment" }, enumNumRec: { type: "number", enum: { 10: "Ten", 20: "Twenty" } } } });
// ───────────────────────── O. builders whose import is conditional ─────────────────────────
export const uuidOnly = C({ slug: "uuid_only", table: "uuid_only", name: "x", properties: { id: { type: "number", isId: "increment" }, ext: { type: "string", columnType: "uuid" } } });
export const smallintOnly = C({ slug: "smallint_only", table: "smallint_only", name: "x", properties: { id: { type: "number", isId: "increment" }, small: { type: "number", columnType: "smallint" } } });

// ───────────────────────── J. composite PK ─────────────────────────
export const composite = C({
    slug: "composite", table: "composite", name: "x",
    properties: {
        tenant: { type: "string", isId: true },
        code: { type: "number", isId: true },
        v: { type: "string" }
    }
});

// ───────────────────────── K. custom schema + cross-schema FK ─────────────────────────
export const appSchema = C({
    slug: "app_items", table: "app_items", name: "x", schema: "app",
    properties: {
        id: { type: "string", isId: "uuid" },
        status: { type: "string", enum: ["on", "off"] },
        owner: { type: "relation", relationName: "owner", validation: { required: true } },
        ref: { type: "reference", path: "uuid_target" }
    },
    relations: [
        { kind: "belongsTo", relationName: "owner", target: () => uuidTarget, localKey: "owner_id" }
    ]
});

// ───────────────────────── L. indexes ─────────────────────────
export const indexed = C({
    slug: "indexed", table: "indexed", name: "x",
    properties: {
        id: { type: "string", isId: "uuid" },
        ownerId: { type: "string" },
        createdAt: { type: "date", autoValue: "on_create" },
        status: { type: "string", enum: ["draft", "live"] },
        meta: { type: "map" },
        email: { type: "string" }
    },
    indexes: [
        { on: ["ownerId", { prop: "createdAt", direction: "desc" }], reason: "owner timeline" },
        { on: ["email"], unique: true, reason: "one account per email" },
        { on: ["ownerId"], where: { prop: "status", op: "=", value: "live" }, reason: "live only" },
        { using: "gin", on: ["meta"], reason: "json lookups" },
        { on: ["createdAt"], include: ["status"], reason: "covering" }
    ]
});

// ───────────────────────── M. search block ─────────────────────────
export const searched = C({
    slug: "searched", table: "searched", name: "x",
    properties: {
        id: { type: "string", isId: "uuid" },
        title: { type: "string" },
        body: { type: "string" }
    },
    search: { fields: ["title", "body"], fuzzy: true }
});

export const groups: Record<string, CollectionConfig[]> = {
    strProps: [strProps],
    strIds: [strIdTrue, strIdManual, strIdSql, strIdSqlBare, strIdUuidReqUnique, strIdUuidVarchar, noIdAtAll, idNamedButNotFlagged, idNumberNamedButNotFlagged],
    numProps: [numProps],
    numIds: [numIdTrue, numIdManual, numIdSql, numIdIncBigint, numIdIncBigserial, numIdSerial, numIdIncRequired],
    boolDateMap: [boolDateMap],
    arrays: [arrays, strProps],
    misc: [misc],
    refs: [refs, uuidTarget, intTarget, textTarget],
    relations: [authors, profiles, posts, comments, tags, derivedFk],
    enumRec: [strEnumRec, numEnumRec],
    uuidOnly: [uuidOnly],
    smallintOnly: [smallintOnly],
    appSchema: [appSchema, uuidTarget],
    indexed: [indexed],
    searched: [searched]
};

/**
 * Every collection the three emitters must agree on, deduplicated.
 *
 * The refused configurations are not here — they have no correct column for the
 * emitters to agree about. Each is exported on its own above:
 * {@link emptyEnum}, {@link emptyEnumNumber}, {@link composite}, {@link strIdCuid}.
 */
export const everything: CollectionConfig[] = Array.from(new Set(Object.values(groups).flat()));

/** The configurations every emitter refuses, with what each one is testing. */
export const refused: { collection: CollectionConfig; because: RegExp }[] = [
    { collection: emptyEnum, because: /empty `enum`/ },
    { collection: emptyEnumNumber, because: /empty `enum`/ },
    { collection: composite, because: /Composite primary keys/ },
    { collection: strIdCuid, because: /cuid/ }
];
