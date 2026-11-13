import { DataDriver, CollectionConfig, EntityReference, FilterValues, GeoPoint, LogicalCondition, OrderByTuple, WhereFilterOp } from "@rebasepro/types";
import { normalizeDriverOrderBy, toFilterTuples } from "@rebasepro/common";
import { FilterCombination, type CmsDeleteProps, type CmsFetchCollectionProps, type CmsFetchOneProps, type CmsListenCollectionProps, type CmsListenOneProps, type CmsSaveProps } from "@rebasepro/cms-types";
import { User } from "firebase/auth";
import {
    and as andClause,
    collection as collectionClause,
    CollectionReference,
    deleteDoc,
    deleteField,
    doc,
    DocumentReference,
    DocumentSnapshot,
    Firestore,
    GeoPoint as FirestoreGeoPoint,
    getCountFromServer,
    getDoc,
    getDocs,
    getFirestore,
    limit as limitClause,
    onSnapshot,
    or as orClause,
    orderBy as orderByClause,
    Query,
    query,
    QueryFieldFilterConstraint,
    QueryFilterConstraint,
    QueryNonFilterConstraint,
    serverTimestamp,
    setDoc,
    startAfter as startAfterClause,
    Timestamp,
    VectorValue,
    vector,
    where as whereClause
} from "firebase/firestore";
import type { FieldValue } from "firebase/firestore";
import { FirebaseApp } from "firebase/app";
import { FirestoreTextSearchController, FirestoreTextSearchControllerBuilder } from "../types/text_search";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { localSearchControllerBuilder } from "../utils";
import { getAuth } from "firebase/auth";

/**
 * @group Firebase
 */
export interface FirestoreDataDriverProps {
    firebaseApp?: FirebaseApp,
    /**
     * You can use this controller to return a list of ids from a search index, given a
     * `path` and a `searchString`.
     */
    textSearchControllerBuilder?: FirestoreTextSearchControllerBuilder,

    /**
     * Fallback to local text search if no text search controller is specified,
     * or if the controller does not support the given path.
     */
    localTextSearchEnabled?: boolean,

    /**
     * Use this builder to indicate which indexes are available in your
     * Firestore database. This is used to allow filtering and sorting
     * for multiple fields in the CMS.
     */
    firestoreIndexesBuilder?: FirestoreIndexesBuilder;

    /**
     * The key of the `<Rebase dataSources>` entry this driver serves — what a
     * collection's `dataSource` names. With it the driver tells a reference to
     * a record of its own Firestore database (written as a
     * `DocumentReference`) from one to a record of another data source
     * (written as the record's id, see {@link rebaseToFirestoreModel}), and
     * stamps it on every reference it reads back. `useFirestoreDataSource`
     * passes its `key`.
     */
    dataSourceKey?: string;

    /**
     * The Firestore database read and written when a call does not name one
     * (a collection's `databaseId` does). Defaults to the app's default
     * database.
     */
    databaseId?: string;
}

export type FirestoreIndexesBuilder = (params: {
    path: string,
    collection: CollectionConfig<any>,
}) => FilterCombination<string>[] | undefined

export type FirestoreDataDriver = DataDriver & {

    initTextSearch: (props: {
        path: string,
        databaseId?: string,
        collection?: CollectionConfig
    }) => Promise<boolean>,
}

/**
 * The window a read has to ask Firestore for in order to honour `offset`.
 *
 * Firestore's web SDK has no `offset()` — it pages by cursor (`startAfter`)
 * only. Callers that page by offset (`buildRebaseData`, and through it every
 * `findAll()` and `iterate()`) were therefore served page one every time:
 * `count` is a real server count, so `hasMore` never went false, the walk
 * accumulated the same rows over and over, and it ended by tripping its row
 * cap and reporting "matched more than N rows" — a condition that had not
 * occurred.
 *
 * So the read asks for `offset + limit` documents and drops the first
 * `offset`. Those documents are billed either way: Firestore charges for every
 * document a cursor walks past, which is why `startAfter` is the cheap way to
 * page and offset paging over a large collection is not.
 */
export function resolveOffsetWindow(
    limit: number | undefined,
    offset: number | undefined
): { fetchLimit: number | undefined, skip: number } {
    const skip = offset !== undefined && Number.isFinite(offset) && offset > 0
        ? Math.floor(offset)
        : 0;
    return {
        fetchLimit: limit === undefined ? undefined : limit + skip,
        skip
    };
}

/**
 * The rows for the ids a text search returned, read once: in the order the
 * search ranked them, windowed by `limit` and `offset`. An id whose document is
 * gone is left out.
 */
