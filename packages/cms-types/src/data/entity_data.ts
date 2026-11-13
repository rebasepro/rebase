import { FindParams, LogicalCondition, SDKTableClient, type AggregateParams, type RefreshOptions, type ComputedSortField, type ByIdReadOptions, type SearchMatch, WhereFilterOp, WhereValueFor, isUnsupported, DataDriver } from "@rebasepro/types";
import { TableAccessor, FindResponse, RebaseData } from "../types/table_accessor";
import { Entity, EntityValues } from "../types/entities";
import { toSnakeCase } from "@rebasepro/utils";
import { buildCompositeId, createDriverTableRows, etagOf, type DriverRowPage, type DriverTableRows, type PrimaryKeyInfo } from "@rebasepro/common";
import { QueryBuilder } from "./query_builder";

/**
 * What the admin's accessor (`RebaseData`) is told about a table it builds
 * `Entity` view models for — see {@link buildRebaseData} (over a driver) and
 * {@link wrapAsEntityData} (over an SDK client).
 */
export interface EntityDataOptions {
    /**
     * The key columns a row of `slug` is addressed by. `undefined` or empty:
     * not known (yet) — asked again for the next row, so a resolver registered
     * after the data layer was built is still seen.
     */
    primaryKeysOf?: (slug: string) => PrimaryKeyInfo[] | undefined;

    /**
     * The converter that turns a row `slug`'s driver serves into the values an
     * `Entity` of it carries — the admin registers the view model of its
     * collections here (`@rebasepro/cms-types`'s `collectionEntityDataOptions`).
     * Asked once per accessor; the converter itself is called per row. Absent,
     * or answering `undefined`, an entity carries the row as served.
     */
    viewModelOf?: (slug: string) => ((values: Record<string, unknown>) => Record<string, unknown>) | undefined;

    /**
     * The converter values pass through on their way to `slug`'s store — the
     * inverse half of {@link viewModelOf}. Absent: written as handed.
     */
    storedValuesOf?: (slug: string) => (<V extends Record<string, unknown>>(values: V) => V) | undefined;

    /**
     * The converter values pass through, after {@link storedValuesOf}, on
     * their way to an SDK client of wire rows ({@link wrapAsEntityData}
     * only): the admin turns its view model (`EntityRelation`, `Vector`,
     * `GeoPoint`, `Date`) into the values the REST API documents here. A
     * driver data source ({@link buildRebaseData}) is handed the view model
     * as it is — Firestore stores those classes natively. Absent: sent as
     * handed.
     */
    wireValuesOf?: (slug: string) => (<V extends Record<string, unknown>>(values: V) => V) | undefined;

    /**
     * The converter each value of a filter (`where`, `logical`) passes
     * through on its way to an SDK client of wire rows
     * ({@link wrapAsEntityData} only) — the admin sends a relation it filters
     * by as the related row's key. Called on every value, container or leaf,
     * outermost first: a value it hands back changed is not walked into.
     * Absent: filters are sent as handed.
     */
    wireFilterValueOf?: (slug: string) => ((value: unknown) => unknown) | undefined;

    /**
     * What `viewModelOf(slug)` converts with right now (the collection as
     * resolved). A live list keeps the entities it built while this stays the
     * same object.
     */
    viewModelSourceOf?: (slug: string) => unknown;

    /**
     * Translate the path a collection is addressed by into the path its driver
     * stores it under.
     *
     * The admin addresses every collection by its slug, and a Firestore
     * collection may declare a `path` of its own: `fs_diagnosis` stored
     * at `diagnosis`, and `fs_diagnosis/abc/locales` at `diagnosis/abc/locales`.
     * Only the driver is handed the stored path. Rows keep the address they
     * were asked for by, because that is what the admin resolves their
     * collection, routes and deletes by.
     *
     * Late-bound, like `primaryKeysOf`. Absent, or answering `undefined`,
     * the address is the stored path.
     */
    resolveDataPath?: (path: string) => string | undefined;

    /**
     * The slug a property of the proxy names (`data.myNotes`). Absent, a
     * property is its snake_case (`my_notes`). The server passes
     * `createAccessorSlugResolver` over its collection registry, so a
     * collection is reachable under the accessor its generated type has.
     */
    resolveAccessor?: (property: string) => string;
}

