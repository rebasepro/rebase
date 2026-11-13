/**
 * `beforeQuery`: the one place a table hook can change *which* rows a read
 * asks for.
 *
 * `afterRead` runs over rows that have already been fetched, so until this
 * existed an application developer who needed the read itself narrowed — a
 * tenant scope, a visibility window, a per-role row filter — had two options:
 * patch this driver, or `rebase eject`.
 *
 * Two properties are load-bearing, and both belong to the *shape* of the thing
 * rather than to how carefully each call site was written.
 *
 * ## It can only narrow
 *
 * A hook returns a {@link QueryNarrowing} — a declarative filter, optionally a
 * logical group — which is AND-ed into the query the caller sent. `AND(q, c)`
 * is a subset of `q` for every `c`, so there is no `c` a hook can return that
 * widens a read. The obvious alternative shape, `(query) => query`, can: a
 * hook that drops a condition on the way through runs the query without it,
 * and on an RLS data plane a dropped condition returns everything the policies
 * happen to allow. That is the same reasoning behind
 * `UnknownFilterFieldsMode` defaulting to `"error"`, and it is why that mode is
 * **forced** to `"error"` for a hook's own filter here whatever the
 * process-wide setting is: a scope condition naming a renamed column has to
 * refuse the request, never be dropped from it.
 *
 * ## It cannot be skipped
 *
 * The hooks are resolved *by the read path itself*, out of the registry that
 * read already holds — not handed to it by a caller who might forget. So a
 * read that compiles a WHERE compiles this one too, or it throws.
 *
 * The one thing a read path cannot derive is the identity the hook runs as:
 * `FetchService`, `RelationService` and `DataService` carry no user. That
 * arrives as a {@link ReadCallContextProvider}, threaded from the driver that
 * constructed them — the driver is the only object that knows both the caller
 * and the connection, and it constructs a service per transaction anyway, so
 * there is exactly one place per instance to pass it.
 *
 * Absence is the interesting case, and it fails closed: a service built with no
 * provider refuses any read of a collection that declares `beforeQuery`, with
 * a message naming the collection. So a future construction site that forgets
 * the provider breaks loudly on the first scoped collection instead of quietly
 * serving every row — which is the failure mode this whole module exists to
 * rule out. A deployment with no `beforeQuery` anywhere never reaches any of
 * this: the check is one map lookup and the compiled SQL is byte-identical.
 *
 * @module
 */