export async function readSearchResults({
    ids,
    limit,
    offset,
    readOne
}: {
    ids: readonly string[],
    limit?: number,
    offset?: number,
    readOne: (id: string) => Promise<Record<string, unknown> | undefined>
}): Promise<Record<string, unknown>[]> {
    const { fetchLimit, skip } = resolveOffsetWindow(limit, offset);
    const rows = await Promise.all(ids.slice(skip, fetchLimit).map(readOne));
    return rows.filter((row): row is Record<string, unknown> => row !== undefined);
}

/**
 * The rows for the ids a text search returned, kept live: one document
 * listener per id in the `limit`/`offset` window, and every change delivered
 * as the whole list, in the order the search ranked the ids.
 *
 * The returned function cancels all of it, a search still in flight included:
 * its listeners are then never opened.
 */
export function listenToSearchResults({
    ids,
    limit,
    offset,
    listenOne,
    onUpdate,
    onError
}: {
    ids: Promise<readonly string[] | undefined>,
    limit?: number,
    offset?: number,
    listenOne: (
        id: string,
        onRow: (row: Record<string, unknown> | null) => void,
        onError?: (error: Error) => void
    ) => () => void,
    onUpdate: (rows: Record<string, unknown>[]) => void,
    onError?: (error: Error) => void
}): () => void {
    let cancelled = false;
    let subscriptions: (() => void)[] = [];

    ids.then((found) => {
        if (cancelled) return;
        const { fetchLimit, skip } = resolveOffsetWindow(limit, offset);
        const windowIds = (found ?? []).slice(skip, fetchLimit);
        if (windowIds.length === 0) {
            onUpdate([]);
            return;
        }
        // Keyed by id, so an update replaces the row and a delete removes it.
        const rows = new Map<string, Record<string, unknown>>();
        const emit = () => onUpdate(windowIds.flatMap((id) => {
            const row = rows.get(id);
            return row ? [row] : [];
        }));
        subscriptions = windowIds.map((id) => listenOne(id, (row) => {
            if (row) rows.set(id, row);
            else rows.delete(id);
            emit();
        }, onError));
    }).catch((error: unknown) => {
        if (cancelled) return;
        onError?.(error instanceof Error ? error : new Error(String(error)));
    });

    return () => {
        cancelled = true;
        subscriptions.forEach((unsubscribe) => unsubscribe());
    };
}

/**
 * One condition, as the Firestore filter it means.
 *
 * Null-testing operators map to `==` / `!=` against null. Firestore has no
 * LIKE/ILIKE, so those fail loudly rather than return wrong results.
 */
function firestoreCondition(key: string, op: WhereFilterOp, value: unknown, firestore: Firestore, options?: FirestoreModelOptions): QueryFieldFilterConstraint {
    if (op === "is-null") return whereClause(key, "==", null);
    if (op === "is-not-null") return whereClause(key, "!=", null);
    if (op === "like" || op === "ilike" || op === "not-like" || op === "not-ilike") {
        throw new Error(
            `Firestore does not support the "${op}" operator (SQL pattern matching). ` +
            "Use a full-text search index or the collection's searchString instead."
        );
    }
    if (op === "array-contains-all" || op === "array-contained-by") {
        throw new Error(
            `Firestore does not support the "${op}" operator: it matches one element of an array ` +
            "(array-contains) or any of a list (array-contains-any)."
        );
    }
    return whereClause(key, op, rebaseToFirestoreModel(value, firestore, options));
}

/**
 * An `or(...)` / `and(...)` group as a Firestore composite filter, nesting
 * included, or `undefined` for a group with no conditions in it.
 *
 * A group the driver does not translate is refused, never dropped: a dropped
 * `or(...)` does not fail, it answers with the whole collection. `not(...)` is
 * one — Firestore has no negation of a conjunction, and `!=` on each leaf
 * matches a different set of documents.
 */
export function firestoreLogicalCondition(
    logical: LogicalCondition | undefined,
    firestore: Firestore,
    options?: FirestoreModelOptions
): QueryFilterConstraint | undefined {
    if (!logical || !Array.isArray(logical.conditions)) return undefined;
    if (logical.type === "not") {
        throw new Error("Firestore does not support a not(...) filter group. Write the condition without the negation.");
    }
    const parts: QueryFilterConstraint[] = [];
    for (const entry of logical.conditions) {
        if (!entry) continue;
        if ("conditions" in entry) {
            const nested = firestoreLogicalCondition(entry, firestore, options);
            if (nested) parts.push(nested);
            continue;
        }
        parts.push(firestoreCondition(entry.column, entry.operator, entry.value, firestore, options));
    }
    if (parts.length === 0) return undefined;
    return logical.type === "or" ? orClause(...parts) : andClause(...parts);
}

