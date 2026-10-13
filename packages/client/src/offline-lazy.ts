import {
    isUnsupported,
    type ByIdReadOptions,
    type FindAllParams,
    type IterateParams,
    type LogicalCondition,
    type SDKCollectionClient,
    type UpdateValues,
    type UpsertOptions,
    type WhereFilterOp,
    type WhereValueFor,
    type WriteOptions
} from "@rebasepro/types";
import type { FindParams } from "./transport";
import type {
    CollectionClient,
    LiveResult,
    ObserveByIdOptions,
    ObserveOptions,
    RestoreOptions,
    RowSnapshotMeta,
    TrashClient
} from "./collection";
import type { OfflineApi, OfflineConfig, OfflineManager, OfflineQueueOptions, OfflineStatus } from "./offline";
import { SDKQueryBuilder } from "./sdk_query_builder";

type AnyRow = Record<string, unknown>;
type InnerFactory = (slug: string) => SDKCollectionClient<AnyRow>;

/**
 * `createRebaseClient({ offline })`'s handle on the sync engine, which it
 * fetches with `import()` the moment the client is created.
 *
 * The engine ({@link OfflineManager} and the local query evaluator, store and
 * codec it brings) is most of the SDK's weight, and a client created without
 * `offline` never runs a line of it. It used to be a static import of the
 * client factory, so every app built on the SDK downloaded it before its first
 * paint whether or not it turned offline on.
 *
 * Everything the factory and the app reach is here, with the same shape:
 *
 * - Calls made before the engine has arrived are queued and run, in the order
 *   they were made, the moment it does — the scope changes the factory makes
 *   from auth events, and every collection a client wrapped meanwhile.
 * - What answers with a promise waits for the engine and then asks it.
 * - What answers synchronously answers what the engine would have before
 *   anything ran: `status()` is the initial status, a subscription is
 *   registered as soon as there is something to register it with, and its
 *   unsubscribe works before and after.
 *
 * Once the engine is there every call goes straight to it.
 *
 * @internal
 */
export class LazyOfflineManager {
    private engine?: OfflineManager;
    private loadError?: unknown;
    private queued: ((engine: OfflineManager) => void)[] = [];
    private readonly failed: ((error: unknown) => void)[] = [];
    readonly api: OfflineApi;
    readonly keepsLastUser: boolean;

    constructor(config: OfflineConfig, createInner: InnerFactory) {
        this.keepsLastUser = config.keepLastUser === true;
        import("./offline").then(({ OfflineManager: Engine }) => {
            const engine = new Engine(config, createInner);
            this.engine = engine;
            const queued = this.queued;
            this.queued = [];
            this.failed.length = 0;
            for (const op of queued) op(engine);
        }).catch((error: unknown) => {
            this.loadError = error;
            this.queued = [];
            console.error("[Rebase] The offline engine could not be loaded; offline is unavailable on this client.", error);
            for (const reject of this.failed.splice(0)) reject(error);
        });

        this.api = {
            sync: async () => await (await this.run((engine) => engine.api.sync())),
            pending: async (options?: OfflineQueueOptions) => await (await this.run((engine) => engine.api.pending(options))),
            clear: async (options?: OfflineQueueOptions) => await (await this.run((engine) => engine.api.clear(options))),
            status: (): OfflineStatus => this.engine
                ? this.engine.api.status()
                : { online: !(typeof navigator !== "undefined" && navigator.onLine === false), syncing: false, pending: 0 },
            onStatusChange: (listener) => this.subscribe((engine) => engine.api.onStatusChange(listener)),
            onQueueChange: (listener) => this.subscribe((engine) => engine.api.onQueueChange(listener))
        };
    }