import { and, SQL } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type {
    QueryNarrowing,
    ReadOperation,
    ReadQuery,
    RebaseCallContext,
    TableDescriptor,
    TableHooks
} from "@rebasepro/types";
import type { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import type { RuntimeTable } from "../model/runtime-table";
import { assertViewReadable } from "./view-access";
import {
    DrizzleConditionBuilder,
    type FilterCompilationOptions,
    type UnknownFilterFieldsMode
} from "../utils/drizzle-conditions";

/**
 * How a read path reaches the context its `beforeQuery` hooks run with.
 *
 * A function rather than the context itself, because the driver's transaction
 * handle and its `data` plane are established *after* it constructs the
 * services that read through them — and because building a context costs an
 * object that a collection with no hooks should never pay for.
 */
export type ReadCallContextProvider = () => RebaseCallContext;

/** The `beforeQuery` hooks of one table, in the order they run, and the table they run for. */
interface ResolvedBeforeQuery {
    hooks: NonNullable<TableHooks["beforeQuery"]>[];
    /** The table the hooks are told about; `undefined` when the path names no table here. */
    table: TableDescriptor | undefined;
}

/**
 * The `beforeQuery` hooks that apply to one table, in the order they run.
 *
 * Global first, then the table's own (`defineTable({ hooks })`, or attached
 * with `setTableHooks`) — the same order `afterRead` and `beforeSave` use. The
 * order changes nothing about the outcome here (both are AND-ed in, so neither
 * can relax the other) and is kept because a hook that logs or measures
 * should see the same sequence everywhere.
 *
 * There is no column tier: a column's `.transform()` shapes one value on a
 * row, and a row filter is not a value.
 */
function resolveBeforeQuery(
    registry: PostgresTableRegistry | undefined,
    table: RuntimeTable | undefined
): ResolvedBeforeQuery {
    const hooks: NonNullable<TableHooks["beforeQuery"]>[] = [];
    const global = registry?.globalHooks();
    if (global?.beforeQuery) hooks.push(global.beforeQuery);
    const own = table?.compiled.hooks;
    if (own?.beforeQuery) hooks.push(own.beforeQuery);
    return { hooks, table: table?.descriptor };
}

/** Whether anything at all would run for this table. */
export function hasBeforeQuery(
    registry: PostgresTableRegistry | undefined,
    table: RuntimeTable | undefined
): boolean {
    return resolveBeforeQuery(registry, table).hooks.length > 0;
}

/**
 * What a read path is about to compile, in the form a hook is shown it.
 *
 * Built by the caller rather than derived here, because only the caller knows
 * which of its options are part of the query and which are transport — a
 * `databaseId`, an `include` tree, a `withDeleted` flag are not "which rows".
 */
export interface ReadQueryDescription {
    operation: ReadOperation;
    query: ReadQuery;
}

/** Everything `beforeQueryConditions` needs that is not about this one read. */
export interface BeforeQueryEnv {
    registry: PostgresTableRegistry | undefined;
    /**
     * The context provider the driver handed down. `undefined` means no driver
     * built this service, which is a refusal rather than a bypass — see the
     * module comment.
     */
    callContext: ReadCallContextProvider | undefined;
}

/**
 * The conditions every `beforeQuery` hook for this collection asks to add.
 *
 * Returned as a list rather than pre-combined so a caller pushes them onto the
 * same `allConditions` array its own filter goes into. Every caller AND-es
 * that array, which is what makes these additive — the hook is not trusted to
 * narrow, it is only ever given a way to.
 */
export async function beforeQueryConditions(
    env: BeforeQueryEnv,
    runtime: RuntimeTable | undefined,
    path: string,
    table: PgTable<never>,
    description: ReadQueryDescription,
    filterContext: Omit<FilterCompilationOptions, "unknownFields">
): Promise<SQL[]> {
    // Every read of a table comes through here, so a materialized view's
    // roles are judged here too (see `view-access.ts`).
    assertViewReadable(runtime?.descriptor);
    const { hooks, table: hookTable } = resolveBeforeQuery(env.registry, runtime);
    if (hooks.length === 0) return [];

    if (!runtime || !hookTable) {
        // A hook reaching here with no table can only be a global one, and a
        // global hook has no columns to compile its filter against. It cannot
        // be honoured — so it is refused, not skipped.
        throw new Error(
            `[beforeQuery] "${path}" resolves to no table this driver serves, so a global \`beforeQuery\` cannot ` +
            "be compiled against it. Serve the table from backend/schema, or narrow the hook to the tables it applies to."
        );
    }

    if (!env.callContext) {
        throw new Error(
            `[beforeQuery] The table "${runtime.slug}" has a \`beforeQuery\` hook, and this read was compiled by a ` +
            "service that was built without a call-context provider, so the hook could not run. Serving the read " +
            "unnarrowed is not an option — a hook that does not run widens the result set. Construct the " +
            "service through the driver (which passes one), or pass a provider explicitly."
        );
    }
    const context = env.callContext();

    // Always fatal, whatever `configureUnknownFilterFields` was set to. The
    // process-wide `"warn"` mode exists for a deployment that knowingly sends
    // filter keys its tables do not have; a scope condition is not that, and
    // dropping one is precisely the widening that mode's own doc comment is
    // about.
    const unknownFields: UnknownFilterFieldsMode = "error";
    const options: FilterCompilationOptions = { ...filterContext, unknownFields };

    const conditions: SQL[] = [];
    for (const hook of hooks) {
        const narrowing: QueryNarrowing | void = await hook({
            table: hookTable,
            path,
            operation: description.operation,
            query: description.query,
            context
        });

        if (!narrowing) continue;

        // A hook that returned an object but expressed nothing in it is almost
        // certainly a branch that meant to build a filter and did not, and the
        // failure is invisible: the read is served whole. Refusing is the loud
        // half, and it comes before the compile so the message is about the
        // hook rather than about an empty condition list.
        if (!narrowing.filter && !narrowing.logical) {
            throw new Error(
                `[beforeQuery] The \`beforeQuery\` hook of "${runtime.slug}" returned an object with neither \`filter\` nor \`logical\`. ` +
                "Return nothing (or `undefined`) to add no conditions; an empty object reads as a scope that was " +
                "meant to be built and was not."
            );
        }

        if (narrowing.filter) {
            conditions.push(...DrizzleConditionBuilder.buildFilterConditions(
                narrowing.filter, table, path, options
            ));
        }
        if (narrowing.logical) {
            const logical = DrizzleConditionBuilder.buildLogicalConditions(
                narrowing.logical, table, path, options
            );
            if (logical) conditions.push(logical);
        }
    }
    return conditions;
}

/**
 * {@link beforeQueryConditions}, pre-combined, for the read paths that hold a
 * single `SQL` rather than a list of them — a single get, a relation loader.
 */
export async function beforeQueryCondition(
    env: BeforeQueryEnv,
    runtime: RuntimeTable | undefined,
    path: string,
    table: PgTable<never>,
    description: ReadQueryDescription,
    filterContext: Omit<FilterCompilationOptions, "unknownFields">
): Promise<SQL | undefined> {
    const conditions = await beforeQueryConditions(env, runtime, path, table, description, filterContext);
    if (conditions.length === 0) return undefined;
    if (conditions.length === 1) return conditions[0];
    return and(...conditions);
}