/**
 * Use this hook to build a {@link DataDriver} based on Firestore
 * @param firebaseApp
 * @param textSearchControllerBuilder
 * @group Firebase
 */
export function useFirestoreDriver({
    firebaseApp,
    textSearchControllerBuilder,
    firestoreIndexesBuilder,
    localTextSearchEnabled,
    dataSourceKey,
    databaseId: defaultDatabaseId
}: FirestoreDataDriverProps): FirestoreDataDriver {

    /** The Firestore of `databaseId`, else of the driver's default database. */
    const firestoreOf = useCallback((app: FirebaseApp, databaseId?: string): Firestore => {
        const resolved = databaseId ?? defaultDatabaseId;
        return resolved ? getFirestore(app, resolved) : getFirestore(app);
    }, [defaultDatabaseId]);

    /** How this driver converts values: see {@link FirestoreModelOptions}. */
    const modelOptions = useMemo<FirestoreModelOptions>(() => ({ dataSourceKey }), [dataSourceKey]);

    const searchControllerRef = useRef<FirestoreTextSearchController>(undefined);

    useEffect(() => {
        if (!searchControllerRef.current && firebaseApp) {
            if ((textSearchControllerBuilder || localTextSearchEnabled) && !searchControllerRef.current) {
                searchControllerRef.current = buildTextSearchControllerWithLocalSearch({
                    firebaseApp,
                    textSearchControllerBuilder,
                    localTextSearchEnabled: localTextSearchEnabled ?? false
                });
            }
        }
    }, [firebaseApp, localTextSearchEnabled, textSearchControllerBuilder]);

    const buildQuery = useCallback(<M>(path: string,
        filter: FilterValues<Extract<keyof M, string>> | undefined,
        orderBy: string | OrderByTuple[] | undefined,
        order: "desc" | "asc" | undefined,
        startAfter: unknown[] | undefined,
        limit: number | undefined,
        databaseId?: string,
        logical?: LogicalCondition) => {

        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const firestore = firestoreOf(firebaseApp, databaseId);
        const collectionReference: Query = collectionClause(firestore, path);

        // Every tuple of every field, through one leaf translation — a field
        // may carry a list of them (`{ age: [[">=", 18], ["<", 65]] }`), the
        // grammar `toFilterTuples` reads for every driver.
        const filters: QueryFieldFilterConstraint[] = [];
        for (const [key, filterParameter] of Object.entries(filter ?? {})) {
            for (const [op, value] of toFilterTuples(filterParameter)) {
                filters.push(firestoreCondition(key, op, value, firestore, modelOptions));
            }
        }
        const group = firestoreLogicalCondition(logical, firestore, modelOptions);

        const queryParams: QueryNonFilterConstraint[] = [];

        // Firestore composes several `orderBy` constraints into a compound sort,
        // applied in the order they are added — the same meaning the tuple list
        // carries. It needs a matching composite index; without one Firestore
        // refuses the query outright rather than answering it half-sorted.
        for (const [field, direction] of normalizeDriverOrderBy(orderBy, order) ?? []) {
            queryParams.push(orderByClause(field, direction));
        }

        if (startAfter) {
            queryParams.push(startAfterClause(startAfter));
        }

        if (limit) {
            queryParams.push(limitClause(limit));
        }

        // A composite filter is the one form Firestore takes an `or` in, and
        // it has to carry every other condition of the query with it.
        if (group) {
            return query(collectionReference, andClause(...filters, group), ...queryParams);
        }
        return query(collectionReference, ...filters, ...queryParams);
    }, [firebaseApp, firestoreOf, modelOptions]);

    const getAndBuildEntity = useCallback((path: string,
        id: string | number,
        databaseId?: string
    ): Promise<Record<string, unknown> | undefined> => {
        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const firestore = firestoreOf(firebaseApp, databaseId);

        return getDoc(doc(firestore, path, String(id)))
            .then((docEntity) => {
                if (!docEntity.exists()) {
                    return undefined;
                }
                return createRowFromDocument(docEntity, modelOptions);
            });
    }, [firebaseApp, firestoreOf, modelOptions]);

    const listenOne = useCallback(<M extends Record<string, any>>(
        {
            path,
            id,
            collection,
            onUpdate,
            onError
        }: CmsListenOneProps<M>): () => void => {
        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const firestore = firestoreOf(firebaseApp, collection?.databaseId);
        const resolvedPath = path;

        return onSnapshot(
            doc(firestore, resolvedPath, String(id)),
            {
                next: (docEntity) => {
                    onUpdate(docEntity.exists() ? createRowFromDocument(docEntity, modelOptions) : null);
                },
                error: onError
            }
        );
    }, [firebaseApp, firestoreOf, modelOptions]);

    /** The ids the text search controller finds for `searchString` under `path`. */
    const searchIds = useCallback((
        path: string,
        searchString: string,
        databaseId?: string
    ): Promise<readonly string[] | undefined> => {

        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const textSearchController = searchControllerRef.current;
        if (!textSearchController)
            throw Error("Trying to make text search without specifying a FirestoreTextSearchController");

        const auth = getAuth(firebaseApp);
        const currentUser = auth?.currentUser;

        const search = textSearchController.search({
            path,
            searchString,
            currentUser: currentUser ?? undefined,
            databaseId
        });

        if (!search) {
            throw Error("The current path is not supported by the specified FirestoreTextSearchController");
        }
        return search;
    }, [firebaseApp]);

    const performTextSearch = useCallback(<M extends Record<string, any>>({
        path,
        collection,
        searchString,
        limit,
        offset,
        onUpdate,
        onError
    }: {
        path: string,
        collection?: CollectionConfig<M>,
        searchString: string;
        limit?: number,
        offset?: number,
        onUpdate: (rows: Record<string, unknown>[]) => void,
        onError?: (error: Error) => void
    }): () => void => {
        return listenToSearchResults({
            ids: searchIds(path, searchString, collection?.databaseId),
            limit,
            offset,
            listenOne: (id, onRow, onRowError) => listenOne<M>({
                path,
                id,
                // Carries `databaseId`: without it every hit was read from the
                // default database.
                collection,
                onUpdate: onRow,
                onError: onRowError
            }),
            onUpdate,
            onError
        });
    }, [searchIds, listenOne]);

    const initTextSearch = useCallback(async (props: {
        path: string,
        databaseId?: string,
        collection?: CollectionConfig
    }) => {
        console.debug("Init text search controller", searchControllerRef.current, props.path);
        if (!searchControllerRef.current) {
            console.warn("You are trying to use text search, but have not provided a text search controller in `useFirestoreDriver`. You can also set the flag `localTextSearchEnabled` to use local search in `useFirestoreDriver`. Local text search can incur in performance issues and higher costs for large datasets.");
            return false;
        }
        try {
            return searchControllerRef.current.init(props);
        } catch (e) {
            console.error("Error initializing text search controller", e);
            return false;
        }
    }, []);

    /**
     * Fetch entities in a Firestore path
     * @param path
     * @param collection
     * @param filter
     * @param limit
     * @param offset
     * @param startAfter
     * @param searchString
     * @param orderBy
     * @param order
     * @return The rows in the requested window
     * @see useCollection if you need this functionality implemented as a hook
     * @group Firestore
     */
    const fetchCollection = useCallback(async <M extends Record<string, any>>({
        path,
        filter,
        logical,
        limit,
        offset,
        startAfter,
        searchString,
        orderBy,
        order,
        collection
    }: CmsFetchCollectionProps<M>
    ): Promise<Record<string, unknown>[]> => {

        const databaseId = collection?.databaseId;

        const resolvedPath = path;

        console.debug("Fetching collection", {
            path,
            limit,
            offset,
            filter,
            startAfter,
            orderBy,
            order
        });
        // Firestore has no `offset()`; see resolveOffsetWindow.
        if (searchString) {
            // The same search a live list runs. Ignoring `searchString` here
            // answered a search with the whole collection.
            return readSearchResults({
                ids: await searchIds(resolvedPath, searchString, databaseId) ?? [],
                limit,
                offset,
                readOne: (id) => getAndBuildEntity(resolvedPath, id, databaseId)
            });
        }

        const {
            fetchLimit,
            skip
        } = resolveOffsetWindow(limit, offset);
        const query = buildQuery(resolvedPath, filter, orderBy, order, startAfter as unknown[] | undefined, fetchLimit, databaseId, logical);

        const entity = await getDocs(query);
        return entity.docs.slice(skip).map((doc) => createRowFromDocument(doc, modelOptions));
    }, [buildQuery, searchIds, getAndBuildEntity, modelOptions]);

    /**
     * Listen to a entities in a given path
     * @param path
     * @param collection
     * @param onError
     * @param filter
     * @param limit
     * @param startAfter
     * @param searchString
     * @param orderBy
     * @param order
     * @param onUpdate
     * @return Function to cancel subscription
     * @see useCollection if you need this functionality implemented as a hook
     * @group Firestore
     */
    const listenCollection = useCallback(<M extends Record<string, any>>(
        {
            path,
            filter,
            logical,
            limit,
            offset,
            startAfter,
            searchString,
            orderBy,
            order,
            onUpdate,
            onError,
            collection
        }: CmsListenCollectionProps<M>
    ): () => void => {

        console.debug("Listening collection", {
            path,
            searchString,
            limit,
            filter,
            startAfter,
            orderBy,
            order,
            collection
        });

        if (!firebaseApp) {
            throw Error("useFirestoreDriver Firebase not initialised");
        }

        const databaseId = collection?.databaseId;

        if (searchString) {
            return performTextSearch<M>({
                path,
                collection,
                searchString,
                limit,
                offset,
                onUpdate,
                onError
            });
        }

        const resolvedPath = path;
        console.debug("Resolved path for listening", {
            path,
            resolvedPath
        });
        // The same window `fetchCollection` reads: without it, a live list
        // past page one was served page one.
        const {
            fetchLimit,
            skip
        } = resolveOffsetWindow(limit, offset);
        const query = buildQuery(resolvedPath, filter, orderBy, order, startAfter as unknown[] | undefined, fetchLimit, databaseId, logical);
        return onSnapshot(query,
            {
                next: (entity) => {
                    onUpdate(entity.docs.slice(skip).map((doc) => createRowFromDocument(doc, modelOptions)));
                },
                error: onError
            }
        );

    }, [buildQuery, firebaseApp, performTextSearch, modelOptions]);

    /**
     * Retrieve a entity given a path and a collection
     * @param path
     * @param id
     * @param collection
     * @group Firestore
     */
    const fetchOne = useCallback(<M extends Record<string, any>>({
        path,
        id,
        collection
    }: CmsFetchOneProps<M>
    ): Promise<Record<string, unknown> | undefined> => {
        const resolvedPath = path;
        return getAndBuildEntity(resolvedPath, id, collection?.databaseId);
    }, [getAndBuildEntity]);

    /**
     * Save entity to the specified path. Note that Firestore does not allow
     * undefined values.
     * @param path
     * @param id
     * @param values
     * @param schemaId
     * @param collection
     * @param status
     * @group Firestore
     */
    const save = useCallback(<M extends Record<string, any>>(
        {
            path,
            id,
            values: valuesProp,
            collection,
            status
        }: CmsSaveProps<M>): Promise<Record<string, unknown>> => {

        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        console.debug("1", {
            path,
            id,
            values: valuesProp,
            collection
        })
        const databaseId = collection?.databaseId;
        const firestore = firestoreOf(firebaseApp, databaseId);
        const values = rebaseToFirestoreModel(valuesProp, firestore, modelOptions);

        console.debug("2", {
            path,
            id,
            values: valuesProp,
            collection
        })
        const resolvedPath = path;

        const collectionReference: CollectionReference = collectionClause(firestore, path);
        console.debug("Saving entity", {
            path,
            id,
            values,
            databaseId
        });

        let documentReference: DocumentReference;
        if (id) {
            documentReference = doc(collectionReference, String(id));
        } else {
            documentReference = doc(collectionReference);
        }
        return setDoc(documentReference, values as Record<string, unknown>, { merge: true })
            .then(() => {
                return {
                    ...(firestoreToRebaseModel(values, modelOptions) as Record<string, unknown>),
                    id: documentReference.id
                };
            })
            .catch((error) => {
                console.error("Error saving entity", error);
                throw error;

            });
    }, [firebaseApp, firestoreOf, modelOptions]);

    /**
     * Delete a entity
     * @param entity
     * @param collection
     * @group Firestore
     */
    const deleteOne = useCallback(<M extends Record<string, any>>(
        {
            row,
            collection
        }: CmsDeleteProps<M>
    ): Promise<void> => {
        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const firestore = firestoreOf(firebaseApp, collection?.databaseId);

        return deleteDoc(doc(firestore, row.path, String(row.id)));
    }, [firebaseApp, firestoreOf]);

    /**
     * Check if the given property is unique in the given collection
     * @param path Collection path
     * @param name of the property
     * @param value
     * @param property
     * @param id
     * @return `true` if there are no other fields besides the given entity
     * @group Firestore
     */
    const checkUniqueField = useCallback(async (
        path: string,
        name: string,
        value: unknown,
        id?: string | number,
        collection?: CollectionConfig<any>
    ): Promise<boolean> => {

        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const firestore = firestoreOf(firebaseApp, collection?.databaseId);

        if (value === undefined || value === null) {
            return Promise.resolve(true);
        }
        const q = query(collectionClause(firestore, path), whereClause(name, "==", rebaseToFirestoreModel(value, firestore, modelOptions)));
        const entity = await getDocs(q);
        return entity.docs.filter(doc => doc.id !== id).length === 0;

    }, [firebaseApp, firestoreOf, modelOptions]);

    const count = useCallback(async ({
        path,
        filter,
        logical,
        order,
        orderBy,
        searchString,
        collection
    }: CmsFetchCollectionProps<any>): Promise<number> => {
        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");
        const databaseId = collection?.databaseId;
        const resolvedPath = path;
        if (searchString) {
            // What `fetchCollection` pages over for the same search.
            return (await searchIds(resolvedPath, searchString, databaseId) ?? []).length;
        }
        const query = buildQuery(resolvedPath, filter, orderBy, order, undefined, undefined, databaseId, logical);
        const entity = await getCountFromServer(query);
        return entity.data().count;
    }, [firebaseApp, buildQuery, searchIds]);

    const isFilterCombinationValid = useCallback(({
        path,
        collection,
        filterValues,
        sortBy
    }: {
        path: string,
        collection: CollectionConfig<any>,
        filterValues: FilterValues<any>,
        sortBy?: [string, "asc" | "desc"],
    }): boolean => {

        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        // If no indexes are defined, we assume the query is valid.
        // If there is no index in Firestore, and error message will be shown
        if (firestoreIndexesBuilder === undefined) return true;
        const resolvedPath = path;

        const indexes = firestoreIndexesBuilder?.({
            path: resolvedPath,
            collection
        });

        const sortKey = sortBy ? sortBy[0] : undefined;
        const sortDirection = sortBy ? sortBy[1] : undefined;

        // Order by clause cannot contain a field with an equality filter
        const values: [WhereFilterOp, any][] = Object.values(filterValues) as [WhereFilterOp, any][];

        const filterKeys = Object.keys(filterValues);
        const filtersCount = filterKeys.length;

        if (!sortKey && values.every((v) => v[0] === "==")) {
            return true;
        }

        if (filtersCount === 1 && (!sortKey || sortKey === filterKeys[0])) {
            return true;
        }

        if (!indexes && filtersCount > 1) {
            return false;
        }

        return !!indexes && indexes
            .filter((compositeIndex) => !sortKey || sortKey in compositeIndex)
            .find((compositeIndex) =>
                Object.entries(filterValues).every(([key, value]) => compositeIndex[key] !== undefined && (!sortDirection || compositeIndex[key] === sortDirection))
            ) !== undefined;
    }, [firebaseApp]);

    return useMemo(() => ({
        key: "firestore" as const,
        currentTime,
        initialised: Boolean(firebaseApp),
        initTextSearch,
        fetchCollection,
        listenCollection,
        fetchOne,
        listenOne,
        save,
        delete: deleteOne,
        checkUniqueField,
        count,
        isFilterCombinationValid
    }), [
        firebaseApp,
        initTextSearch,
        fetchCollection,
        listenCollection,
        fetchOne,
        listenOne,
        save,
        deleteOne,
        checkUniqueField,
        count,
        isFilterCombinationValid
    ]);

}

