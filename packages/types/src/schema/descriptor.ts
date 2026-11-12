import type { OnAction, JoinStep } from "../types/relations";
import type { SecurityRule } from "../types/security_rules";
import type { SearchConfig } from "../types/search";
import type { TenantSource } from "../types/tenancy";
import type { OrderByTuple } from "../types/filter-operators";
import type { RoleDefinition, ScopeDefinition } from "../types/scopes";
import type { ColumnType } from "./column_type";
import type {
    ColumnAccess,
    ColumnDefault,
    ColumnStamp,
    ColumnStorage,
    ColumnValidation,
    VectorIndexOptions
} from "./column_options";
import type { JsonShape } from "./json";
import type { TableIndex } from "./table_options";

/**
 * A table as the backend knows it and as `GET /api/schema/tables` serves it.
 *
 * Plain JSON: no functions, no thunks, no UI. It is the compiled form of a
 * `defineTable(...)` — every default applied, every name derived, every
 * relation resolved to a slug — and equally what introspection reports for a
 * table nobody declared. The server, the SDK generator, the Studio and the
 * panel all read this one shape.
 *
 * @group Schema
 */
export interface TableDescriptor {
    /** The name the table was defined under: `defineTable("posts", …)`. */
    name: string;
    /** The name in the API, the SDK and in scopes: `/api/data/<slug>`. */
    slug: string;
    /** The SQL table (or view) name, unqualified. */
    table: string;
    /** The Postgres schema. */
    schema: string;
    /** The key of the Postgres database it lives in, when not the default one. */
    database?: string;
    /** A table, or a view declared with `defineView`. */
    kind: "table" | "view";
    /** What the table holds, for OpenAPI and MCP tool descriptions. */
    description?: string;
    /** The columns, in physical order. */
    columns: ColumnDescriptor[];
    /** The keys of the primary-key columns, in key order. */
    primaryKey: string[];
    /** The relations, in declaration order. */
    relations: RelationDescriptor[];
    /** The row-level security posture. */
    rls: RlsDescriptor;
    /** Rows are scoped to a tenant. */
    tenant?: TenantDescriptor;
    /** Deleting stamps this column instead of removing the row. */
    softDelete?: { field: string };
    /** Every write is recorded in the history table. */
    history?: boolean;
    /** Full-text search. */
    search?: SearchConfig;
    /** Declared indexes. */
    indexes?: TableIndex[];
    /** Present on a view. */
    view?: ViewDescriptor;
    /** Present on the auth table. */
    auth?: AuthTableDescriptor;
    /** Which server hooks the table declares. Their code never leaves the server. */
    hooks?: TableHookFlags;
    /** `false` when writes may name columns the table does not declare. */
    strictWrites?: false;
    /** Opaque data the project attached. */
    metadata?: Record<string, unknown>;
}

/**
 * A column as the backend knows it and as the wire carries it.
 *
 * @group Schema
 */
export interface ColumnDescriptor {
    /** The key on a JSON row, in the SDK, in filters and sorts. */
    key: string;
    /** The SQL column name. */
    column: string;
    /** The Postgres type. */
    type: ColumnType;
    /** `false` for a `NOT NULL` column: required by the API on create. */
    nullable: boolean;
    /** Part of the primary key. */
    primaryKey?: true;
    /** Carries a single-column `UNIQUE` constraint. */
    unique?: true;
    /** The DEFAULT. A create may omit the column. */
    default?: ColumnDefault;
    /** `GENERATED ALWAYS AS (…) STORED`. Never writable. */
    generated?: { expression: string };
    /** Client writes are refused; the database or the server fills it. */
    readOnly?: true;
    /** Never on the wire, in the SDK or in OpenAPI. Only server code sees it. */
    private?: true;
    /** Per-role read and write access. */
    access?: ColumnAccess;
    /** The server writes the time or the caller's id into it. */
    stamp?: ColumnStamp;
    /** Rules the API checks before a write. */
    validate?: ColumnValidation;
    /** A closed set of values that is not a Postgres enum type. */
    oneOf?: readonly (string | number)[];
    /** What the column holds, for OpenAPI and MCP. */
    description?: string;
    /** The column holds the path of a stored file (or several). */
    storage?: ColumnStorage;
    /**
     * A meaning the type does not state: `"geopoint"` on a `jsonb` point
     * (`col.geopoint()`), `"user"` on a text or uuid column that holds a
     * user's id (`.userId()`) — the panel offers a user picker for it, and a
     * caller who may write the table may look users up to fill it.
     */
    semantic?: "geopoint" | "user";
    /** The vector index, or `false` when the column has none. */
    vectorIndex?: VectorIndexOptions | false;
    /** The shape of a `json`/`jsonb` document. */
    json?: JsonShape;
    /** What each item of an array column is. */
    element?: ColumnElementDescriptor;
    /** Which field-level hooks the column declares. */
    transforms?: { beforeSave?: true; afterRead?: true };
    /** The `belongsTo` relation this column is the foreign key of. */
    foreignKeyOf?: string;
    /** The column was derived from a relation rather than declared in `columns`. */
    derived?: true;
}

/**
 * The rules that apply to each item of an array column.
 *
 * @group Schema
 */
export interface ColumnElementDescriptor {
    validate?: ColumnValidation;
    oneOf?: readonly (string | number)[];
    storage?: ColumnStorage;
    /** `"user"`: each item is a user's id (`col.array(col.text().userId())`). */
    semantic?: "user";
}

/** What every relation descriptor carries. */
export interface RelationDescriptorBase {
    /** The relation's key: what `include` names. */
    name: string;
    /** The slug of the table it points at. */
    target: string;
    /** One row or many. */
    cardinality: "one" | "many";
    /** Per-role read and write access to the relation (`rel.*(…, { access })`). */
    access?: ColumnAccess;
    /** Never on the wire, in the SDK or in OpenAPI (`rel.*(…, { private: true })`). Only server code sees it. */
    private?: true;
}

