import type { EntityStatus, RebaseSdkData, SDKCollectionClient, WriteOptions } from "@rebasepro/types";
import type { AdminCollection, RebaseContext } from "@rebasepro/cms-types";
import { buildCompositeId, resolvePrimaryKeys } from "@rebasepro/common";
import { toSnakeCase } from "@rebasepro/utils";
import type { SdkDataLayer } from "./sdkData";
import { signalWrite } from "./dataChanges";
import { deleteWithCallbacks, writeWithSaveCallbacks } from "./writeCallbacks";

type Row = Record<string, unknown>;

/**
 * A collection the admin registered — what its `browserCallbacks` are handed.
 * The data layer's resolver is typed for any data source's config; this is
 * the admin's.
 */
function isAdminCollection(value: object | undefined): value is AdminCollection {
    return value !== undefined
        && "slug" in value && typeof value.slug === "string"
        && "properties" in value && typeof value.properties === "object" && value.properties !== null;
}

/** A row's own `id` column, where it has one. */
function idOf(row: Row): string | number | undefined {
    const id = row.id;
    return typeof id === "string" || typeof id === "number" ? id : undefined;
}

/**
 * The single-row writes of a `<Rebase>`'s flat layer, each inside the
 * collection's `browserCallbacks` and each said on its change signal: what
 * `useRowWrites` and the browser's `context.data` write through.
 *
 * @internal
 */
export interface RowWriter {
    create(slug: string, values: Row, id?: string | number, options?: WriteOptions): Promise<Row>;
    update(slug: string, id: string | number, values: Row, options?: WriteOptions): Promise<Row>;
    remove(slug: string, id: string | number, options?: WriteOptions): Promise<void>;
}

/**
 * Build the {@link RowWriter} over a flat layer.
 *
 * A write runs the collection's `admin.browserCallbacks` as the record form's
 * save does: `beforeSave` (which may change the row, or throw to stop the
 * write), then `afterSave` or `afterSaveError`; and `beforeDelete`, then
 * `afterDelete`. They are handed rows as the server sends them — the values
 * given, the row as it was (`previousValues`), the row as saved — and what
 * `beforeSave` returns is written as it is. Where the collection has
 * callbacks, an update or a delete reads the row first; without, it reads
 * nothing.
 *
 * @param context the context the callbacks are handed, read when a write runs
 * @internal
 */
export function createRowWriter(
    { data, changes, resolveCollection }: SdkDataLayer,
    context: () => RebaseContext
): RowWriter {

    /** The collection whose browser callbacks a save or a delete of `slug` runs, where it has any. */
    const callbacksOf = (slug: string, write: "save" | "delete"): AdminCollection | undefined => {
        const collection = resolveCollection(slug);
        if (!isAdminCollection(collection)) return undefined;
        const callbacks = collection.browserCallbacks;
        const runs = write === "save"
            ? Boolean(callbacks?.beforeSave || callbacks?.afterSave || callbacks?.afterSaveError)
            : Boolean(callbacks?.beforeDelete || callbacks?.afterDelete);
        return runs ? collection : undefined;
    };

    const send = (slug: string, status: EntityStatus, values: Row, id: string | number | undefined, options: WriteOptions | undefined): Promise<Row> => {
        const accessor = data.collection(slug);
        // Options only where given: a write without them is the call it always was.
        return signalWrite(changes, slug, () => status === "existing" && id !== undefined
            ? options ? accessor.update(id, values, options) : accessor.update(id, values)
            : options ? accessor.create(values, id, options) : accessor.create(values, id));
    };

    const save = async (slug: string, status: EntityStatus, values: Row, id: string | number | undefined, options: WriteOptions | undefined): Promise<Row> => {
        const collection = callbacksOf(slug, "save");
        if (!collection) return send(slug, status, values, id, options);
        const previous = status === "existing" && id !== undefined
            ? await data.collection(slug).findById(id)
            : undefined;
        const keys = resolvePrimaryKeys(collection);
        // A write asked not to return its row (`returning: false`) still hands
        // `afterSave` a row: the one it sent.
        let sent: Row = values;
        return writeWithSaveCallbacks<Row, Row>({
            collection,
            path: slug,
            entityId: id,
            values,
            previousValues: previous,
            status,
            context: context(),
            write: (toSave) => {
                sent = toSave;
                return send(slug, status, toSave, id, options);
            },
            saved: (written) => {
                const row = written ?? sent;
                return {
                    id: keys.length > 0 ? buildCompositeId(row, keys) : idOf(row) ?? id ?? "",
                    values: row
                };
            }
        });
    };

    return {
        create: (slug, values, id, options) => save(slug, "new", values, id, options),
        update: (slug, id, values, options) => save(slug, "existing", values, id, options),
        remove: async (slug, id, options) => {
            const accessor = data.collection(slug);
            const removeRow = () => signalWrite(changes, slug, () => options ? accessor.delete(id, options) : accessor.delete(id));
            const collection = callbacksOf(slug, "delete");
            if (!collection) return removeRow();
            const row = await accessor.findById(id);
            await deleteWithCallbacks({
                collection,
                path: slug,
                id,
                row: { id, ...row },
                context: context(),
                remove: removeRow
            });
        }
    };
}

