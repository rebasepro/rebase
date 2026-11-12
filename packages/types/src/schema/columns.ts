import type { ColumnKind, ColumnType, NumericColumnKind, TemporalColumnKind, TextColumnKind } from "./column_type";
import type {
    ArrayValidation,
    BaseValidation,
    ColumnAccess,
    ColumnDefault,
    ColumnStamp,
    ColumnStorage,
    ColumnValidation,
    DateValidation,
    NumberValidation,
    StorageOptions,
    StringValidation,
    ValidationInput,
    VectorIndexOptions
} from "./column_options";
import { normalizeColumnAccess, normalizeStorage, normalizeValidation } from "./column_options";
import type { ColumnTransform } from "./hooks";
import type { JsonField, JsonGeoPoint, JsonKind, JsonShapeDef } from "./json";

/**
 * Everything a column builder has been told, as data.
 *
 * Wire-safe except for `transform` and the hooks inside `json`, which stay on
 * the server.
 *
 * @group Schema
 */
export interface ColumnDef {
    /** The Postgres type. */
    type: ColumnType;
    /** The SQL column name, when it is not the snake_case of the key. */
    column?: string;
    notNull: boolean;
    primaryKey: boolean;
    unique: boolean;
    default?: ColumnDefault;
    /** `GENERATED ALWAYS AS (<expression>) STORED`. */
    generatedAs?: string;
    readOnly: boolean;
    private: boolean;
    access?: ColumnAccess;
    stamp?: ColumnStamp;
    validate?: ColumnValidation;
    oneOf?: readonly (string | number)[];
    description?: string;
    storage?: ColumnStorage;
    /**
     * A meaning the Postgres type does not state: `"geopoint"` (`col.geopoint()`,
     * a `jsonb` point) or `"user"` (`.userId()`, a text or uuid column holding a
     * user's id).
     */
    semantic?: "geopoint" | "user";
    vectorIndex?: VectorIndexOptions | false;
    /** The shape of a `json`/`jsonb` document. */
    json?: JsonShapeDef;
    /** For an array column: the definition of each item. */
    element?: ColumnDef;
    /** Field-level hooks. Server only. */
    transform?: ColumnTransform;
}

/**
 * The type-level tag of a builder. A {@link ColumnKind}, or one of the two
 * builders whose meaning the Postgres type alone does not state.
 */
export type BuilderKind = ColumnKind | "storage" | "geopoint";

/**
 * What the type system tracks about a column besides its data type.
 *
 * @group Schema
 */
export interface ColumnFlags {
    /** `NOT NULL`: never `null` on a row, required on create unless it has a default. */
    notNull: boolean;
    /** A create may omit it. */
    hasDefault: boolean;
    /** Clients may write it. */
    writable: boolean;
    /** It is served on the wire. */
    exposed: boolean;
    /** Part of the primary key. */
    primaryKey: boolean;
}

/** The flags of a column no modifier has touched: nullable, required-by-nobody, writable, served. */
export interface InitialColumnFlags extends ColumnFlags {
    notNull: false;
    hasDefault: false;
    writable: true;
    exposed: true;
    primaryKey: false;
}

/**
 * The value a column's `.transform()` hooks receive and return: the column's
 * type, plus `null` while the column is nullable.
 *
 * Read from the flags at the point `.transform()` is called, so the order of
 * the chain matters: `.notNull().transform(…)` (or `.primaryKey()` first)
 * receives `TData`; `.transform(…).notNull()` was typed before the column
 * became `NOT NULL` and keeps receiving `TData | null`. Write `.notNull()`
 * first.
 *
 * @group Schema
 */
export type ColumnTransformValue<TData, F extends ColumnFlags> = F["notNull"] extends true ? TData : TData | null;

type SetFlag<F extends ColumnFlags, K extends keyof ColumnFlags, V extends boolean> = {
    [P in keyof ColumnFlags]: P extends K ? V : F[P]
};

type WithDefault<F extends ColumnFlags> = SetFlag<F, "hasDefault", true>;