function createPrimaryKeyResolver(options?: EntityDataOptions) {
    const cache = new Map<string, PrimaryKeyInfo[]>();

    return function primaryKeysFor(slug: string): PrimaryKeyInfo[] {
        const cached = cache.get(slug);
        if (cached) return cached;
        const keys = options?.primaryKeysOf?.(slug) ?? [];
        // Memoized for the session once known: a table's key does not change
        // while the app runs, and this is called once per row. A miss is not
        // memoized — the resolver may not have been registered yet.
        if (keys.length > 0) cache.set(slug, keys);
        return keys;
    };
}

/**
 * Give a flat row the Entity view-model the admin renders.
 *
 * The address is *derived here* — it is not a column, and the row it came from
 * does not contain one. Rows carry exactly what the table has, with the types
 * Postgres returned; the id is this layer's invention, and this is the only
 * place it is minted.
 *
 * `primaryKeys` empty falls back to a literal `id` on the row: drivers other
 * than postgres still serve rows with one, and this keeps them working.
 */
function rowToEntity<M extends Record<string, unknown>>(
    row: Record<string, unknown>,
    slug: string,
    primaryKeys: PrimaryKeyInfo[] = [],
    /**
     * Turns the wire's row into the view model — see
     * {@link toViewModelValues}. Absent when the collections cannot be
     * resolved, which is every consumer that is not the admin: the flat SDK
     * derives itself from this layer and must keep the wire's own types.
     */
    toViewModel?: (values: Record<string, unknown>) => Record<string, unknown>
): Entity<M> {
    // Query-computed metadata rides in on the row because that is how the wire
    // carries it, but it is not a column: it belongs beside `values`, not in
    // them. Left inside, `_matches` would show up in the record inspector as a
    // field the collection never declared.
    const { _matches, ...values } = row as Record<string, unknown> & { _matches?: SearchMatch[] };
    // The version the read reported rides on the row out of sight (see
    // `withETag`); the entity carries it in the open, beside `values`.
    const etag = etagOf(row);

    return {
        id: primaryKeys.length > 0
            ? buildCompositeId(row, primaryKeys)
            : row.id as string | number,
        path: slug,
        values: (toViewModel ? toViewModel(values) : values) as EntityValues<M>,
        ...(_matches ? { searchMatches: _matches } : {}),
        ...(etag ? { etag } : {})
    };
}

/** {@link rowToEntity} over a page of rows, the primary keys looked up once for all of them. */
function rowsToEntities<M extends Record<string, unknown>>(
    rows: Record<string, unknown>[],
    slug: string,
    primaryKeys: PrimaryKeyInfo[],
    toViewModel?: (values: Record<string, unknown>) => Record<string, unknown>
): Entity<M>[] {
    return rows.map(row => rowToEntity<M>(row, slug, primaryKeys, toViewModel));
}

/**
 * The admin's accessor over a table's driver rows: each row becomes an
 * `Entity`, values on their way in pass `toStored`. Reads, writes, paging,
 * counting and subscriptions are the rows' own ({@link createDriverTableRows}),
 * the same the SDK is built on.
 */