/**
 * How the model converters treat references, for one data source.
 *
 * @group Firestore
 */
export interface FirestoreModelOptions {
    /**
     * The key of the data source the converted values belong to — the
     * `<Rebase dataSources>` entry the driver serves.
     *
     * With it, a reference whose `driver` names *another* data source (a
     * Postgres table's record, picked in a Firestore form) is written as the
     * referenced id, and every `DocumentReference` read back carries this key
     * as its `driver`. Without it, every reference is written as a
     * `DocumentReference`, as before the data source was known.
     */
    dataSourceKey?: string;
}

/**
 * The engine name a reference's `driver` may carry instead of a data-source
 * key — `new EntityReference({ …, driver: "firestore" })` — and which always
 * means a Firestore document.
 */
const FIRESTORE_ENGINE = "firestore";

/**
 * Does `reference` point into another data source than the one `options`
 * describes? Only when both are known and differ: a reference that names no
 * `driver` is one of the driver's own documents, as it always was.
 */
function isForeignReference(reference: EntityReference, options: FirestoreModelOptions | undefined): boolean {
    const own = options?.dataSourceKey;
    const target = reference.driver;
    return own !== undefined && target !== undefined && target !== own && target !== FIRESTORE_ENGINE;
}

const createRowFromDocument = (
    docSnap: DocumentSnapshot,
    options?: FirestoreModelOptions
): Record<string, unknown> => {
    const values = firestoreToRebaseModel(docSnap.data(), options) as Record<string, unknown>;
    return {
        ...values,
        // Spread the canonical document id last so it wins over a literal `id` field
        id: docSnap.id
    };
};