/** The rules `.validate()` accepts for a kind of column. */
export type ValidationFor<K extends BuilderKind> =
    K extends TextColumnKind | "storage" ? StringValidation :
    K extends NumericColumnKind ? NumberValidation :
    K extends TemporalColumnKind ? DateValidation :
    K extends "array" ? ArrayValidation :
    BaseValidation;

/** The value `.default()` accepts: what the column holds; a `Date` too, for a temporal column. */
export type DefaultValueFor<TData, K extends BuilderKind> = K extends TemporalColumnKind ? TData | Date : TData;

const STAMP_METHODS: Record<string, string> = {
    "create:now": ".onCreateNow",
    "update:now": ".onUpdateNow",
    "create:user": ".onCreateUser",
    "update:user": ".onUpdateUser"
};

/** The brand every column builder carries, so one built by another copy of this package is still recognised. */
export const COLUMN_BRAND = "rebase.column";

const baseDef = (type: ColumnType): ColumnDef => ({
    type,
    notNull: false,
    primaryKey: false,
    unique: false,
    readOnly: false,
    private: false
});

/**
 * One column of a table: `col.text()`, `col.uuid().primaryKey()`, ….
 *
 * Immutable — every modifier returns a new builder — so a column can be shared
 * between tables. Columns are nullable until `.notNull()` or `.primaryKey()`
 * says otherwise, as in SQL.
 *
 * @typeParam TData The TypeScript type of a value on the wire.
 * @typeParam TKind Which builder made it; decides which modifiers apply.
 * @typeParam F What has been said about it so far.
 *
 * @group Schema
 */
export class ColumnBuilder<TData, TKind extends BuilderKind = BuilderKind, F extends ColumnFlags = InitialColumnFlags> {

    /** Type-level only: the TypeScript type of a value. */
    declare readonly $data: TData;
    /** Type-level only: the builder kind. */
    declare readonly $kind: TKind;
    /** Type-level only: the flags. */
    declare readonly $flags: F;

    readonly brand = COLUMN_BRAND;

    constructor(
        /** Everything this column has been told. */
        readonly def: ColumnDef
    ) {}

    private with<D, K extends BuilderKind, G extends ColumnFlags>(patch: Partial<ColumnDef>): ColumnBuilder<D, K, G> {
        return new ColumnBuilder<D, K, G>({ ...this.def, ...patch });
    }

    /**
     * The patch that sets a stamp, refusing a second, different one: a column
     * holds one stamp, so `.onCreateNow().onUpdateNow()` would otherwise keep
     * whichever came last without a word.
     */
    private stamped(stamp: ColumnStamp, method: string): Partial<ColumnDef> {
        const current = this.def.stamp;
        if (current && (current.on !== stamp.on || current.value !== stamp.value)) {
            throw new Error(
                `\`.${method}()\` on a column that already has \`${STAMP_METHODS[`${current.on}:${current.value}`]}()\`: a column ` +
                "holds one stamp. `.onUpdateNow()` alone also stamps the row when it is created."
            );
        }
        return { stamp };
    }

    // ── Every column ─────────────────────────────────────────────────────

    /**
     * The SQL column name. Without it the column is the snake_case of the key,
     * and the key stays the name on the JSON row and in the SDK.
     */
    column(name: string): ColumnBuilder<TData, TKind, F> {
        return this.with<TData, TKind, F>({ column: name });
    }

    /** `NOT NULL`. The API requires the column on create unless it has a default. */
    notNull(): ColumnBuilder<TData, TKind, SetFlag<F, "notNull", true>> {
        return this.with<TData, TKind, SetFlag<F, "notNull", true>>({ notNull: true });
    }

    /**
     * Part of the primary key. Several columns marked this way form a composite
     * key, in declaration order.
     */
    primaryKey(): ColumnBuilder<TData, TKind, SetFlag<SetFlag<F, "notNull", true>, "primaryKey", true>> {
        return this.with<TData, TKind, SetFlag<SetFlag<F, "notNull", true>, "primaryKey", true>>({
            primaryKey: true,
            notNull: true
        });
    }

