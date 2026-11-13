/**
 * The pre-0.31 collection callbacks, frozen at 0.30 — part of the migration's
 * input format (see `./index.ts`). Nothing at runtime may import it. The lift
 * carries them as table hooks that call the legacy function with these props.
 */
import type {
    EntityStatus,
    FilterValues,
    GeneratedDatabase,
    LogicalCondition,
    OrderByTuple,
    RebaseCallContext,
    User
} from "@rebasepro/types";

import type { LegacyCollectionConfig } from "./collections";

/**
 * A legacy collection's callbacks.
 *
 * @group Migration
 */
export type LegacyCollectionCallbacks<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> = {
    afterRead?(props: LegacyAfterReadProps<M, USER>): Promise<Record<string, unknown>> | Record<string, unknown>;
    beforeQuery?(props: LegacyBeforeQueryProps<M, USER>): Promise<LegacyQueryNarrowing<M> | void> | LegacyQueryNarrowing<M> | void;
    beforeSave?(props: LegacyBeforeSaveProps<M, USER>): Promise<Partial<M>> | Partial<M>;
    afterSave?(props: LegacyAfterSaveProps<M, USER>): Promise<void> | void;
    afterSaveError?(props: LegacyAfterSaveErrorProps<M, USER>): Promise<void> | void;
    beforeDelete?(props: LegacyBeforeDeleteProps<M, USER>): Promise<boolean | void> | boolean | void;
    afterDelete?(props: LegacyAfterDeleteProps<M, USER>): Promise<void> | void;
};

/**
 * What `afterRead` received.
 *
 * @group Migration
 */
export interface LegacyAfterReadProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {
    collection: LegacyCollectionConfig<M>;
    path: string;
    row: Record<string, unknown>;
    context: RebaseCallContext<USER, GeneratedDatabase>;
}

/**
 * The read `beforeQuery` saw.
 *
 * @group Migration
 */
export type LegacyReadOperation = "list" | "get" | "count" | "aggregate" | "relation";

/**
 * The query `beforeQuery` saw.
 *
 * @group Migration
 */
export interface LegacyReadQuery<M extends Record<string, unknown> = Record<string, unknown>> {
    readonly filter?: Readonly<FilterValues<Extract<keyof M, string>>>;
    readonly logical?: Readonly<LogicalCondition>;
    readonly searchString?: string;
    readonly limit?: number;
    readonly offset?: number;
    readonly orderBy?: readonly Readonly<OrderByTuple>[];
    readonly fields?: readonly string[];
    readonly relatedTo?: {
        readonly parentSlug: string;
        readonly parentId?: string | number;
        readonly relationName: string;
    };
}

/**
 * What `beforeQuery` may return: conditions AND-ed into the read.
 *
 * @group Migration
 */
export interface LegacyQueryNarrowing<M extends Record<string, unknown> = Record<string, unknown>> {
    filter?: FilterValues<Extract<keyof M, string>>;
    logical?: LogicalCondition;
}

/**
 * What `beforeQuery` received.
 *
 * @group Migration
 */
export interface LegacyBeforeQueryProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {
    collection: LegacyCollectionConfig<M>;
    path: string;
    operation: LegacyReadOperation;
    query: LegacyReadQuery<M>;
    context: RebaseCallContext<USER, GeneratedDatabase>;
}

/**
 * What `beforeSave` received.
 *
 * @group Migration
 */
export type LegacyBeforeSaveProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    Omit<LegacyAfterSaveProps<M, USER>, "id"> & { id?: string | number };

/**
 * What `afterSaveError` received.
 *
 * @group Migration
 */
export type LegacyAfterSaveErrorProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> =
    Omit<LegacyAfterSaveProps<M, USER>, "id"> & { id?: string | number; error: unknown };

/**
 * What `afterSave` received.
 *
 * @group Migration
 */
export interface LegacyAfterSaveProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {
    collection: LegacyCollectionConfig<M>;
    path: string;
    id: string | number;
    values: Partial<M>;
    previousValues?: Partial<M>;
    status: EntityStatus;
    context: RebaseCallContext<USER, GeneratedDatabase>;
}

/**
 * What `beforeDelete` received.
 *
 * @group Migration
 */
export interface LegacyBeforeDeleteProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {
    collection: LegacyCollectionConfig<M>;
    path: string;
    id: string | number;
    row: Record<string, unknown>;
    context: RebaseCallContext<USER, GeneratedDatabase>;
}

/**
 * What `afterDelete` received.
 *
 * @group Migration
 */
export interface LegacyAfterDeleteProps<M extends Record<string, unknown> = Record<string, unknown>, USER extends User = User> {
    collection: LegacyCollectionConfig<M>;
    path: string;
    id: string | number;
    row: Record<string, unknown>;
    context: RebaseCallContext<USER, GeneratedDatabase>;
}