/**
 * Recursive function that converts Firestore data types into CMS or plain
 * JS types.
 * Rebase uses Javascript dates internally instead of Firestore timestamps.
 * This makes it easier to interact with the rest of the libraries and
 * bindings.
 *
 * Firestore references are replaced with {@link EntityReference}s carrying
 * the stored path, the Firestore database, and — when `options` names the
 * driver's data source — that key as their `driver`.
 *
 * A reference to a record of another data source is stored as the record's
 * id (see {@link rebaseToFirestoreModel}) and comes back as that id: the
 * document holds no more than that. The admin turns it back into a reference
 * from the field's `target`, which it knows and this function does not.
 * @param data
 * @param options
 * @group Firestore
 */
export function firestoreToRebaseModel(data: unknown, options?: FirestoreModelOptions): unknown {
    if (data === null || data === undefined) return null;
    if (typeof data === "object" && data !== null && "isEqual" in data && typeof (data as FieldValue).isEqual === "function" && deleteField().isEqual(data as FieldValue)) {
        return undefined;
    }
    if (typeof data === "object" && data !== null && "isEqual" in data && typeof (data as FieldValue).isEqual === "function" && serverTimestamp().isEqual(data as FieldValue)) {
        return null;
    }
    if (data instanceof Timestamp || (typeof data === "object" && data !== null && "toDate" in data && typeof (data as Record<string, unknown>).toDate === "function" && ((data as Record<string, unknown>).toDate as () => unknown)() instanceof Date)) {
        return (data as { toDate: () => Date }).toDate();
    }
    if (data instanceof Date) {
        return data;
    }
    if (typeof data === "object" && "__type__" in data && data.__type__ === "__vector__") {
        return data; // already translated
    }
    if (data instanceof VectorValue || (typeof data === "object" && data !== null && "toArray" in data && typeof (data as Record<string, unknown>).toArray === "function" && (data as { constructor?: { name?: string } }).constructor?.name === "VectorValue")) {
        return { __type__: "__vector__",
value: (data as { toArray: () => number[] }).toArray() };
    }

    if (data instanceof FirestoreGeoPoint) {
        return new GeoPoint(data.latitude, data.longitude);
    }
    if (data instanceof DocumentReference) {
        // Not in Firestore's public declarations, so read by name and checked.
        const internalId: unknown = Reflect.get(data.firestore, "_databaseId");
        const databaseId = typeof internalId === "object" && internalId !== null && "database" in internalId
            && typeof internalId.database === "string" ? internalId.database : undefined;
        return new EntityReference({ id: data.id,
            path: getCMSPathFromFirestorePath(data.path),
            databaseId,
            ...(options?.dataSourceKey !== undefined ? { driver: options.dataSourceKey } : {}) });
    }
    if (data instanceof EntityReference) {
        // Already converted: a save hands its own written values back through here.
        return data;
    }
    if (Array.isArray(data)) {
        return data.map(item => firestoreToRebaseModel(item, options)).filter(v => v !== undefined);
    }
    if (typeof data === "object") {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
            const childValue = firestoreToRebaseModel((data as Record<string, unknown>)[key], options);
            if (childValue !== undefined)
                result[key] = childValue;
        }
        return result;
    }
    return data;
}