    /** A single-column `UNIQUE` constraint. */
    unique(): ColumnBuilder<TData, TKind, F> {
        return this.with<TData, TKind, F>({ unique: true });
    }

    /**
     * A default value: written as the column's DDL default and applied by the
     * driver on create, so a row comes out the same whoever inserts it.
     */
    default(value: DefaultValueFor<TData, TKind>): ColumnBuilder<TData, TKind, WithDefault<F>> {
        const stored = value instanceof Date ? value.toISOString() : value;
        return this.with<TData, TKind, WithDefault<F>>({ default: { kind: "literal", value: stored } });
    }

    /** A default Postgres evaluates: `.defaultSql("gen_short_id()")`. */
    defaultSql(expression: string): ColumnBuilder<TData, TKind, WithDefault<F>> {
        return this.with<TData, TKind, WithDefault<F>>({ default: { kind: "sql", expression } });
    }

    /**
     * The database already holds a default for this column that Rebase does not
     * state. A create may omit the column, and a schema push leaves the default
     * alone.
     */
    dbDefault(): ColumnBuilder<TData, TKind, WithDefault<F>> {
        return this.with<TData, TKind, WithDefault<F>>({ default: { kind: "database" } });
    }

    /** `GENERATED ALWAYS AS (<expression>) STORED`. Nobody writes it. */
    generatedAs(expression: string): ColumnBuilder<TData, TKind, SetFlag<WithDefault<F>, "writable", false>> {
        return this.with<TData, TKind, SetFlag<WithDefault<F>, "writable", false>>({
            generatedAs: expression,
            readOnly: true
        });
    }

    /**
     * Client writes are refused on create and update. The database (a default,
     * a trigger) and the server's own code still fill it.
     */
    readOnly(): ColumnBuilder<TData, TKind, SetFlag<F, "writable", false>> {
        return this.with<TData, TKind, SetFlag<F, "writable", false>>({ readOnly: true });
    }

    /**
     * Never leaves the server: absent from every row on the wire, from the SDK
     * and from OpenAPI, and refused in filters and sorts. Hooks and server code
     * still see it.
     */
    private(): ColumnBuilder<TData, TKind, SetFlag<SetFlag<F, "exposed", false>, "writable", false>> {
        return this.with<TData, TKind, SetFlag<SetFlag<F, "exposed", false>, "writable", false>>({ private: true });
    }

    /**
     * Who may read and who may write the column, by role. Enforced on every
     * door into the table, not only in the panel. `read` and `write` are lists
     * of role names; anything else throws.
     */
    access(access: ColumnAccess): ColumnBuilder<TData, TKind, F> {
        return this.with<TData, TKind, F>({ access: normalizeColumnAccess(access, "a column (`.access()`)") });
    }

    /** What the column holds, for OpenAPI and MCP tool descriptions. */
    describe(description: string): ColumnBuilder<TData, TKind, F> {
        return this.with<TData, TKind, F>({ description });
    }

    /** Rules the API checks before a write. */
    validate(rules: ValidationFor<TKind>): ColumnBuilder<TData, TKind, F> {
        const input: ValidationInput = rules;
        return this.with<TData, TKind, F>({ validate: { ...this.def.validate, ...normalizeValidation(input) } });
    }

    /**
     * Field-level hooks: `beforeSave` returns the value to store, `afterRead`
     * the value to serve. They run on the server, for every caller.
     *
     * The value is `TData | null` on a column not (yet) marked `.notNull()` /
     * `.primaryKey()` — a nullable column hands the hook `null` — and `TData`
     * on one that is; see {@link ColumnTransformValue}. Chain `.notNull()`
     * before `.transform()` to get the narrower type.
     */
    transform(transform: ColumnTransform<ColumnTransformValue<TData, F>>): ColumnBuilder<TData, TKind, F> {
        const erased: ColumnTransform = transform;
        return this.with<TData, TKind, F>({ transform: erased });
    }

    // ── Text and numbers ─────────────────────────────────────────────────

