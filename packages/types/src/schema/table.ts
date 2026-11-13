import type { User } from "../users";
import type { ResourceRef } from "../types/resources";
import type { SearchConfig } from "../types/search";
import type { RoleDefinition, ScopeDefinition } from "../types/scopes";
import type {
    AuthCollectionContext,
    AuthCollectionCreateResult,
    AuthCollectionResetResult
} from "../types/auth_hooks";
import type { ColumnsShape } from "./columns";
import { isColumnBuilder } from "./columns";
import type { RelationsShape } from "./relations";
import { isRelationDef } from "./relations";
import type { TableHooks } from "./hooks";
import type { RlsPosture, TableIndex, TableTenant } from "./table_options";
import type { InsertOfColumns, RowOfColumns } from "./infer";

/** The brand of a `defineTable` / `defineAuthTable` result. */
export const TABLE_BRAND = "rebase.table";
/** The brand of a `defineView` result. */
export const VIEW_BRAND = "rebase.view";

/**
 * What `defineTable` takes besides the name.
 *
 * @group Schema
 */
export interface TableConfig<
    C extends ColumnsShape,
    R extends RelationsShape = Record<never, never>,
    USER extends User = User,
    S extends string = string
> {
    /**
     * The name in the API, the SDK and in scopes. The table's name when
     * omitted. Captured as a literal type, so `TableSlugOf<typeof table>` reads it.
     */
    slug?: S;
    /** The SQL table name, when it is not the name the table is defined under. */
    table?: string;
    /** The Postgres schema. `public` when omitted. */
    schema?: string;
    /** A non-default Postgres database, declared in `backend/resources.ts`. */
    database?: ResourceRef;
    /** What the table holds, for OpenAPI and MCP tool descriptions. */
    description?: string;
    /**
     * The columns, in physical order. At least one must be `.primaryKey()`;
     * several form a composite key in declaration order.
     */
    columns: C;
    /** The relations, by name. */
    relations?: R;
    /**
     * The row-level security posture. Required: `"admin-only"`, `"inherit"`
     * (the project's `defaultRls`), or the rules to generate policies from.
     */
    rls: RlsPosture;
    /**
     * `false` generates only the declared rules, without the injected admin
     * baseline. Refused together with `rls: "admin-only"`. `true` keeps the
     * baseline even when the table's database switches it off for every
     * table (`database({ rls: { defaultPolicies: false } })`). Absent, the
     * database's declaration decides.
     */
    defaultPolicies?: boolean;
    /** Scope every row to a tenant. */
    tenant?: TableTenant<NoInfer<Extract<keyof C, string>>>;
    /** Deleting stamps a timestamp column instead of removing the row. */
    softDelete?: boolean | { field?: NoInfer<Extract<keyof C, string>> };
    /** Record every write in the history table. */
    history?: boolean;
    /** Full-text search over these columns. */
    search?: SearchConfig;
    /**
     * Indexes, each with the query it serves. The keys are not inferred from:
     * without `NoInfer`, a key naming nothing made TypeScript infer a relation
     * of that name instead of refusing it.
     */
    indexes?: readonly TableIndex<NoInfer<Extract<keyof C, string> | Extract<keyof R, string>>>[];
    /** Server-side lifecycle hooks. */
    hooks?: TableHooks<RowOfColumns<C>, InsertOfColumns<C>, USER>;
    /** `false` accepts writes naming columns the table does not declare. */
    strictWrites?: false;
    /** Opaque data, served with the table's descriptor. */
    metadata?: Record<string, unknown>;
}

/**
 * A table as authored: the result of `defineTable`.
 *
 * `N` is the name it was defined under and `S` its slug — the `slug` it was
 * given, or the name when it was given none — both as literal types, so a
 * frontend holding only `typeof posts` knows the slug (`TableSlugOf`).
 *
 * @group Schema
 */
export interface TableDef<
    N extends string = string,
    C extends ColumnsShape = ColumnsShape,
    R extends RelationsShape = RelationsShape,
    S extends string = N
