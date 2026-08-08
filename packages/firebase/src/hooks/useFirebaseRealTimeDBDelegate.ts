import { FirebaseApp } from "firebase/app";
import {
    Database,
    endAt,
    equalTo,
    get,
    getDatabase,
    limitToFirst,
    onValue,
    orderByChild,
    orderByKey,
    push,
    query,
    QueryConstraint,
    ref,
    remove,
    set,
    startAfter,
    startAt
} from "firebase/database";
import { useCallback } from "react";
import { DataDriver, DeleteProps, FetchCollectionProps, FetchOneProps, FilterValues, ListenCollectionProps, ListenOneProps, SaveProps, WhereFilterOp } from "@rebasepro/types";

/** The values the Realtime Database can order or bound a query by. */
type RTDBFilterValue = string | number | boolean | null;

/**
 * A read expressed in the Realtime Database's own query model.
 *
 * @see planRTDBQuery
 */
export type RTDBQueryPlan = {
    /** Child key to order — and therefore to bound — by. Absent means order by key. */
    orderByChild?: string;
    equalTo?: RTDBFilterValue;
    startAt?: RTDBFilterValue;
    /** Key the window starts after, exclusive. Only valid in key order. */
    startAfter?: RTDBFilterValue;
    endAt?: RTDBFilterValue;
    limitToFirst?: number;
    /**
     * Rows to drop from the front of the result — the caller's `offset`, which
     * the database has no constraint for. Applied by the caller, not by
     * {@link rtdbConstraints}.
     */
    skip?: number;
};

const RTDB = "useFirebaseRTDBDelegate";

const isRTDBValue = (value: unknown): value is RTDBFilterValue =>
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean";

/**
 * Translate a driver read into the Realtime Database's query model, or refuse it.
 *
 * The Realtime Database orders by a single child key per query and bounds that
 * one key with `equalTo`/`startAt`/`endAt`. Nothing else is expressible: no
 * second field, no descending order, no text search, no `or(...)` group.
 *
 * Everything beyond `limit` and `startAfter` used to be destructured out of the
 * read and then never referenced, so a caller asking for `status == "draft"`
 * was handed the entire collection, presented as the answer. A query this
 * database cannot express is refused here instead — a caller that sees an error
 * can fall back, a caller that sees the wrong rows cannot.
 */
export function planRTDBQuery<M extends Record<string, any>>({
    filter,
    orderBy,
    order,
    searchString,
    logical,
    limit,
    offset,
    startAfter: startAfterKey
}: Pick<FetchCollectionProps<M>, "filter" | "orderBy" | "order" | "searchString" | "logical" | "limit" | "offset" | "startAfter">): RTDBQueryPlan {

    if (searchString) {
        throw new Error(`${RTDB}: the Realtime Database has no text search, so \`searchString\` cannot be applied. Index the data in a search service instead.`);
    }
    if (logical) {
        throw new Error(`${RTDB}: the Realtime Database cannot evaluate \`or(...)\`/\`and(...)\` groups.`);
    }
    if (order === "desc") {
        throw new Error(`${RTDB}: the Realtime Database only orders ascending, so \`order: "desc"\` cannot be applied.`);
    }

    const conditions: [string, WhereFilterOp, unknown][] = [];
    Object.entries((filter ?? {}) as FilterValues<string>).forEach(([key, entry]) => {
        if (!entry) return;
        const tuples = Array.isArray(entry[0])
            ? entry as [WhereFilterOp, unknown][]
            : [entry as [WhereFilterOp, unknown]];
        tuples.forEach(([op, value]) => conditions.push([key, op, value]));
    });

    const fields = Array.from(new Set(conditions.map(([key]) => key)));
    if (fields.length > 1) {
        throw new Error(`${RTDB}: the Realtime Database filters on one child key per query; this read asked for ${fields.join(", ")}.`);
    }

    const [field] = fields;
    if (field && orderBy && orderBy !== field) {
        throw new Error(`${RTDB}: a query is ordered by the key it filters on; cannot filter \`${field}\` while ordering by \`${orderBy}\`.`);
    }

    const orderChild = field ?? orderBy;
    const plan: RTDBQueryPlan = orderChild ? { orderByChild: orderChild } : {};

    for (const [key, op, value] of conditions) {
        if (!isRTDBValue(value)) {
            throw new Error(`${RTDB}: cannot bound \`${key}\` by a ${Array.isArray(value) ? "array" : typeof value} value; the Realtime Database compares strings, numbers, booleans and null.`);
        }
        if (op === "==") {
            if (conditions.length > 1) {
                throw new Error(`${RTDB}: \`==\` bounds a query on its own; it cannot be combined with another condition on \`${key}\`.`);
            }
            plan.equalTo = value;
        } else if (op === ">=") {
            plan.startAt = value;
        } else if (op === "<=") {
            plan.endAt = value;
        } else {
            throw new Error(`${RTDB}: the Realtime Database does not support the "${op}" operator (on \`${key}\`). It bounds a single child key with ==, >= and <=.`);
        }
    }

    if (startAfterKey !== undefined) {
        if (orderChild) {
            throw new Error(`${RTDB}: \`startAfter\` pages in key order and cannot be combined with a filter or \`orderBy\`.`);
        }
        plan.startAfter = String(startAfterKey);
    }

    // No constraint expresses `offset`, so the window is read `offset` rows
    // wider and the front is dropped. Dropping it instead — which is what this
    // driver did — serves page one to every page, and a paginated walk that
    // takes the driver at its word never terminates.
    const skip = offset !== undefined && Number.isFinite(offset) && offset > 0
        ? Math.floor(offset)
        : 0;
    if (skip > 0) {
        plan.skip = skip;
    }

    if (limit !== undefined) {
        plan.limitToFirst = limit + skip;
    }

    return plan;
}