function entityAccessorOverRows<M extends Record<string, unknown> = Record<string, unknown>>(
    rows: DriverTableRows<M>,
    slug: string,
    getPks: () => PrimaryKeyInfo[] = () => [],
    toViewModel?: (values: Record<string, unknown>) => Record<string, unknown>,
    /** Values on their way to the driver — see `createStoredValuesConverter`. */
    toStored: <V extends Record<string, unknown>>(values: V) => V = (values) => values
): TableAccessor<M> {
    const page = (res: DriverRowPage<M>): FindResponse<M> => ({
        data: rowsToEntities<M>(res.data, slug, getPks(), toViewModel),
        meta: res.meta
    });
    const entity = (row: M): Entity<M> => rowToEntity<M>(row, slug, getPks(), toViewModel);

    const accessor: TableAccessor<M> = {
        find: async (params?: FindParams<M>) => page(await rows.find(params)),

        async findById(id: string | number, options?: ByIdReadOptions): Promise<Entity<M> | undefined> {
            const row = await rows.findById(id, options);
            return row ? entity(row) : undefined;
        },

        aggregate: rows.aggregate,

        refresh: rows.refresh,

        create: async (data: Partial<EntityValues<M>>, id?: string | number) => entity(await rows.create(toStored(data), id)),

        createMany: rows.createMany
            ? async (data, options) => (await rows.createMany!(data.map(row => toStored(row)), options)).map(entity)
            : undefined,

        update: async (id: string | number, data: Partial<EntityValues<M>>) => entity(await rows.update(id, toStored(data))),

        delete: (id: string | number) => rows.delete(id),

        // Every write passes `toStored`, the batch ones too: an import that
        // updates in bulk stores a cross-source reference as its id, as a
        // single update does.
        updateMany: rows.updateMany
            ? async (updates) => (await rows.updateMany!(updates.map(({ id, data }) => ({ id, data: toStored(data) })))).map(entity)
            : undefined,

        deleteMany: rows.deleteMany,

        updateWhere: rows.updateWhere
            ? async (query, data) => (await rows.updateWhere!(query, toStored(data))).map(entity)
            : undefined,

        deleteWhere: rows.deleteWhere,

        count: rows.count,

        trash: {
            find: async (params?: FindParams<M>) => page(await rows.trash.find(params)),
            count: rows.trash.count,
            purge: rows.trash.purge,
            purgeMany: rows.trash.purgeMany
        },

        listen: rows.listen
            ? (params, onUpdate, onError) => rows.listen!(params, (res) => onUpdate(page(res)), onError)
            : undefined,

        listenById: rows.listenById
            ? (id, onUpdate, onError, options) => rows.listenById!(id, (row) => onUpdate(row ? entity(row) : undefined), onError, options)
            : undefined,

        // Fluent Query Builder
        where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
            const builder = new QueryBuilder<M>(accessor);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValueFor<WhereFilterOp, M[keyof M & string]>);
        },
        orderBy(column: (keyof M & string) | ComputedSortField, ascending?: "asc" | "desc") {
            return new QueryBuilder<M>(accessor).orderBy(column, ascending);
        },
        limit(count: number) {
            return new QueryBuilder<M>(accessor).limit(count);
        },
        offset(count: number) {
            return new QueryBuilder<M>(accessor).offset(count);
        },
        search(searchString: string, options?: { explain?: boolean }) {
            return new QueryBuilder<M>(accessor).search(searchString, options);
        },
        vectorSearch(
            property: string,
            vector: number[],
            options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
        ) {
            return new QueryBuilder<M>(accessor).vectorSearch(property, vector, options);
        },
        include(...relations: string[]) {
            return new QueryBuilder<M>(accessor).include(...relations);
        }
    };

    return accessor;
}

/**
 * Build a `RebaseData` object from a `DataDriver` using JavaScript Proxy.
 *
 * This is the key bridge: any property access like `data.products` returns
 * a `TableAccessor` backed by the underlying DataDriver, without
 * needing per-collection code generation.
 *
 * @example
 * const data = buildRebaseData(driver);
 * await data.products.create({ name: "Camera", price: 299 });
 * const { data: items } = await data.products.find({ where: { status: ["==", "published"] } });
 */
/** The view-model converter of `slug`'s rows, when the caller registered one (see `EntityDataOptions.viewModelOf`). */
function createViewModelConverter(options?: EntityDataOptions) {
    return (slug: string) => options?.viewModelOf?.(slug);
}

/** The converter values pass through on their way to `slug`'s store — identity unless the caller registered one. */
function createStoredValuesConverter(options?: EntityDataOptions) {
    return (slug: string) => options?.storedValuesOf?.(slug) ?? (<V extends Record<string, unknown>>(values: V): V => values);
}

/**
 * The converter values pass through on their way to an SDK client of wire
 * rows: `storedValuesOf`, then `wireValuesOf` — each identity unless the
 * caller registered one.
 */