    /**
     * A closed set of accepted values that is *not* a Postgres enum type: the
     * API refuses anything else and the SDK types the column as their union.
     * Use `col.enum()` when the database should enforce it too.
     */
    oneOf<const V extends readonly TData[], K extends TextColumnKind | NumericColumnKind>(
        this: ColumnBuilder<TData, K, F>,
        values: V
    ): ColumnBuilder<V[number], K, F> {
        const stored: (string | number)[] = [];
        for (const value of values) {
            if (typeof value !== "string" && typeof value !== "number") {
                throw new Error("`.oneOf()` takes strings or numbers.");
            }
            stored.push(value);
        }
        return this.with<V[number], K, F>({ oneOf: stored });
    }

    // ── uuid ─────────────────────────────────────────────────────────────

    /** `DEFAULT gen_random_uuid()`. */
    defaultRandom(this: ColumnBuilder<string, "uuid", F>): ColumnBuilder<string, "uuid", WithDefault<F>> {
        return this.with<string, "uuid", WithDefault<F>>({ default: { kind: "random-uuid" } });
    }

    // ── Integers ─────────────────────────────────────────────────────────

    /** `GENERATED BY DEFAULT AS IDENTITY`. */
    identity<K extends "smallint" | "integer" | "bigint">(
        this: ColumnBuilder<number, K, F>
    ): ColumnBuilder<number, K, WithDefault<F>> {
        return this.with<number, K, WithDefault<F>>({ default: { kind: "identity" } });
    }

    // ── Temporal ─────────────────────────────────────────────────────────

    /** The server stamps the current time when the row is created (`DEFAULT now()`). */
    onCreateNow<K extends TemporalColumnKind>(
        this: ColumnBuilder<string, K, F>
    ): ColumnBuilder<string, K, WithDefault<F>> {
        return this.with<string, K, WithDefault<F>>(this.stamped({ on: "create", value: "now" }, "onCreateNow"));
    }

    /**
     * The server stamps the current time on every write: `DEFAULT now()`, a
     * `BEFORE UPDATE` trigger, and the driver's own stamp.
     */
    onUpdateNow<K extends TemporalColumnKind>(
        this: ColumnBuilder<string, K, F>
    ): ColumnBuilder<string, K, WithDefault<F>> {
        return this.with<string, K, WithDefault<F>>(this.stamped({ on: "update", value: "now" }, "onUpdateNow"));
    }

    // ── Acting user ──────────────────────────────────────────────────────

    /** The server writes the caller's id when the row is created. */
    onCreateUser<K extends TextColumnKind | "uuid">(
        this: ColumnBuilder<string, K, F>
    ): ColumnBuilder<string, K, WithDefault<F>> {
        return this.with<string, K, WithDefault<F>>(this.stamped({ on: "create", value: "user" }, "onCreateUser"));
    }

    /** The server writes the caller's id on every write. */
    onUpdateUser<K extends TextColumnKind | "uuid">(
        this: ColumnBuilder<string, K, F>
    ): ColumnBuilder<string, K, WithDefault<F>> {
        return this.with<string, K, WithDefault<F>>(this.stamped({ on: "update", value: "user" }, "onUpdateUser"));
    }

    /**
     * The column holds the id of a user. The panel offers a user picker for it,
     * and callers who may write the table may look users up to fill it (the
     * user picker's read answers them even though row-level security hides
     * other users' rows).
     *
     * Only on `col.text()`, `col.varchar()`, `col.char()` and `col.uuid()`;
     * anything else throws. It declares no foreign key: use
     * `rel.belongsTo(() => users)` when the database should enforce one.
     */
    userId<K extends TextColumnKind | "uuid">(
        this: ColumnBuilder<string, K, F>
    ): ColumnBuilder<string, K, F> {
        const kind = this.def.type.kind;
        if ((kind !== "text" && kind !== "varchar" && kind !== "char" && kind !== "uuid") || this.def.storage !== undefined) {
            const what = this.def.storage !== undefined ? "`col.storage()`" : `a \`${kind}\` column`;
            throw new Error(
                `\`.userId()\` on ${what}: a user's id is held by \`col.text()\`, \`col.varchar()\`, \`col.char()\` or \`col.uuid()\`.`
            );
        }
        return this.with<string, K, F>({ semantic: "user" });
    }