/** The batch and trash writes `context.data` passes on, saying each on the change signal. */
const SIGNALLED_WRITES = ["createMany", "updateMany", "upsert", "deleteMany"] as const;

/**
 * `context.data` in the browser: the flat layer the row hooks read — rows as
 * the server sends them, each collection from the data source it declares —
 * whose `create`, `update` and `delete` go through the {@link RowWriter}, so
 * they run the collection's browser callbacks and refresh its views. The
 * batch writes, `upsert` and the trash's restores and purges refresh the
 * views and run no callbacks. Reads pass through untouched.
 *
 * @param context the context a write's callbacks are handed
 * @internal
 */
export function buildContextData(layer: SdkDataLayer, context: () => RebaseContext): RebaseSdkData {
    const writer = createRowWriter(layer, context);
    const accessors = new Map<string, SDKCollectionClient>();
    return sdkDataOf((slug) => {
        let accessor = accessors.get(slug);
        if (!accessor) {
            accessor = withRowWrites(layer.data.collection(slug), slug, writer, layer);
            accessors.set(slug, accessor);
        }
        return accessor;
    });
}

/**
 * The `context.data` of a context with no flat layer above it: every
 * collection says where `context.data` works when it is used.
 *
 * @internal
 */
export function missingContextData(): RebaseSdkData {
    return sdkDataOf(() => {
        throw new Error("context.data must be used inside <Rebase>, with a `client` or a `dataSources` entry that has a driver.");
    });
}

/** A `RebaseSdkData` over `accessorFor`: `data.collection(slug)`, and `data.products` named the way every data layer names it. */
function sdkDataOf(accessorFor: (slug: string) => SDKCollectionClient): RebaseSdkData {
    const target = { collection: accessorFor };
    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "collection") return accessorFor;
            if (typeof prop === "symbol" || prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;
            return accessorFor(toSnakeCase(prop));
        }
    }) as RebaseSdkData;
}

function withRowWrites(
    accessor: SDKCollectionClient,
    slug: string,
    writer: RowWriter,
    { changes }: SdkDataLayer
): SDKCollectionClient {
    const after = <T, >(write: () => Promise<T>): Promise<T> => signalWrite(changes, slug, write);
    const own = new Map<PropertyKey, unknown>();
    own.set("create", (values: Row, id?: string | number, options?: WriteOptions) => writer.create(slug, values, id, options));
    own.set("update", (id: string | number, values: Row, options?: WriteOptions) => writer.update(slug, id, values, options));
    own.set("delete", (id: string | number, options?: WriteOptions) => writer.remove(slug, id, options));
    // Only the writes the accessor has: an absent one stays absent, which is
    // how a caller tells it is not supported.
    for (const name of SIGNALLED_WRITES) {
        const write: unknown = Reflect.get(accessor, name);
        if (typeof write === "function") {
            own.set(name, (...args: unknown[]) => after(() => Reflect.apply(write, accessor, args)));
        }
    }
    let trash: SDKCollectionClient["trash"] | undefined;
    const bound = new Map<PropertyKey, unknown>();
    return new Proxy(accessor, {
        get(target, prop) {
            if (own.has(prop)) return own.get(prop);
            if (prop === "trash") {
                trash ??= target.trash && signalTrash(target.trash, after);
                return trash;
            }
            // Read off the accessor itself, and its methods bound to it: an
            // accessor may keep private state its methods read through `this`.
            const value: unknown = Reflect.get(target, prop, target);
            if (typeof value !== "function") return value;
            let method = bound.get(prop);
            if (!method) {
                method = value.bind(target);
                bound.set(prop, method);
            }
            return method;
        }
    });
}

function signalTrash(
    trash: SDKCollectionClient["trash"],
    after: <T>(write: () => Promise<T>) => Promise<T>
): SDKCollectionClient["trash"] {
    return {
        find: (...args) => trash.find(...args),
        count: (...args) => trash.count(...args),
        restore: (...args) => after(() => trash.restore(...args)),
        restoreMany: (...args) => after(() => trash.restoreMany(...args)),
        purge: (...args) => after(() => trash.purge(...args)),
        purgeMany: (...args) => after(() => trash.purgeMany(...args))
    };
}