function createSentValuesConverter(options?: EntityDataOptions) {
    const storedValuesFor = createStoredValuesConverter(options);
    return (slug: string) => {
        const stored = storedValuesFor(slug);
        const wire = options?.wireValuesOf?.(slug);
        return wire ? <V extends Record<string, unknown>>(values: V): V => wire(stored(values)) : stored;
    };
}

/** Read params whose filter values may need converting before they are sent. */
interface FilteredParams {
    where?: unknown;
    logical?: unknown;
}

/**
 * Every value of a filter through `convert`, outermost first: a `where`
 * record's tuples, a `logical` group's conditions. A value `convert` hands
 * back changed is taken as it is; an unchanged list or plain object is walked
 * into.
 */
function convertFilterValue(value: unknown, convert: (value: unknown) => unknown): unknown {
    const converted = convert(value);
    if (converted !== value) return converted;
    if (Array.isArray(value)) return value.map(item => convertFilterValue(item, convert));
    if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convertFilterValue(item, convert)]));
    }
    return value;
}

/** The filter converter of `slug` (see `EntityDataOptions.wireFilterValueOf`), applied to read params. */
function createSentFilterConverter(options?: EntityDataOptions) {
    return (slug: string) => <P extends FilteredParams>(params: P): P => {
        const convert = options?.wireFilterValueOf?.(slug);
        if (!convert || (params.where === undefined && params.logical === undefined)) return params;
        return {
            ...params,
            ...(params.where !== undefined ? { where: convertFilterValue(params.where, convert) } : {}),
            ...(params.logical !== undefined ? { logical: convertFilterValue(params.logical, convert) } : {})
        };
    };
}

export function buildRebaseData(driver: DataDriver, options?: EntityDataOptions): RebaseData {
    const cache = new Map<string, TableAccessor>();
    const primaryKeysFor = createPrimaryKeyResolver(options);
    const viewModelFor = createViewModelConverter(options);
    const storedValuesFor = createStoredValuesConverter(options);

    function getAccessor(slug: string): TableAccessor {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = entityAccessorOverRows(
                createDriverTableRows(driver, slug, { storedPath: () => options?.resolveDataPath?.(slug) ?? slug }),
                slug,
                () => primaryKeysFor(slug),
                viewModelFor(slug),
                storedValuesFor(slug)
            );
            cache.set(slug, accessor);
        }
        return accessor;
    }

    const target = {
        table: getAccessor
    } as RebaseData;

    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "table") return getAccessor;
            // Ignore Symbol properties (e.g. Symbol.toPrimitive, Symbol.iterator)
            if (typeof prop === "symbol") return undefined;
            // Ignore internal JS properties
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;

            // A table's own accessor name, else camelCase → snake_case.
            return getAccessor(options?.resolveAccessor?.(prop) ?? toSnakeCase(prop));
        }
    });
}

/**
 * Wrap a flat {@link SDKTableClient} into a Entity-shaped
 * {@link TableAccessor}. Every returned row is re-wrapped into the
 * `{ id, path, values }` view-model the admin panel renders.
 */