    // ── Storage ──────────────────────────────────────────────────────────

    /** The column holds several files: `TEXT[]` of paths. */
    multiple(this: ColumnBuilder<string, "storage", F>): ColumnBuilder<string[], "array", F> {
        const { storage, validate, ...rest } = this.def;
        return new ColumnBuilder<string[], "array", F>({
            ...rest,
            type: { kind: "array", of: { kind: "text" } },
            storage,
            element: { ...baseDef({ kind: "text" }), storage, validate }
        });
    }
}

/** Any column, whatever it holds. */
export type AnyColumn = ColumnBuilder<unknown, BuilderKind, ColumnFlags>;

/**
 * The `columns` of a table: builders by key, in physical order.
 *
 * @group Schema
 */
export type ColumnsShape = Record<string, AnyColumn>;

function jsonColumn<T, K extends "json" | "jsonb">(kind: K, shape: JsonField<T, JsonKind, boolean> | undefined): ColumnBuilder<T, K> {
    const def = baseDef({ kind });
    if (shape) def.json = shape.shape;
    return new ColumnBuilder<T, K>(def);
}

function jsonb<T = unknown>(): ColumnBuilder<T, "jsonb">;
function jsonb<T>(shape: JsonField<T, JsonKind, boolean>): ColumnBuilder<T, "jsonb">;
function jsonb<T>(shape?: JsonField<T, JsonKind, boolean>): ColumnBuilder<T, "jsonb"> {
    return jsonColumn<T, "jsonb">("jsonb", shape);
}

function json<T = unknown>(): ColumnBuilder<T, "json">;
function json<T>(shape: JsonField<T, JsonKind, boolean>): ColumnBuilder<T, "json">;
function json<T>(shape?: JsonField<T, JsonKind, boolean>): ColumnBuilder<T, "json"> {
    return jsonColumn<T, "json">("json", shape);
}

const DEFAULT_STRING_LENGTH = 255;

const lengthOf = (length: number | undefined, builder: string): number => {
    const value = length ?? DEFAULT_STRING_LENGTH;
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`\`col.${builder}(n)\` takes a positive whole number of characters, got ${String(length)}.`);
    }
    return value;
};

/**
 * The column builders. One per Postgres type Rebase creates.
 *
 * ```ts
 * columns: {
 *     id:        col.uuid().primaryKey().defaultRandom(),
 *     title:     col.text().notNull().validate({ min: 3, max: 200 }),
 *     status:    col.enum(["draft", "published"]).notNull().default("draft"),
 *     heroImage: col.storage({ path: "posts/heroes/", accept: ["image/*"], maxBytes: "10MB" }),
 *     createdAt: col.timestamptz().notNull().onCreateNow(),
 * }
 * ```
 *
 * @group Schema
 */