/** The plan as Realtime Database query constraints. */
function rtdbConstraints(plan: RTDBQueryPlan): QueryConstraint[] {
    const constraints: QueryConstraint[] = [];
    const bounded = plan.equalTo !== undefined ||
        plan.startAt !== undefined ||
        plan.startAfter !== undefined ||
        plan.endAt !== undefined;

    if (plan.orderByChild !== undefined) {
        constraints.push(orderByChild(plan.orderByChild));
    } else if (bounded) {
        constraints.push(orderByKey());
    }

    if (plan.equalTo !== undefined) constraints.push(equalTo(plan.equalTo));
    if (plan.startAt !== undefined) constraints.push(startAt(plan.startAt));
    if (plan.startAfter !== undefined) constraints.push(startAfter(plan.startAfter));
    if (plan.endAt !== undefined) constraints.push(endAt(plan.endAt));
    if (plan.limitToFirst !== undefined) constraints.push(limitToFirst(plan.limitToFirst));

    return constraints;
}

export function useFirebaseRTDBDelegate({ firebaseApp }: { firebaseApp?: FirebaseApp }): DataDriver {

    const fetchCollection = useCallback(async <M extends Record<string, any>>(
        props: FetchCollectionProps<M>
    ): Promise<Record<string, unknown>[]> => {
        if (!firebaseApp) {
            throw new Error("Firebase app not provided");
        }
        const database = getDatabase(firebaseApp);

        // Throws on any narrowing this database cannot express, rather than
        // answering a filtered read with the whole collection.
        const plan = planRTDBQuery(props);
        const dbQuery = query(ref(database, props.path), ...rtdbConstraints(plan));

        const entity = await get(dbQuery);
        if (entity.exists()) {
            return Object.entries(entity.val()).slice(plan.skip ?? 0).map(([id, values]) => ({
                ...(delegateToCMSModel(values) as Record<string, unknown>),
                id
            }));
        }
        return [];
    }, [firebaseApp]);

    const listenCollection = useCallback(<M extends Record<string, any>>(
        props: ListenCollectionProps<M>
    ): () => void => {
        if (!firebaseApp) {
            throw new Error("Firebase app not provided");
        }
        const database = getDatabase(firebaseApp);

        const {
            onUpdate,
            onError
        } = props;

        // Same refusal as `fetchCollection`: this used to read the whole node
        // regardless of what the subscription asked for.
        const plan = planRTDBQuery(props);
        const dbQuery = query(ref(database, props.path), ...rtdbConstraints(plan));
        const unsubscribe = onValue(dbQuery, (entity) => {
            if (entity.exists()) {
                const result: Record<string, unknown>[] = Object.entries(entity.val()).slice(plan.skip ?? 0).map(([id, values]) => ({
                    ...(delegateToCMSModel(values) as Record<string, unknown>),
                    id
                }));
                onUpdate(result);
            } else {
                onUpdate([]);
            }
        }, (error) => onError?.(error));

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
