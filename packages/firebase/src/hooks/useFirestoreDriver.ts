import { DataDriver, DeleteProps, CollectionConfig, EntityReference, FetchCollectionProps, FetchOneProps, FilterValues, GeoPoint, ListenCollectionProps, ListenOneProps, OrderByTuple, SaveProps, WhereFilterOp } from "@rebasepro/types";
import { normalizeDriverOrderBy } from "@rebasepro/common";
import { FilterCombination } from "@rebasepro/cms-types";
import { User } from "firebase/auth";
import {
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
    orderBy as orderByClause,
    Query,
    query,
    QueryConstraint,
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
 * Use this hook to build a {@link DataDriver} based on Firestore
 * @param firebaseApp
 * @param textSearchControllerBuilder
 * @group Firebase
 */
export function useFirestoreDriver({
    firebaseApp,
    textSearchControllerBuilder,
    firestoreIndexesBuilder,
    localTextSearchEnabled
}: FirestoreDataDriverProps): FirestoreDataDriver {

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
        databaseId?: string) => {

        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const firestore = databaseId ? getFirestore(firebaseApp, databaseId) : getFirestore(firebaseApp);
        const collectionReference: Query = collectionClause(firestore, path);

        const queryParams: QueryConstraint[] = [];
        if (filter) {
            Object.entries(filter)
                .filter(([_, entry]) => !!entry)
                .forEach(([key, filterParameter]) => {
                    const [op, value] = filterParameter as [WhereFilterOp, any];

                    // Null-testing operators map to Firestore's == / != against null.
                    if (op === "is-null") {
                        queryParams.push(whereClause(key, "==", null));
                        return;
                    }
                    if (op === "is-not-null") {
                        queryParams.push(whereClause(key, "!=", null));
                        return;
                    }

                    // Firestore has no LIKE/ILIKE — fail loudly rather than silently
                    // returning wrong results. Use `searchString` / a search index instead.
                    if (op === "like" || op === "ilike" || op === "not-like" || op === "not-ilike") {
                        throw new Error(
                            `Firestore does not support the "${op}" operator (SQL pattern matching). ` +
                            "Use a full-text search index or the collection's searchString instead."
                        );
                    }

                    queryParams.push(whereClause(key, op, rebaseToFirestoreModel(value, firestore)));
                });
        }

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

        return query(collectionReference, ...queryParams);
    }, [firebaseApp]);

    const getAndBuildEntity = useCallback((path: string,
        id: string | number,
        databaseId?: string
    ): Promise<Record<string, unknown> | undefined> => {
        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const firestore = databaseId ? getFirestore(firebaseApp, databaseId) : getFirestore(firebaseApp);

        return getDoc(doc(firestore, path, String(id)))
            .then((docEntity) => {
                if (!docEntity.exists()) {
                    return undefined;
                }
                return createRowFromDocument(docEntity);
            });
    }, [firebaseApp]);

    const listenOne = useCallback(<M extends Record<string, any>>(
        {
            path,
            id,
            collection,
            onUpdate,
            onError
        }: ListenOneProps<M>): () => void => {
        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const databaseId = collection?.databaseId;
        const firestore = databaseId ? getFirestore(firebaseApp, databaseId) : getFirestore(firebaseApp);
        const resolvedPath = path;

        return onSnapshot(
            doc(firestore, resolvedPath, String(id)),
            {
                next: (docEntity) => {
                    onUpdate(docEntity.exists() ? createRowFromDocument(docEntity) : null);
                },
                error: onError
            }
        );
    }, [firebaseApp]);

    const performTextSearch = useCallback(<M extends Record<string, any>>({
        path,
        databaseId,
        searchString,
        onUpdate
    }: {
        path: string,
        databaseId?: string,
        searchString: string;
        onUpdate: (rows: Record<string, unknown>[]) => void,
    }): () => void => {

        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const textSearchController = searchControllerRef.current;
        if (!textSearchController)
            throw Error("Trying to make text search without specifying a FirestoreTextSearchController");

        let subscriptions: (() => void)[] = [];


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

        search.then((ids) => {
            if (!ids || ids.length === 0) {
                subscriptions = [];
                onUpdate([]);
            }

            const rows: Record<string, unknown>[] = [];
            const addedEntitiesSet = new Set<string | number>();
            subscriptions = (ids ?? [])
                .map((id) => {
                    return listenOne({
                        path,
                        id,
                        onUpdate: (row: Record<string, unknown> | null) => {
                            const incomingId = row?.id as string | number | undefined;
                            if (row && incomingId !== undefined) {
                                if (!addedEntitiesSet.has(incomingId)) {
                                    addedEntitiesSet.add(incomingId);
                                    rows.push(row);
                                    onUpdate(rows);
                                }
                            } else {
                                addedEntitiesSet.delete(id);
                                onUpdate([...rows.filter(r => r.id !== id)])
                            }
                        }
                    })
                }
                );
        });

        return () => {
            subscriptions.forEach((p) => p());
        }

    }, [firebaseApp, listenOne]);

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
        limit,
        offset,
        startAfter,
        searchString,
        orderBy,
        order,
        collection
    }: FetchCollectionProps<M>
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
        const {
            fetchLimit,
            skip
        } = resolveOffsetWindow(limit, offset);
        const query = buildQuery(resolvedPath, filter, orderBy, order, startAfter as unknown[] | undefined, fetchLimit, databaseId);

        const entity = await getDocs(query);
        return entity.docs.slice(skip).map((doc) => createRowFromDocument(doc));
    }, [buildQuery]);

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
            limit,
            startAfter,
            searchString,
            orderBy,
            order,
            onUpdate,
            onError,
            collection
        }: ListenCollectionProps<M>
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
                searchString,
                onUpdate,
                databaseId
            });
        }

        const resolvedPath = path;
        console.debug("Resolved path for listening", {
            path,
            resolvedPath
        });
        const query = buildQuery(resolvedPath, filter, orderBy, order, startAfter as unknown[] | undefined, limit, databaseId);
        return onSnapshot(query,
            {
                next: (entity) => {
                    if (!searchString)
                        onUpdate(entity.docs.map((doc) => createRowFromDocument(doc)));
                },
                error: onError
            }
        );

    }, [buildQuery, firebaseApp, performTextSearch]);

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
    }: FetchOneProps<M>
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
        }: SaveProps<M>): Promise<Record<string, unknown>> => {

        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        console.debug("1", {
            path,
            id,
            values: valuesProp,
            collection
        })
        const values = rebaseToFirestoreModel(valuesProp, getFirestore(firebaseApp));

        console.debug("2", {
            path,
            id,
            values: valuesProp,
            collection
        })
        const databaseId = collection?.databaseId;
        const firestore = databaseId ? getFirestore(firebaseApp, databaseId) : getFirestore(firebaseApp);
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
                    ...(firestoreToRebaseModel(values) as Record<string, unknown>),
                    id: documentReference.id
                };
            })
            .catch((error) => {
                console.error("Error saving entity", error);
                throw error;

            });
    }, [firebaseApp]);

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
        }: DeleteProps<M>
    ): Promise<void> => {
        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");

        const databaseId = collection?.databaseId;
        const firestore = databaseId ? getFirestore(firebaseApp, databaseId) : getFirestore(firebaseApp);

        return deleteDoc(doc(firestore, row.path, String(row.id)));
    }, [firebaseApp]);

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

        const databaseId = collection?.databaseId;
        const firestore = databaseId ? getFirestore(firebaseApp, databaseId) : getFirestore(firebaseApp);

        if (value === undefined || value === null) {
            return Promise.resolve(true);
        }
        const q = query(collectionClause(firestore, path), whereClause(name, "==", rebaseToFirestoreModel(value, firestore)));
        const entity = await getDocs(q);
        return entity.docs.filter(doc => doc.id !== id).length === 0;

    }, [firebaseApp]);

    const count = useCallback(async ({
        path,
        filter,
        order,
        orderBy,
        collection
    }: FetchCollectionProps<any>): Promise<number> => {
        if (!firebaseApp) throw Error("useFirestoreDriver Firebase not initialised");
        const databaseId = collection?.databaseId;
        const resolvedPath = path;
        const query = buildQuery(resolvedPath, filter, orderBy, order, undefined, undefined, databaseId);
        const entity = await getCountFromServer(query);
        return entity.data().count;
    }, [firebaseApp]);

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

