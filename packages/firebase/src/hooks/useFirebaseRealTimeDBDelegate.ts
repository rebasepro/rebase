import { FirebaseApp } from "firebase/app";
import {
    Database,
    get,
    getDatabase,
    limitToFirst,
    onValue,
    orderByChild,
    orderByKey,
    push,
    query,
    ref,
    remove,
    set,
    startAt
} from "firebase/database";
import { useCallback } from "react";
import { DataDriver, DeleteProps, FetchCollectionProps, FetchOneProps, FilterValues, ListenCollectionProps, ListenOneProps, SaveProps } from "@rebasepro/types";

export function useFirebaseRTDBDelegate({ firebaseApp }: { firebaseApp?: FirebaseApp }): DataDriver {

    const fetchCollection = useCallback(async <M extends Record<string, any>>({
        path,
        filter,
        limit,
        startAfter,
        orderBy,
        order,
        searchString
    }: FetchCollectionProps<M>): Promise<Record<string, unknown>[]> => {
        if (!firebaseApp) {
            throw new Error("Firebase app not provided");
        }
        const database = getDatabase(firebaseApp);

        let dbQuery = query(ref(database, path));

        // Example to apply "limit" and "startAfter"
        if (startAfter !== undefined) {
            dbQuery = query(dbQuery, orderByKey(), startAt(String(startAfter)));
        }
        if (limit !== undefined) {
            dbQuery = query(dbQuery, limitToFirst(limit));
        }

        const entity = await get(dbQuery);
        if (entity.exists()) {
            return Object.entries(entity.val()).map(([id, values]) => ({
                ...(delegateToCMSModel(values) as Record<string, unknown>),
                id
            }));
        }
        return [];
    }, [firebaseApp]);

    const listenCollection = useCallback(<M extends Record<string, any>>({
        path,
        onUpdate
        // Realtime Database does not directly support onError in onValue
    }: ListenCollectionProps<M>): () => void => {
        if (!firebaseApp) {
            throw new Error("Firebase app not provided");
        }
        const database = getDatabase(firebaseApp);

        const dbRef = ref(database, path);
        const unsubscribe = onValue(dbRef, (entity) => {
            if (entity.exists()) {
                const result: Record<string, unknown>[] = Object.entries(entity.val()).map(([id, values]) => ({
                    ...(delegateToCMSModel(values) as Record<string, unknown>),
                    id
                }));
                onUpdate(result);
            } else {
                onUpdate([]);
            }
        });

        return () => unsubscribe();
    }, [firebaseApp]);

    const fetchOne = useCallback(async <M extends Record<string, any>>({
        path,
        id
    }: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> => {
        if (!firebaseApp) {
            throw new Error("Firebase app not provided");
        }
        const database = getDatabase(firebaseApp);

        const entity = await get(ref(database, `${path}/${id}`));
        if (entity.exists()) {
            return {
                ...(delegateToCMSModel(entity.val()) as Record<string, unknown>),
                id: id
            };
        }
        return undefined;
    }, [firebaseApp]);

    const listenOne = useCallback(<M extends Record<string, any>>({
        path,
        id,
        onUpdate,
        onError
    }: ListenOneProps<M>): () => void => {
        if (!firebaseApp) {
            throw new Error("Firebase app not provided");
        }
        const database = getDatabase(firebaseApp);

        const dbRef = ref(database, `${path}/${id}`);
        const unsubscribe = onValue(dbRef, (entity) => {
            if (entity.exists()) {
                onUpdate({
                    ...(delegateToCMSModel(entity.val()) as Record<string, unknown>),
                    id: id
                });
            } else {
                onError?.(new Error("Entity does not exist"));
            }
        });

        return () => unsubscribe();
    }, [firebaseApp]);

    const save = useCallback(async <M extends Record<string, any>>({
        path,
        id,
        values
    }: SaveProps<M>): Promise<Record<string, unknown>> => {
        if (!firebaseApp) {
            throw new Error("Firebase app not provided");
        }
        const database = getDatabase(firebaseApp);

        // If id is not provided, a new entity will be created
        const finalId = id ?? push(ref(database, path)).key;
        if (!finalId) {
            throw new Error("Could not generate a new id");
        }

        // Transform the data to RTDB format before saving
        const transformedValues = cmsToRTDBModel(values, database);
        await set(ref(database, `${path}/${finalId}`), transformedValues);

        return {
            ...values,
            id: finalId
        };
    }, [firebaseApp]);

    const deleteOne = useCallback(async <M extends Record<string, any>>({
        row
    }: DeleteProps<M>): Promise<void> => {
        if (!firebaseApp) {
            throw new Error("Firebase app not provided");
        }
        const database = getDatabase(firebaseApp);

        await remove(ref(database, `${row.path}/${row.id}`));
    }, [firebaseApp]);

    // Implementing additional methods required by DataDriver
    const checkUniqueField = useCallback(async (slug: string, name: string, value: unknown, id?: string | number): Promise<boolean> => {
        if (!firebaseApp) {
            throw new Error("Firebase app not provided");
        }
        const database = getDatabase(firebaseApp);

        // Simplified example; the Realtime Database does not support querying with "not equal" conditions
        const dbRef = query(ref(database, slug), orderByChild(name), startAt(value as string | number | boolean | null), limitToFirst(1));
        const entity = await get(dbRef);

        if (!entity.exists()) {
            return true;
        }

        // Check if the found entity is the same as the one being checked
        const [key, entityValue] = Object.entries(entity.val())[0];
        if (entityValue && typeof entityValue === "object" && (entityValue as Record<string, unknown>)[name] === value && key === id) {
            return true;
        }

        return false;
    }, [firebaseApp]);

    const isFilterCombinationValid = useCallback(({
        path,
        filter,
        sortBy
    }: {
        path: string;
        filter?: FilterValues<string>;
        sortBy?: [string, "asc" | "desc"];
    }): boolean => {
        return false;
    }, []);

    return {
        key: "firebase_rtdb",
        fetchCollection,
        listenCollection,
        fetchOne,
        listenOne,
        save,
        delete: deleteOne,
        checkUniqueField,
        isFilterCombinationValid,
        currentTime: () => new Date()
    };
}


/**
 * Transform data from RTDB format back to CMS format
 * This is used internally when fetching/listening to data
 */
function delegateToCMSModel(data: unknown): unknown {
    if (data === null || data === undefined) return null;

    if (Array.isArray(data)) {
        return data.map(delegateToCMSModel).filter(v => v !== undefined);
    }

    if (typeof data === "object") {
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(data as Record<string, unknown>)) {
            const childValue = delegateToCMSModel((data as Record<string, unknown>)[key]);
            if (childValue !== undefined)
                result[key] = childValue;
        }
        return result;
    }

    return data;
}

/**
 * Transform data from CMS format to RTDB format
 * This is used internally when saving data
 */
function cmsToRTDBModel(data: unknown, database: Database): unknown {
    if (data === undefined) {
        return null;
    } else if (data === null) {
        return null;
    } else if (Array.isArray(data)) {
        return data.filter(v => v !== undefined).map(v => cmsToRTDBModel(v, database));
    } else if (typeof data === "object" && data !== null && "isEntityReference" in data && typeof (data as Record<string, unknown>).isEntityReference === "function" && (data as { isEntityReference: () => boolean }).isEntityReference()) {
        const entityRef = data as unknown as { slug: string; id: string };
        return ref(database, `${entityRef.slug}/${entityRef.id}`);
    } else if (data instanceof Date) {
        // For dates, convert to ISO string or timestamp.
        return data.toISOString();
    } else if (data && typeof data === "object") {
        return Object.entries(data as Record<string, unknown>)
            .map(([key, v]) => {
                const rtdbModel = cmsToRTDBModel(v, database);
                if (rtdbModel !== undefined)
                    return { [key]: rtdbModel };
                else
                    return {};
            })
            .reduce((a, b) => ({ ...a,
...b }), {});
    }
    return data;
}