/**
 * A resolved relation: every key and name it uses is spelled out.
 *
 * @group Schema
 */
export type RelationDescriptor =
    | (RelationDescriptorBase & {
        kind: "belongsTo";
        cardinality: "one";
        /** The SQL column on this table that holds the foreign key. */
        localKey: string;
        /** The row key of that column. */
        localField: string;
        onDelete?: OnAction;
        onUpdate?: OnAction;
        /** Whether an index on the foreign key is created. */
        index: boolean;
        /** `false` for a column that stores a key without a constraint. */
        constraint: boolean;
    })
    | (RelationDescriptorBase & {
        kind: "hasOne" | "hasMany";
        /** The SQL column on the target table that points back here. */
        foreignKey: string;
        /** The SQL column on this table it points at, when not the primary key. */
        sourceKey?: string;
        /** The order related rows come back in. */
        orderBy?: OrderByTuple[];
    })
    | (RelationDescriptorBase & {
        kind: "manyToMany";
        cardinality: "many";
        through: {
            /** The junction table. */
            table: string;
            /** The junction column pointing at this table. */
            sourceKey: string;
            /** The junction column pointing at the target. */
            targetKey: string;
            /** Extra columns on the junction, served as `_pivot`. */
            pivot: ColumnDescriptor[];
        };
        onDelete?: OnAction;
    })
    | (RelationDescriptorBase & {
        kind: "via";
        /** The joins from this table to the target. */
        steps: JoinStep[];
        /** Whether a link can be written through it. */
        writable: boolean;
    });

/**
 * A table's row-level security, resolved.
 *
 * `posture` is what the author wrote; `"inherit"` is already replaced by the
 * project's `defaultRls`, with `inherited` set. `rules` is what the policies
 * are generated from. `admin-only` has no rules: only the injected admin
 * baseline grants access, so a reader must never take an empty `rules` to mean
 * "open".
 *
 * `"view"` is the posture of every `defineView`: a view has no policies of its
 * own. A plain view runs `security_invoker`, so the row-level security of the
 * tables it reads decides each row; a materialized one is read by
 * `view.roles`. It carries no rules and `defaultPolicies: false`, and a reader
 * decides access from `view`, never from `rules`.
 *
 * @group Schema
 */
export interface RlsDescriptor {
    /** `"admin-only"` or `"rules"` for a table, `"view"` for every view. */
    posture: "admin-only" | "rules" | "view";
    /** The rules came from `defaultRls`. */
    inherited?: true;
    /** The declared rules, exactly as written. */
    rules: SecurityRule[];
    /** `false` when the injected admin baseline is switched off. */
    defaultPolicies: boolean;
    /**
     * The policies Postgres holds for the table, when the server includes them
     * (admins and `schema:read` holders): the Studio's RLS editor reads these.
     */
    policies?: PolicyDescriptor[];
    /**
     * The junction tables of this table's `manyToMany` relations, each with
     * the policies Postgres holds for it — included exactly when
     * {@link policies} is. A junction has no descriptor of its own (it is the
     * platform's table, not the author's), so its policies are listed under
     * every table that declares a relation through it.
     */
    junctions?: JunctionPolicyDescriptor[];
}

/**
 * A junction table of a `manyToMany` relation and its generated policies.
 *
 * @group Schema
 */
export interface JunctionPolicyDescriptor {
    /** The junction table, unqualified. */
    table: string;
    /** Its Postgres schema. */
    schema: string;
    /** Its policies: derived from the endpoints' rules, so every one is `injected`. */
    policies: PolicyDescriptor[];
}

/**
 * One generated policy.
 *
 * @group Schema
 */
export interface PolicyDescriptor {
    name: string;
    operation: string;
    mode: "permissive" | "restrictive";
    roles: string[];
    using: string | null;
    withCheck: string | null;
    /** Rebase injected it (admin baseline, auth, tenant, junction). */
    injected: boolean;
    /** The index in `rules` of the rule it was generated from. */
    rule?: number;
}

/**
 * How rows are scoped to a tenant.
 *
 * @group Schema
 */
export interface TenantDescriptor {
    /** The key of the tenant column. */
    field: string;
    /** Where the caller's tenant comes from. */
    from: TenantSource;
    /** Roles that see every tenant. */
    bypassRoles?: readonly string[];
}

/**
 * A view's definition.
 *
 * @group Schema
 */
export interface ViewDescriptor {
    materialized: boolean;
    /** Roles that may read a materialized view. */
    roles?: string[];
    /** The defining query. Served to admins only. */
    query?: string;
}

/**
 * The serializable half of `defineAuthTable`'s `auth` options.
 *
 * @group Schema
 */
export interface AuthTableDescriptor {
    /** The roles users can hold, with what each may do. */
    roles?: Record<string, RoleDefinition>;
    /** The scopes an API key or token can be granted. */
    scopes?: Record<string, ScopeDefinition>;
    /** Whether users may create personal API keys. */
    personalKeys?: boolean;
    /**
     * Which user-lifecycle hooks `defineAuthTable`'s `auth` declares. Their
     * code never leaves the server; a client reads this to know, for example,
     * that creating a user sends an invitation.
     */
    hooks?: { onCreateUser?: true; onResetPassword?: true };
}

/**
 * Which hooks a table declares.
 *
 * @group Schema
 */
export interface TableHookFlags {
    beforeQuery?: true;
    afterRead?: true;
    beforeSave?: true;
    afterSave?: true;
    afterSaveError?: true;
    beforeDelete?: true;
    afterDelete?: true;
}
