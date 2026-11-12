import {
    isNumericColumnType,
    type ColumnType,
    type SecurityRule,
    type TableDescriptor,
    type TenantDescriptor
} from "@rebasepro/types";

/**
 * The Postgres type a text claim is cast to before it is compared with a
 * column. `"text"` is the no-cast case: a claim already is text, and a text
 * column compares with it directly and keeps using its index.
 *
 * @group Policies
 */
export type ClaimCastType = "text" | "uuid" | "bigint" | "numeric";

/**
 * A column a rule can name: its SQL name, and the cast a claim compared with
 * it needs.
 *
 * @group Policies
 */
export interface PolicyColumn {
    /** The SQL column, unquoted. */
    column: string;
    /** What a text claim compared with the column is cast to. */
    claimCast: ClaimCastType;
}

/**
 * What the policy compiler reads of a table: the small view of a
 * `TableDescriptor` that rules compile against.
 *
 * A rule names a row by key (`ownerField: "authorId"`, `policy.field("org")`);
 * the compiler needs that key's SQL column and the cast a claim compared with
 * it needs, the table's qualified name (for `outerField` inside an
 * `existsIn`), the rules and posture (for the injected baseline), and the
 * database the table lives in (whose declaration picks the policy shape).
 * Nothing else. Built from a descriptor by {@link policyTableFromDescriptor},
 * and for a junction by `junctionPolicyTable`.
 *
 * @group Policies
 */
export interface PolicyTable {
    /** The API slug: what `existsIn({ table })` and the junction rules name. */
    slug: string;
    /** The SQL table, unqualified. Policy names derive from it. */
    table: string;
    /**
     * The Postgres schema the table is declared in. Absent when it was not
     * stated (the table lives in `public`); an `existsIn` join into such a
     * table qualifies it with the outer table's schema.
     */
    schema?: string;
    /** The key of the database the table lives in, when not the default one. */
    database?: string;
    /** Every key a rule may name, by key: the table's columns. */
    columns: Readonly<Record<string, PolicyColumn>>;
    /**
     * The `belongsTo` relations, by relation name, each addressing its foreign
     * key column: `ownerField: "org"` compares `org_id`.
     */
    links: Readonly<Record<string, PolicyColumn>>;
    /** The key of the row id: the first primary-key column. */
    idKey: string;
    /** The declared rules, exactly as written (policy names hash them). */
    rules: readonly SecurityRule[];
    /**
     * `false` when the table switched the injected admin baseline off,
     * `true` when it switched it on regardless of its database's declaration,
     * absent when the database declaration (`rls.defaultPolicies`) decides.
     */
    defaultPolicies?: boolean;
    /** The auth table: gets the self-read rule and the admin write gate. */
    auth: boolean;
    /** Rows are scoped to a tenant. */
    tenant?: TenantDescriptor;
}

/**
 * Resolve a table by slug, for `existsIn` joins and relation targets.
 *
 * @group Policies
 */
export type ResolvePolicyTable = (slug: string) => PolicyTable | undefined;

/**
 * What a claim compared with a column of `type` is cast to.
 *
 * `numeric` stays `numeric`; every other number type compares as `bigint`
 * (the guard caps the digits at 18). A uuid as `uuid`; everything else —
 * text, an enum, a date — as text, which is the safe direction: a redundant
 * text comparison costs nothing, while a missing cast is a `CREATE POLICY`
 * that fails and leaves the table with RLS on and no policy.
 *
 * @group Policies
 */
export function claimCastOf(type: ColumnType): ClaimCastType {
    if (type.kind === "uuid") return "uuid";
    if (type.kind === "numeric") return "numeric";
    if (isNumericColumnType(type)) return "bigint";
    return "text";
}

/**
 * The policy compiler's view of a compiled table.
 *
 * A `belongsTo` link addresses its foreign key column (`localKey`), cast as
 * that column is — its type is the target's key type, so no lookup through
 * the target is needed. The baseline follows the database's declaration unless
 * the table wrote `defaultPolicies: false`. A view has no rules of its own
 * (`posture: "view"`), and gets none here.
 *
 * @group Policies
 */
export function policyTableFromDescriptor(descriptor: TableDescriptor): PolicyTable {
    const columns: Record<string, PolicyColumn> = {};
    for (const column of descriptor.columns) {
        columns[column.key] = { column: column.column, claimCast: claimCastOf(column.type) };
    }
    const links: Record<string, PolicyColumn> = {};
    for (const relation of descriptor.relations) {
        if (relation.kind !== "belongsTo") continue;
        links[relation.name] = {
            column: relation.localKey,
            claimCast: columns[relation.localField]?.claimCast ?? "text"
        };
    }
    return {
        slug: descriptor.slug,
        table: descriptor.table,
        // `public` is where an undeclared table lives; the compiler treats an
        // undeclared schema as "the outer table's" inside a join, so the
        // default is not spelled out.
        ...(descriptor.schema !== "public" ? { schema: descriptor.schema } : {}),
        ...(descriptor.database !== undefined ? { database: descriptor.database } : {}),
        columns,
        links,
        idKey: descriptor.primaryKey[0] ?? "id",
        rules: descriptor.rls.posture === "rules" ? descriptor.rls.rules : [],
        ...(descriptor.rls.posture === "view"
            ? { defaultPolicies: false }
            : descriptor.rls.defaultPolicies ? {} : { defaultPolicies: false }),
        auth: descriptor.auth !== undefined,
        ...(descriptor.tenant ? { tenant: descriptor.tenant } : {})
    };
}

/**
 * A resolver over compiled tables, by slug or SQL table name (an `existsIn`
 * may name either). Each table's view is built once.
 *
 * @group Policies
 */
export function policyTableResolver(descriptors: readonly TableDescriptor[]): ResolvePolicyTable {
    const cache = new Map<TableDescriptor, PolicyTable>();
    const view = (descriptor: TableDescriptor): PolicyTable => {
        let table = cache.get(descriptor);
        if (!table) {
            table = policyTableFromDescriptor(descriptor);
            cache.set(descriptor, table);
        }
        return table;
    };
    return (slug: string) => {
        const found = descriptors.find(d => d.slug === slug) ?? descriptors.find(d => d.table === slug);
        return found ? view(found) : undefined;
    };
}