export const col = {
    /** `UUID`. */
    uuid(): ColumnBuilder<string, "uuid"> {
        return new ColumnBuilder<string, "uuid">(baseDef({ kind: "uuid" }));
    },
    /** `TEXT`. */
    text(): ColumnBuilder<string, "text"> {
        return new ColumnBuilder<string, "text">(baseDef({ kind: "text" }));
    },
    /** `VARCHAR(n)`. 255 when no length is given. */
    varchar(length?: number): ColumnBuilder<string, "varchar"> {
        return new ColumnBuilder<string, "varchar">(baseDef({ kind: "varchar", length: lengthOf(length, "varchar") }));
    },
    /** `CHAR(n)`. 255 when no length is given. */
    char(length?: number): ColumnBuilder<string, "char"> {
        return new ColumnBuilder<string, "char">(baseDef({ kind: "char", length: lengthOf(length, "char") }));
    },
    /**
     * A Postgres enum type, created as `<table>_<column>` unless `name` says
     * otherwise. Two columns naming the same type share it, and must list the
     * same values.
     */
    enum<const V extends readonly [string, ...string[]]>(
        values: V,
        options: { name?: string } = {}
    ): ColumnBuilder<V[number], "enum"> {
        if (values.length === 0) throw new Error("`col.enum([...])` needs at least one value.");
        const type: ColumnType = options.name
            ? { kind: "enum", values: [...values], name: options.name }
            : { kind: "enum", values: [...values] };
        return new ColumnBuilder<V[number], "enum">(baseDef(type));
    },
    /** `SMALLINT`. */
    smallint(): ColumnBuilder<number, "smallint"> {
        return new ColumnBuilder<number, "smallint">(baseDef({ kind: "smallint" }));
    },
    /** `INTEGER`. */
    integer(): ColumnBuilder<number, "integer"> {
        return new ColumnBuilder<number, "integer">(baseDef({ kind: "integer" }));
    },
    /** `BIGINT`. Read and written as a JavaScript number. */
    bigint(): ColumnBuilder<number, "bigint"> {
        return new ColumnBuilder<number, "bigint">(baseDef({ kind: "bigint" }));
    },
    /** `SMALLSERIAL`. Prefer `col.smallint().identity()` in a new schema. */
    smallserial(): ColumnBuilder<number, "smallserial", WithDefault<InitialColumnFlags>> {
        return new ColumnBuilder<number, "smallserial", WithDefault<InitialColumnFlags>>(baseDef({ kind: "smallserial" }));
    },
    /** `SERIAL`. Prefer `col.integer().identity()` in a new schema. */
    serial(): ColumnBuilder<number, "serial", WithDefault<InitialColumnFlags>> {
        return new ColumnBuilder<number, "serial", WithDefault<InitialColumnFlags>>(baseDef({ kind: "serial" }));
    },
    /** `BIGSERIAL`. Prefer `col.bigint().identity()` in a new schema. */
    bigserial(): ColumnBuilder<number, "bigserial", WithDefault<InitialColumnFlags>> {
        return new ColumnBuilder<number, "bigserial", WithDefault<InitialColumnFlags>>(baseDef({ kind: "bigserial" }));
    },
    /** `REAL`. */
    real(): ColumnBuilder<number, "real"> {
        return new ColumnBuilder<number, "real">(baseDef({ kind: "real" }));
    },
    /** `DOUBLE PRECISION`. */
    doublePrecision(): ColumnBuilder<number, "doublePrecision"> {
        return new ColumnBuilder<number, "doublePrecision">(baseDef({ kind: "doublePrecision" }));
    },
    /** `NUMERIC`, `NUMERIC(p)` or `NUMERIC(p, s)`. */
    numeric(precision?: number, scale?: number): ColumnBuilder<number, "numeric"> {
        if (scale !== undefined && precision === undefined) {
            throw new Error("`col.numeric(precision, scale)`: a scale needs a precision.");
        }
        const type: ColumnType = precision === undefined
            ? { kind: "numeric" }
            : scale === undefined ? { kind: "numeric", precision } : { kind: "numeric", precision, scale };
        return new ColumnBuilder<number, "numeric">(baseDef(type));
    },
    /** `BOOLEAN`. */
    boolean(): ColumnBuilder<boolean, "boolean"> {
        return new ColumnBuilder<boolean, "boolean">(baseDef({ kind: "boolean" }));
    },
    /** `TIMESTAMPTZ`. An ISO string on the wire. */
    timestamptz(): ColumnBuilder<string, "timestamptz"> {
        return new ColumnBuilder<string, "timestamptz">(baseDef({ kind: "timestamptz" }));
    },
    /** `DATE`. `YYYY-MM-DD` on the wire. */
    date(): ColumnBuilder<string, "date"> {
        return new ColumnBuilder<string, "date">(baseDef({ kind: "date" }));
    },
    /** `TIME`. `HH:MM:SS` on the wire. */
    time(): ColumnBuilder<string, "time"> {
        return new ColumnBuilder<string, "time">(baseDef({ kind: "time" }));
    },
    /**
     * `JSONB`. `col.jsonb<T>()` types the document; `col.jsonb(json.object({...}))`
     * also tells the server its shape, so nested fields are validated, stamped
     * and searchable.
     */
    jsonb,
    /** `JSON`. As `col.jsonb`, for a column that must keep the text it was given. */
    json,
    /** A Postgres array of another column type: `col.array(col.text())` is `TEXT[]`. */
    array<D, K extends BuilderKind, G extends ColumnFlags>(inner: ColumnBuilder<D, K, G>): ColumnBuilder<D[], "array"> {
        if (inner.def.type.kind === "array") {
            throw new Error("`col.array()` of an array is not supported. Use `col.jsonb()` for nested lists.");
        }
        const def = baseDef({ kind: "array", of: inner.def.type });
        def.element = inner.def;
        if (inner.def.storage) def.storage = inner.def.storage;
        return new ColumnBuilder<D[], "array">(def);
    },
    /**
     * `vector(dimensions)` (pgvector). An HNSW cosine index is created unless
     * `index` says otherwise; `index: false` creates none.
     */
    vector(dimensions: number, options: { index?: VectorIndexOptions | false } = {}): ColumnBuilder<number[], "vector"> {
        if (!Number.isInteger(dimensions) || dimensions <= 0) {
            throw new Error(`\`col.vector(dimensions)\` takes a positive whole number, got ${String(dimensions)}.`);
        }
        const def = baseDef({ kind: "vector", dimensions });
        if (options.index !== undefined) def.vectorIndex = options.index;
        return new ColumnBuilder<number[], "vector">(def);
    },
    /** `BYTEA`. Base64 on the wire. */
    bytea(): ColumnBuilder<string, "bytea"> {
        return new ColumnBuilder<string, "bytea">(baseDef({ kind: "bytea" }));
    },
    /** A point on Earth, stored as `JSONB` `{ latitude, longitude }`. */
    geopoint(): ColumnBuilder<JsonGeoPoint, "geopoint"> {
        const def = baseDef({ kind: "jsonb" });
        def.semantic = "geopoint";
        return new ColumnBuilder<JsonGeoPoint, "geopoint">(def);
    },
    /**
     * The path of a stored file, as `TEXT` — or several with `.multiple()`. The
     * upload route enforces `accept` and `maxBytes`, and the orphan sweep counts
     * the file as referenced.
     */
    storage(options: StorageOptions): ColumnBuilder<string, "storage"> {
        const def = baseDef({ kind: "text" });
        def.storage = normalizeStorage(options);
        return new ColumnBuilder<string, "storage">(def);
    },
    /**
     * A column of a Postgres type no other builder names — `col.custom("inet")`,
     * `col.custom("citext")`, `col.custom("interval")`, `col.custom("geometry(Point, 4326)")`.
     * What `rebase schema introspect` writes for a column of such a type, so a
     * project generated from an existing database keeps it.
     *
     * Rebase names the type in DDL, verbatim, and does nothing else with it: it
     * does not create, alter or drop the type's definition (an extension or a
     * `CREATE TYPE` the database already holds provides it), it does not
     * validate values, and it passes every value through exactly as the
     * driver returns it — a string for most types. `T` types it for the SDK
     * when the driver returns something else.
     */
    custom<T = string>(sqlType: string): ColumnBuilder<T, "other"> {
        return new ColumnBuilder<T, "other">(baseDef({ kind: "other", sqlType: customSqlType(sqlType) }));
    }
};

/**
 * The type name `col.custom()` puts into DDL: trimmed, and refused when it is
 * empty or could end the statement it is written into.
 */
function customSqlType(sqlType: string): string {
    const trimmed = typeof sqlType === "string" ? sqlType.trim() : "";
    if (trimmed.length === 0) throw new Error("`col.custom(sqlType)` takes the Postgres type, e.g. `col.custom(\"inet\")`.");
    if (/;|--|\/\*/.test(trimmed)) {
        throw new Error(`\`col.custom(${JSON.stringify(sqlType)})\`: a type name holds no \`;\` and no comment.`);
    }
    return trimmed;
}

/**
 * Whether a value is a column builder, from this copy of the package or
 * another.
 *
 * @group Schema
 */
export function isColumnBuilder(value: unknown): value is AnyColumn {
    return typeof value === "object" && value !== null && "brand" in value && value.brand === COLUMN_BRAND;
}