function toEntityAccessor<M extends Record<string, unknown>>(
    sdk: SDKTableClient<M>,
    slug: string,
    getPks: () => PrimaryKeyInfo[] = () => [],
    toViewModel?: (values: Record<string, unknown>) => Record<string, unknown>,
    /**
     * What `toViewModel` converts with — the collection as resolved now. A
     * live list keeps the entities it built for as long as this and the keys
     * stay the same object (see `listen`).
     */
    viewModelSource: () => unknown = () => undefined,
    /** Values on their way to the client — see `createSentValuesConverter`. */
    toStored: <V extends Record<string, unknown>>(values: V) => V = (values) => values,
    /** Read params on their way to the client — see `createSentFilterConverter`. */
    toSentFilter: <P extends FilteredParams>(params: P) => P = (params) => params
): TableAccessor<M> {
    const sent = <P extends FilteredParams>(params: P | undefined): P | undefined => params === undefined ? params : toSentFilter(params);
    const accessor: TableAccessor<M> = {
        async find(params?: FindParams<M>): Promise<FindResponse<M>> {
            const res = await sdk.find(sent(params));
            return { data: rowsToEntities<M>(res.data, slug, getPks(), toViewModel), meta: res.meta };
        },
        async findById(id: string | number, options?: ByIdReadOptions): Promise<Entity<M> | undefined> {
            const row = await sdk.findById(id, options);
            return row ? rowToEntity<M>(row, slug, getPks(), toViewModel) : undefined;
        },
        async create(data: Partial<EntityValues<M>>, id?: string | number): Promise<Entity<M>> {
            return rowToEntity<M>(await sdk.create(toStored(data) as Partial<M>, id), slug, getPks(), toViewModel);
        },
        // Declared on `TableAccessor` and, until now, never implemented on
        // this side of the boundary — so the admin's own import wrote one HTTP
        // request per row and could neither be atomic nor upsert. It forwards to
        // the same `/bulk` route the SDK client uses.
        createMany: sdk.createMany
            ? async (
                data: Partial<EntityValues<M>>[],
                options?: { upsert?: boolean; onConflict?: readonly string[] }
            ): Promise<Entity<M>[]> => {
                const rows = await sdk.createMany!(data.map(row => toStored(row)) as Partial<M>[], options);
                return rowsToEntities<M>(rows, slug, getPks(), toViewModel);
            }
            : undefined,
        async update(id: string | number, data: Partial<EntityValues<M>>, options?: { ifMatch?: string }): Promise<Entity<M>> {
            const stored = toStored(data);
            const row = options?.ifMatch
                ? await sdk.update(id, stored as Partial<M>, { ifMatch: options.ifMatch })
                : await sdk.update(id, stored as Partial<M>);
            if (!row) throw new Error(`Update returned no data for id ${id}`);
            return rowToEntity<M>(row, slug, getPks(), toViewModel);
        },
        delete(id: string | number): Promise<void> {
            return sdk.delete(id);
        },
        // `TableAccessor` keeps these optional, and the optionality is
        // load-bearing: the admin panel picks between subscribing and a
        // one-shot `find()` on exactly this property, and a UI that subscribes
        // into a throw is worse than one that polls. The client's method is
        // always present now, so the capability is read off the stub instead.
        count: isUnsupported(sdk.count) ? undefined : (params?: FindParams<M>) => sdk.count(sent(params)),
        aggregate: isUnsupported(sdk.aggregate)
            ? undefined
            : (params: AggregateParams<M>) => sdk.aggregate(toSentFilter(params)),
        refresh: isUnsupported(sdk.refresh)
            ? undefined
            : (options?: RefreshOptions) => sdk.refresh(options),
        listen: isUnsupported(sdk.listen)
            ? undefined
            : (params: FindParams<M> | undefined, onUpdate: (r: FindResponse<M>) => void, onError?: (e: Error) => void) => {
                // One entity per row object, for as long as the subscription
                // lives. The socket hands back the very row it cached when a
                // refetch of it is equal (`mergeRows`), so a push that changed
                // one row of fifty arrives with forty-nine rows it has seen;
                // building fifty new entities threw that away, and every view
                // downstream compared fifty rows by value again. Keyed on the
                // row object, so only a row the socket kept is reused, and
                // dropped whenever the keys or the collection the values are
                // converted with change (a key learned late, a schema edit).
                let built = new WeakMap<object, Entity<M>>();
                let builtWith: [PrimaryKeyInfo[], unknown] | undefined;
                return sdk.listen(sent(params), (res) => {
                    const pks = getPks();
                    const source = viewModelSource();
                    if (!builtWith || builtWith[0] !== pks || builtWith[1] !== source) {
                        built = new WeakMap();
                        builtWith = [pks, source];
                    }
                    onUpdate({
                        data: res.data.map((row) => {
                            let entity = built.get(row);
                            if (!entity) {
                                entity = rowToEntity<M>(row, slug, pks, toViewModel);
                                built.set(row, entity);
                            }
                            return entity;
                        }),
                        meta: res.meta
                    });
                }, onError);
            },
        listenById: isUnsupported(sdk.listenById)
            ? undefined
            : (id: string | number, onUpdate: (s: Entity<M> | undefined) => void, onError?: (e: Error) => void, options?: ByIdReadOptions) =>
                sdk.listenById(id, (row) => onUpdate(row ? rowToEntity<M>(row, slug, getPks(), toViewModel) : undefined), onError, options),
        listenCount: isUnsupported(sdk.listenCount)
            ? undefined
            : (params: FindParams<M> | undefined, onCount: (total: number) => void, onError?: (e: Error) => void) =>
                sdk.listenCount(sent(params), onCount, onError),
        trash: !sdk.trash || isUnsupported(sdk.trash.find)
            ? undefined
            : {
                async find(params?: FindParams<M>): Promise<FindResponse<M>> {
                    const res = await sdk.trash.find(sent(params));
                    return { data: rowsToEntities<M>(res.data, slug, getPks(), toViewModel), meta: res.meta };
                },
                count: (params?: FindParams<M>) => sdk.trash.count(sent(params)),
                purge: (id: string | number) => sdk.trash.purge(id),
                purgeMany: (ids: (string | number)[]) => sdk.trash.purgeMany(ids)
            },
        where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
            const builder = new QueryBuilder<M>(accessor);
            if (typeof columnOrCondition === "object") {
                return builder.where(columnOrCondition);
            }
            return builder.where(columnOrCondition as keyof M & string, operator!, value as WhereValueFor<WhereFilterOp, M[keyof M & string]>);
        },
        orderBy: (column: keyof M & string, direction?: "asc" | "desc") => new QueryBuilder<M>(accessor).orderBy(column, direction),
        limit: (count: number) => new QueryBuilder<M>(accessor).limit(count),
        offset: (count: number) => new QueryBuilder<M>(accessor).offset(count),
        search: (searchString: string) => new QueryBuilder<M>(accessor).search(searchString),
        vectorSearch: (
            property: string,
            vector: number[],
            options?: { distance?: "cosine" | "l2" | "inner_product"; threshold?: number }
        ) => new QueryBuilder<M>(accessor).vectorSearch(property, vector, options),
        include: (...relations: string[]) => new QueryBuilder<M>(accessor).include(...relations)
    };
    return accessor;
}

