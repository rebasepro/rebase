/**
 * The pre-0.31 collection model, frozen at 0.30 — part of the migration's
 * input format (see `./index.ts`). Nothing at runtime may import it.
 */
import type {
    AuthCollectionContext,
    AuthCollectionCreateResult,
    AuthCollectionResetResult,
    RoleDefinition,
    ScopeDefinition,
    SearchConfig,
    SecurityRule,
    TenantSource,
    User
} from "@rebasepro/types";

import type { LegacyCollectionCallbacks } from "./callbacks";
import type { LegacyCollectionIndex } from "./indexes";
import type { LegacyFirebaseProperties, LegacyPostgresProperties, LegacyProperties } from "./properties";
import type { LegacyRelation } from "./relations";

/**
 * The fields every legacy collection has, whatever its engine.
 *
 * @group Migration
 */
export interface LegacyBaseCollectionConfig<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {
    /** The REST path, the SDK accessor and the panel's URL key. */
    slug: string;
    /** The panel's display name. */
    name: string;
    singularName?: string;
    description?: string;
    /** Child collections the panel shows under an entity. */
    childCollections?: () => LegacyCollectionConfig[];
    /** The data source (a resource key). */
    dataSource?: string;
    /** The engine: absent or `"postgres"` for Postgres. */
    engine?: string;
    databaseId?: string;
    properties: LegacyProperties;
    auth?: boolean | LegacyAuthCollectionConfig;
    securityRules?: readonly SecurityRule[];
    readonly callbacks?: LegacyCollectionCallbacks<M, USER>;
    /** Stamped by the collection editor. */
    ownerId?: string;
    metadata?: Record<string, unknown>;
    history?: boolean;
    strictWrites?: boolean;
}

/**
 * A collection served from a SQL view.
 *
 * @group Migration
 */
export interface LegacyCollectionView {
    query: string;
    materialized?: boolean;
    roles?: string[];
}

/**
 * Which rows a tenant may see: the column holding the tenant id, and where the
 * caller's tenants come from.
 *
 * @group Migration
 */
export interface LegacyCollectionTenantConfig<M extends Record<string, unknown> = Record<string, unknown>> {
    field: Extract<keyof M, string> | (string & {});
    from: TenantSource;
    bypassRoles?: readonly string[];
}

/**
 * A legacy Postgres collection: the input the lift converts into a table.
 *
 * @group Migration
 */
export interface LegacyPostgresCollectionConfig<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>
    extends LegacyBaseCollectionConfig<M, USER> {
    properties: LegacyPostgresProperties;
    engine?: "postgres" | undefined;
    table?: string;
    schema?: string;
    view?: LegacyCollectionView;
    relations?: LegacyRelation[];
    securityRules?: readonly SecurityRule[];
    disableDefaultPolicies?: boolean;
    search?: SearchConfig;
    indexes?: readonly LegacyCollectionIndex<Extract<keyof M, string>>[];
    softDelete?: boolean | { field?: string };
    tenant?: LegacyCollectionTenantConfig<M>;
}

/**
 * A legacy Firestore collection. The lift refuses it: it becomes
 * `defineFirestoreCollection` in the CMS.
 *
 * @group Migration
 */
export interface LegacyFirebaseCollectionConfig<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User>
    extends LegacyBaseCollectionConfig<M, USER> {
    engine: "firestore";
    properties: LegacyFirebaseProperties;
    path?: string;
    subcollections?: () => LegacyCollectionConfig[];
}

/**
 * A legacy collection of either engine.
 *
 * 0.30 also had a MongoDB variant; it left the model before 0.31, the lift
 * refuses every engine but Postgres, and no project the codemod migrates can
 * carry one, so it is not part of the frozen input.
 *
 * @group Migration
 */
export type LegacyCollectionConfig<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    | LegacyPostgresCollectionConfig<M, USER>
    | LegacyFirebaseCollectionConfig<M, USER>;

/**
 * A legacy collection of any row type: what a relation's `target` returns.
 * (0.30 spelled it `CollectionConfig<any, any>`; a collection typed with its
 * own row is assignable to the default row type, because the row type only
 * reaches method parameters and key names.)
 *
 * @group Migration
 */
export type LegacyAnyCollectionConfig = LegacyCollectionConfig;

/**
 * Whether a legacy collection is a Postgres one (no engine, or `"postgres"`).
 *
 * @group Migration
 */
export function isLegacyPostgresCollection<C extends LegacyCollectionConfig>(
    collection: C
): collection is C & LegacyPostgresCollectionConfig {
    return !collection.engine || collection.engine === "postgres";
}

/**
 * A collection's `auth` block: it is the users table.
 *
 * @group Migration
 */
export interface LegacyAuthCollectionConfig {
    enabled: boolean;
    roles?: Record<string, RoleDefinition>;
    scopes?: Record<string, ScopeDefinition>;
    personalKeys?: boolean;
    onCreateUser?: (values: Record<string, unknown>, ctx: AuthCollectionContext) => Promise<AuthCollectionCreateResult>;
    onResetPassword?: (uid: string, ctx: AuthCollectionContext) => Promise<AuthCollectionResetResult>;
    /** The panel's reset-password action. */
    actions?: {
        resetPassword?: boolean | object;
    };
}