/**
 * Remove id from Firestore path
 * @param fsPath
 */
function getCMSPathFromFirestorePath(fsPath: string): string {
    let to = fsPath.lastIndexOf("/");
    to = to === -1 ? fsPath.length : to;
    return fsPath.substring(0, to);
}

/**
 * Convert values as the admin holds them into what Firestore stores: a
 * `Date` as a `Timestamp`, a `GeoPoint` as Firestore's, a vector as a
 * `VectorValue`, `undefined` as a field deletion.
 *
 * References are stored by where they point:
 *
 * - to a document of this Firestore — a reference with no `driver`, or one
 *   naming this data source — as a `DocumentReference`, exactly as before;
 * - to a record of **another** data source (its `driver` names a different
 *   key than `options.dataSourceKey`) as the record's id, a plain string. A
 *   `DocumentReference` there would point at a document that does not exist,
 *   and a query for the record would never match it.
 *
 * @param data the values
 * @param firestore the Firestore the references point into
 * @param options which data source the values belong to; `inArray` is
 * internal (an element of an array cannot hold a field deletion)
 * @group Firestore
 */
export function rebaseToFirestoreModel(
    data: unknown,
    firestore: Firestore,
    options?: FirestoreModelOptions & { inArray?: boolean }
): unknown {
    const inArray = options?.inArray ?? false;
    if (data === undefined) {
        // `deleteField()` removes a field of the document or of one of its
        // maps. Firestore refuses it anywhere inside an array — the element is
        // written whole — so there the key is left out instead.
        return inArray ? undefined : deleteField();
    } else if (data === null) {
        return null;
    } else if (Array.isArray(data)) {
        return (data as unknown[]).filter(v => v !== undefined).map(v => rebaseToFirestoreModel(v, firestore, { ...options, inArray: true }));
    } else if (data instanceof EntityReference || (typeof data === "object" && "isEntityReference" in data && typeof data.isEntityReference === "function" && data.isEntityReference() === true && "path" in data && "id" in data)) {
        const entityRef = data instanceof EntityReference
            ? data
            : new EntityReference({
                id: String(Reflect.get(data, "id")),
                path: String(Reflect.get(data, "path")),
                driver: stringOrUndefined(Reflect.get(data, "driver")),
                databaseId: stringOrUndefined(Reflect.get(data, "databaseId"))
            });
        if (isForeignReference(entityRef, options)) return entityRef.id;
        const targetFirestore = entityRef.databaseId ? getFirestore(firestore.app, entityRef.databaseId) : firestore;
        return doc(targetFirestore, entityRef.path, entityRef.id);
    } else if (data && typeof data === "object" && "__type" in data && (data as Record<string, unknown>).__type === "relation" && "path" in data && "id" in data) {
        const rel = data as { path: string; id: string | number };
        return doc(firestore, rel.path, String(rel.id));
    } else if (data instanceof GeoPoint) {
        return new FirestoreGeoPoint(data.latitude, data.longitude);
    } else if (data instanceof Date) {
        return Timestamp.fromDate(data);
    } else if (data && typeof data === "object" && "__type__" in data && (data as Record<string, unknown>).__type__ === "__vector__") {
        return vector((data as { value?: number[] }).value || []);
    } else if (data && typeof data === "object") {
        return Object.entries(data)
            .map(([key, v]) => {
                const firestoreModel = rebaseToFirestoreModel(v, firestore, options);
                if (firestoreModel !== undefined)
                    return ({ [key]: firestoreModel });
                else
                    return {};
            })
            .reduce((a, b) => ({ ...a,
...b }), {});
    }
    return data;
}