const createRowFromDocument = (
    docSnap: DocumentSnapshot
): Record<string, unknown> => {
    const values = firestoreToRebaseModel(docSnap.data()) as Record<string, unknown>;
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
 * Also, Firestore references are replaced with {@link EntityReference}
 * @param data
 * @group Firestore
 */
export function firestoreToRebaseModel(data: unknown): unknown {
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
        const databaseId = (data?.firestore as unknown as { _databaseId?: { database?: string } })?._databaseId?.database;
        return new EntityReference({ id: data.id,
            path: getCMSPathFromFirestorePath(data.path),
            databaseId });
    }
    if (Array.isArray(data)) {
        return data.map(firestoreToRebaseModel).filter(v => v !== undefined);
    }
    if (typeof data === "object") {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
            const childValue = firestoreToRebaseModel((data as Record<string, unknown>)[key]);
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


export function rebaseToFirestoreModel(data: unknown, firestore: Firestore, inArray = false): unknown {
    if (data === undefined) {
        return deleteField();
    } else if (data === null) {
        return null;
    } else if (Array.isArray(data)) {
        return (data as unknown[]).filter(v => v !== undefined).map(v => rebaseToFirestoreModel(v, firestore, true));
    } else if (typeof data === "object" && data !== null && "isEntityReference" in data && typeof (data as Record<string, unknown>).isEntityReference === "function" && (data as { isEntityReference: () => boolean }).isEntityReference()) {
        const entityRef = data as EntityReference;
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
                const firestoreModel = rebaseToFirestoreModel(v, firestore);
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