/**
 * Wrap a flat {@link RebaseSdkData} into a Entity-shaped {@link RebaseData}.
 *
 * This is the **admin boundary**: the SDK client (`client.data`) returns flat
 * rows, but the admin renders the `Entity` view-model (`entity.values.*`).
 * `core/Rebase.tsx` wraps `client.data` through this before handing it to the
 * admin `RebaseDataContext` — without it the admin renders rows with only their
 * `id`.
 */
/**
 * Only the by-slug accessor is asked for, so only that is required.
 *
 * Taking a whole `RebaseSdkData` meant taking `RebaseSdkData<unknown>`, whose
 * dynamic branch is an index signature — and no `RebaseSdkData<DB>` satisfies
 * it, because its own `collection` method is not a `SDKTableClient`. So a
 * caller holding a *typed* client could not pass it to a function that reads
 * one method off it, and that method is identical on every instantiation.
 * It is asked for untyped, as it is read: every `RebaseSdkData` has one.
 */
export function wrapAsEntityData(sdkData: { table(slug: string): SDKTableClient }, options?: EntityDataOptions): RebaseData {
    const cache = new Map<string, TableAccessor>();
    const primaryKeysFor = createPrimaryKeyResolver(options);
    const viewModelFor = createViewModelConverter(options);
    const sentValuesFor = createSentValuesConverter(options);
    const sentFilterFor = createSentFilterConverter(options);

    function getAccessor(slug: string): TableAccessor {
        let accessor = cache.get(slug);
        if (!accessor) {
            accessor = toEntityAccessor(sdkData.table(slug), slug, () => primaryKeysFor(slug), viewModelFor(slug),
                () => options?.viewModelSourceOf?.(slug), sentValuesFor(slug), sentFilterFor(slug));
            cache.set(slug, accessor);
        }
        return accessor;
    }

    const target = { table: getAccessor } as RebaseData;

    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "table") return getAccessor;
            if (typeof prop === "symbol") return undefined;
            if (prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;
            return getAccessor(toSnakeCase(prop));
        }
    });
}