function stringOrUndefined(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}


function currentTime(): unknown {
    return serverTimestamp();
}

function buildTextSearchControllerWithLocalSearch({
    textSearchControllerBuilder,
    firebaseApp,
    localTextSearchEnabled
}: {
    textSearchControllerBuilder?: FirestoreTextSearchControllerBuilder,
    firebaseApp: FirebaseApp,
    localTextSearchEnabled: boolean
}): FirestoreTextSearchController | undefined {
    if (!textSearchControllerBuilder && localTextSearchEnabled) {
        console.debug("Using local search only");
        return localSearchControllerBuilder({ firebaseApp });
    }
    if (!localTextSearchEnabled && textSearchControllerBuilder) {
        console.debug("Using external text search only");
        return textSearchControllerBuilder({ firebaseApp });
    }
    if (!textSearchControllerBuilder && !localTextSearchEnabled) {
        return undefined;
    }

    const localSearchController = localSearchControllerBuilder({ firebaseApp })
    const textSearchController = textSearchControllerBuilder!({ firebaseApp });
    return {
        init: async (props: {
            path: string,
            databaseId?: string,
            collection?: CollectionConfig
        }) => {
            const b = await textSearchController.init(props);
            if (b) {
                console.debug("External Text search controller supports path", props.path);
                return true;
            }
            if (localTextSearchEnabled)
                return localSearchController.init(props);
            return false;
        },
        search: async (props: {
            searchString: string,
            path: string,
            currentUser?: User,
            databaseId?: string
        }) => {
            const search = await textSearchController.search(props);
            return search ?? await localSearchController.search(props);
        }
    }
}