    /**
     * Run `op` on the engine: now if it is there, otherwise once it is, after
     * everything queued before it.
     */
    private run<T>(op: (engine: OfflineManager) => T): Promise<T> {
        if (this.engine) {
            try {
                return Promise.resolve(op(this.engine));
            } catch (error) {
                return Promise.reject(error);
            }
        }
        if (this.loadError !== undefined) return Promise.reject(this.loadError);
        return new Promise<T>((resolve, reject) => {
            this.failed.push(reject);
            this.queued.push((engine) => {
                try {
                    resolve(op(engine));
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    /** A subscription made now, registered on the engine as soon as there is one. */
    private subscribe(start: (engine: OfflineManager) => () => unknown, onError?: (error: Error) => void): () => void {
        if (this.engine) {
            const stop = start(this.engine);
            return () => { stop(); };
        }
        let stop: (() => unknown) | undefined;
        let cancelled = false;
        this.run((engine) => {
            if (!cancelled) stop = start(engine);
        }).catch((error: unknown) => {
            onError?.(error instanceof Error ? error : new Error(String(error)));
        });
        return () => {
            cancelled = true;
            stop?.();
            stop = undefined;
        };
    }

    holdScope(): void {
        void this.run((engine) => engine.holdScope()).catch(() => undefined);
    }

    setScope(uid: string | undefined, options?: { unverified?: boolean }): void {
        void this.run((engine) => engine.setScope(uid, options)).catch(() => undefined);
    }

    async resumeLastUser(): Promise<void> {
        await (await this.run((engine) => engine.resumeLastUser()));
    }

    dispose(): void {
        void this.run((engine) => engine.dispose()).catch(() => undefined);
    }

    /**
     * The engine's wrapper around `inner` — itself once the engine is there,
     * and until then a client of the same shape that hands each call to it.
     */
    wrap<M extends AnyRow>(slug: string, inner: CollectionClient<M>): CollectionClient<M> {
        if (this.engine) return this.engine.wrap(slug, inner);

        let real: CollectionClient<M> | undefined;
        void this.run((engine) => { real = engine.wrap(slug, inner); }).catch(() => undefined);
        const client = async (): Promise<CollectionClient<M>> => {
            if (!real) await this.run(() => undefined);
            return real!;
        };
        const live = (start: (target: CollectionClient<M>) => () => void, onError?: (error: Error) => void): () => void =>
            real ? start(real) : this.subscribe(() => start(real!), onError);

        const trash: TrashClient<M> = {
            find: async (params?: FindParams<M>) => (await client()).trash.find(params),
            count: async (params?: FindParams<M>) => (await client()).trash.count(params),
            restore: async (id: string | number, options?: RestoreOptions<M>) => (await client()).trash.restore(id, options),
            restoreMany: async (ids: (string | number)[], options?: RestoreOptions<M>) => (await client()).trash.restoreMany(ids, options),
            purge: async (id: string | number, options?: WriteOptions) => (await client()).trash.purge(id, options),
            purgeMany: async (ids: (string | number)[], options?: WriteOptions) => (await client()).trash.purgeMany(ids, options)
        };

        const deferred: CollectionClient<M> = {
            find: async (params?: FindParams<M>) => (await client()).find(params),
            iterate: (params?: IterateParams<M>) => (async function* () {
                yield* (await client()).iterate(params);
            })(),
            findAll: async (params?: FindAllParams<M>) => (await client()).findAll(params),
            findById: async (id: string | number, options?: ByIdReadOptions) => (await client()).findById(id, options),
            get: async (id: string | number) => (await client()).get(id),
            create: async (data: Partial<M>, id?: string | number, options?: WriteOptions) => (await client()).create(data, id, options),
            createMany: async (
                data: Partial<M>[],
                options?: { upsert?: boolean; onConflict?: readonly string[] } & WriteOptions
            ) => (await client()).createMany(data, options),
            upsert: async (data: Partial<M>, options?: UpsertOptions) => (await client()).upsert(data, options),
            updateMany: async (
                updates: { id: string | number; data: Partial<M> | UpdateValues<Partial<M>> }[],
                options?: WriteOptions
            ) => (await client()).updateMany(updates, options),
            deleteMany: async (ids: (string | number)[], options?: WriteOptions) => (await client()).deleteMany(ids, options),
            update: async (
                id: string | number,
                data: Partial<M> | UpdateValues<Partial<M>>,
                options?: WriteOptions
            ) => (await client()).update(id, data, options),
            delete: async (id: string | number, options?: WriteOptions) => (await client()).delete(id, options),
            count: async (params?: FindParams<M>): Promise<number> => (await client()).count(params),
            observe: (
                params: FindParams<M> | undefined,
                onResult: (result: LiveResult<M>) => void,
                onError?: (error: Error) => void,
                options?: ObserveOptions
            ) => live((target) => target.observe(params, onResult, onError, options), onError),
            observeById: (
                id: string | number,
                onResult: (row: M | undefined, meta: RowSnapshotMeta) => void,
                onError?: (error: Error) => void,
                options?: ObserveByIdOptions
            ) => live((target) => target.observeById(id, onResult, onError, options), onError),
            // As the engine does: a client that cannot listen keeps the inner
            // client's marker, so `isUnsupported(client.listen)` still says so.
            listen: isUnsupported(inner.listen)
                ? inner.listen
                : (params, onUpdate, onError) => live((target) => target.listen(params, onUpdate, onError), onError),
            listenById: isUnsupported(inner.listenById)
                ? inner.listenById
                : (id, onUpdate, onError, options) => live((target) => target.listenById(id, onUpdate, onError, options), onError),
            // The engine hands these to the inner client as they are.
            listenCount: inner.listenCount,
            aggregate: inner.aggregate,
            where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
                const builder = new SDKQueryBuilder<M>(deferred);
                if (typeof columnOrCondition === "object") return builder.where(columnOrCondition);
                return builder.where(
                    columnOrCondition as keyof M & string,
                    operator!,
                    value as WhereValueFor<WhereFilterOp, M[keyof M & string]>
                );
            },
            orderBy: (column, direction, nulls) => new SDKQueryBuilder<M>(deferred).orderBy(column, direction, nulls),
            limit: (count) => new SDKQueryBuilder<M>(deferred).limit(count),
            offset: (count) => new SDKQueryBuilder<M>(deferred).offset(count),
            search: (searchString, options) => new SDKQueryBuilder<M>(deferred).search(searchString, options),
            vectorSearch: (property, vector, options) => new SDKQueryBuilder<M>(deferred).vectorSearch(property, vector, options),
            include: (...relations) => new SDKQueryBuilder<M>(deferred).include(...relations),
            fields: (...columns) => new SDKQueryBuilder<M>(deferred).fields(...columns),
            distinct: (enabled) => new SDKQueryBuilder<M>(deferred).distinct(enabled),
            after: (cursor) => new SDKQueryBuilder<M>(deferred).after(cursor),
            trash
        };
        return deferred;
    }
}