> {
    readonly brand: typeof TABLE_BRAND;
    /** The name it was defined under. */
    readonly name: N;
    /** What it was defined with, as written. */
    readonly config: TableConfig<C, R, User, S>;
    /** Present when defined with `defineAuthTable`. */
    readonly auth?: AuthTableOptions;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertTableShape(builder: string, name: unknown, config: unknown): void {
    if (typeof name !== "string" || name.length === 0) {
        throw new Error(`\`${builder}(name, config)\` needs the table's name as its first argument.`);
    }
    if (typeof config !== "object" || config === null) {
        throw new Error(`\`${builder}("${name}", config)\` needs a config object.`);
    }
    const columns = "columns" in config ? config.columns : undefined;
    if (typeof columns !== "object" || columns === null || Object.keys(columns).length === 0) {
        throw new Error(`Table "${name}" declares no columns. Add \`columns: { id: col.uuid().primaryKey().defaultRandom(), … }\`.`);
    }
    for (const [key, column] of Object.entries(columns)) {
        if (!isColumnBuilder(column)) {
            throw new Error(`Column "${key}" of table "${name}" is not a \`col.*\` builder.`);
        }
    }
    const relations = "relations" in config ? config.relations : undefined;
    if (relations !== undefined) {
        if (typeof relations !== "object" || relations === null) {
            throw new Error(`\`relations\` of table "${name}" must be an object of \`rel.*\` results.`);
        }
        for (const [key, relation] of Object.entries(relations)) {
            if (!isRelationDef(relation)) {
                throw new Error(`Relation "${key}" of table "${name}" is not a \`rel.*\` result.`);
            }
            if (key in columns) {
                throw new Error(
                    `Table "${name}" has both a column and a relation named "${key}". ` +
                    "A relation's key is what `include` names; give the foreign-key column its own key."
                );
            }
        }
    }
    for (const key of ["schema", "table"] as const) {
        const value: unknown = key in config ? Reflect.get(config, key) : undefined;
        if (value !== undefined && (typeof value !== "string" || !IDENTIFIER.test(value))) {
            throw new Error(`\`${key}\` of table "${name}" must be a plain SQL identifier, got ${JSON.stringify(value)}.`);
        }
    }
}

function assertRlsDeclared(builder: string, name: string, config: object): void {
    const rls = "rls" in config ? config.rls : undefined;
    const ok = rls === "admin-only" || rls === "inherit" || (Array.isArray(rls) && rls.length > 0);
    if (ok) return;
    const detail = Array.isArray(rls)
        ? "`rls: []` grants nothing and says nothing. Write `rls: \"admin-only\"` to lock the table to admins."
        : "Every table needs an explicit row-level security posture.";
    throw new Error(
        `\`${builder}("${name}", …)\` has no usable \`rls\`. ${detail} ` +
        "Accepted: `\"admin-only\"`, `\"inherit\"` (the `defaultRls` exported from backend/schema/index.ts), " +
        "or a non-empty list of rules."
    );
}

/**
 * Define a Postgres table.
 *
 * The name is the SQL table and the API slug; `rls` is mandatory. The result
 * is what the backend reads from `backend/schema/index.ts` — it generates the
 * DDL and the policies, serves the REST, realtime and MCP surfaces, and types
 * the SDK.
 *
 * ```ts
 * export const posts = defineTable("posts", {
 *     columns: {
 *         id:    col.uuid().primaryKey().defaultRandom(),
 *         title: col.text().notNull(),
 *     },
 *     rls: [
 *         { operation: "select", access: "public" },
 *         { operations: ["insert", "update", "delete"], roles: ["editor"] },
 *     ],
 * });
 * ```
 *
 * @group Schema
 */
export function defineTable<
    const N extends string,
    C extends ColumnsShape,
    R extends RelationsShape = Record<never, never>,
    const S extends string = N
>(name: N, config: TableConfig<C, R, User, S>): TableDef<N, C, R, S> {
    assertTableShape("defineTable", name, config);
    assertRlsDeclared("defineTable", name, config);
    return { brand: TABLE_BRAND, name, config };
}

/**
 * The auth half of `defineAuthTable`.
 *
 * @group Schema
 */
export interface AuthTableOptions {
    /** The roles a user can hold, each with the scopes it grants. */
    roles?: Record<string, RoleDefinition>;
    /** The scopes an API key or token can be granted. */
    scopes?: Record<string, ScopeDefinition>;
    /** Let users create personal API keys. */
    personalKeys?: boolean;
    /** Runs when an admin creates a user: hash the password, send the invitation. */
    onCreateUser?: (values: Record<string, unknown>, ctx: AuthCollectionContext) => Promise<AuthCollectionCreateResult>;
    /** Runs when an admin resets a user's password. */
    onResetPassword?: (uid: string, ctx: AuthCollectionContext) => Promise<AuthCollectionResetResult>;
}

/**
 * What `defineAuthTable` takes besides the name.
 *
 * @group Schema
 */
export interface AuthTableConfig<
    C extends ColumnsShape,
    R extends RelationsShape = Record<never, never>,
    USER extends User = User,
    S extends string = string
> extends TableConfig<C, R, USER, S> {
    /** Roles, scopes, personal keys and the user-lifecycle hooks. */
    auth?: AuthTableOptions;
}

/**
 * Define the table users are stored in.
 *
 * A `defineTable` that auth reads and writes: the columns auth needs are added
 * when the table does not declare them, a signed-in user can read their own
 * row, and the privilege columns (`roles`) can only be written by an admin —
 * whatever `rls` says. A project has at most one.
 *
 * @group Schema
 */
export function defineAuthTable<
    const N extends string,
    C extends ColumnsShape,
    R extends RelationsShape = Record<never, never>,
    const S extends string = N
>(name: N, config: AuthTableConfig<C, R, User, S>): TableDef<N, C, R, S> {
    assertTableShape("defineAuthTable", name, config);
    assertRlsDeclared("defineAuthTable", name, config);
    const { auth, ...table } = config;
    return { brand: TABLE_BRAND, name, config: table, auth: auth ?? {} };
}

/**
 * What `defineView` takes besides the name.
 *
 * @group Schema
 */
export interface ViewConfig<
    C extends ColumnsShape,
    R extends RelationsShape = Record<never, never>,
    USER extends User = User,
    S extends string = string
> {
    /** The defining `SELECT`. */
    query: string;
    /**
     * `true` stores the rows. Postgres cannot attach row policies to a
     * materialized view, so it is read through a gate that admits `roles`.
     */
    materialized?: boolean;
    /** Who may read a materialized view. `["admin"]` when omitted. Not accepted on a plain view. */
    roles?: readonly string[];
    /** The columns the query returns. `.primaryKey()` marks the ones that identify a row. */
    columns: C;
    /** The name in the API. The view's name when omitted. Captured as a literal type, like a table's. */
    slug?: S;
    /** The SQL view name, when it is not the name the view is defined under. A plain SQL identifier. */
    table?: string;
    /** The Postgres schema. `public` when omitted. */
    schema?: string;
    /** A non-default Postgres database. */
    database?: ResourceRef;
    /** What the view holds, for OpenAPI and MCP. */
    description?: string;
    /** Relations to read through. No constraint is created for a view. */
    relations?: R;
    /** Indexes on a materialized view's stored rows. */
    indexes?: readonly TableIndex<NoInfer<Extract<keyof C, string>>>[];
    /** Read hooks. A view is never written. */
    hooks?: Pick<TableHooks<RowOfColumns<C>, RowOfColumns<C>, USER>, "beforeQuery" | "afterRead">;
    /** Opaque data, served with the view's descriptor. */
    metadata?: Record<string, unknown>;
}

/**
 * A view as authored: the result of `defineView`.
 *
 * @group Schema
 */
export interface ViewDef<
    N extends string = string,
    C extends ColumnsShape = ColumnsShape,
    R extends RelationsShape = RelationsShape,
    S extends string = N
> {
    readonly brand: typeof VIEW_BRAND;
    /** The name it was defined under. */
    readonly name: N;
    /** What it was defined with, as written. */
    readonly config: ViewConfig<C, R, User, S>;
}

/**
 * Define a SQL view, served read-only.
 *
 * A plain view is created `WITH (security_invoker = true)`: the row-level
 * security of the tables it reads decides what each caller sees. A
 * materialized view stores its rows, so it is gated by `roles` instead.
 *
 * @group Schema
 */
export function defineView<
    const N extends string,
    C extends ColumnsShape,
    R extends RelationsShape = Record<never, never>,
    const S extends string = N
>(name: N, config: ViewConfig<C, R, User, S>): ViewDef<N, C, R, S> {
    assertTableShape("defineView", name, config);
    if (typeof config.query !== "string" || config.query.trim().length === 0) {
        throw new Error(`View "${name}" needs a \`query\`: the SELECT that defines it.`);
    }
    if (config.roles !== undefined && !config.materialized) {
        throw new Error(
            `View "${name}" lists \`roles\` but is not materialized. A plain view is governed by the row-level ` +
            "security of the tables it reads; `roles` gates a materialized view only."
        );
    }
    return { brand: VIEW_BRAND, name, config };
}

/**
 * The slug of a table or view, from its type: `TableSlugOf<typeof posts>`.
 *
 * The `slug` it was defined with, or the name it was defined under when it was
 * given none — the table's API path, SDK accessor and what scopes name. Reads
 * any `{ name, config: { slug? } }` structurally, so `import type { posts }`
 * is enough; `string` for a table whose type is not literal.
 *
 * ```ts
 * const posts = defineTable("blog_posts", { slug: "posts", … });
 * type S = TableSlugOf<typeof posts>; // "posts"
 * ```
 *
 * @group Schema
 */
export type TableSlugOf<T extends { readonly name: string }> =
    T extends { readonly config: { readonly slug?: infer S } }
        ? [Exclude<S, undefined>] extends [never]
            ? T["name"]
            : Exclude<S, undefined> extends string ? Exclude<S, undefined> : T["name"]
        : T["name"];

/**
 * A type compared member by member rather than through its type parameters.
 *
 * `TableConfig<C>` names `keyof C` (in `tenant`, `softDelete`, `indexes`), and
 * TypeScript measures a type parameter read through `keyof` as contravariant —
 * so `TableConfig<{ id: … }>` was refused where `TableConfig<ColumnsShape>`
 * was expected, although every member is assignable. Spelling the "any" types
 * out structurally makes the compiler compare the members, which is the
 * question actually being asked.
 */
type Structural<T> = { [K in keyof T]: T[K] };

/**
 * Any table, whatever its columns: what a list of `defineTable` results is
 * typed as (`compileTables(defs)`, `backend/schema/index.ts`).
 *
 * @group Schema
 */
export interface AnyTableDef {
    readonly brand: typeof TABLE_BRAND;
    readonly name: string;
    readonly config: Structural<TableConfig<ColumnsShape, RelationsShape>>;
    readonly auth?: AuthTableOptions;
}

/**
 * Any view, whatever its columns.
 *
 * @group Schema
 */
export interface AnyViewDef {
    readonly brand: typeof VIEW_BRAND;
    readonly name: string;
    readonly config: Structural<ViewConfig<ColumnsShape, RelationsShape>>;
}

/**
 * Whether a value is the result of `defineTable` or `defineAuthTable`, from
 * this copy of the package or another.
 *
 * @group Schema
 */
export function isTableDef(value: unknown): value is AnyTableDef {
    return typeof value === "object" && value !== null && "brand" in value && value.brand === TABLE_BRAND;
}

/**
 * Whether a value is the result of `defineAuthTable`.
 *
 * @group Schema
 */
export function isAuthTableDef(value: unknown): value is AnyTableDef & { auth: AuthTableOptions } {
    return isTableDef(value) && value.auth !== undefined;
}

/**
 * Whether a value is the result of `defineView`.
 *
 * @group Schema
 */
export function isViewDef(value: unknown): value is AnyViewDef {
    return typeof value === "object" && value !== null && "brand" in value && value.brand === VIEW_BRAND;
}
