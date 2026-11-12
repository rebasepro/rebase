import { useMemo } from "react";
import type { FirebaseApp } from "firebase/app";
import type { DataSourceDefinition } from "@rebasepro/types";
import { registerFirestoreCapabilities } from "../capabilities";
import { FirestoreDataDriver, FirestoreIndexesBuilder, useFirestoreDriver } from "./useFirestoreDriver";
import type { FirestoreTextSearchControllerBuilder } from "../types/text_search";

/**
 * Options of {@link useFirestoreDataSource}.
 * @group Firebase
 */
export interface FirestoreDataSourceOptions {
    /**
     * The data source's key: what a Firestore collection's `dataSource` names.
     * `DEFAULT_DATA_SOURCE_KEY` makes Firestore the default source, as
     * `RebaseFirebaseApp` does.
     */
    key: string;

    /** The initialised Firebase app. The driver reports itself not initialised until it is set. */
    firebaseApp?: FirebaseApp;

    /**
     * The Firestore database this source reads and writes, when it is not the
     * app's default one. A collection's own `databaseId` still wins.
     */
    databaseId?: string;

    /** A label for the source, shown where the admin names data sources. */
    label?: string;

    /**
     * Builds the controller that answers text searches with the ids of the
     * matching documents (Algolia, Typesense, Pinecone, Rebase search…).
     */
    textSearchControllerBuilder?: FirestoreTextSearchControllerBuilder;

    /**
     * Search in the browser over the documents themselves when no controller
     * covers a collection. Reads every document of the collection: fine for a
     * small one, slow and costly for a large one.
     */
    localTextSearchEnabled?: boolean;

    /**
     * The composite indexes the database has, so the admin offers only the
     * filter and sort combinations Firestore can answer.
     */
    firestoreIndexesBuilder?: FirestoreIndexesBuilder;
}

/**
 * The `<Rebase dataSources>` entry {@link useFirestoreDataSource} returns: a
 * direct Firestore source and its driver.
 * @group Firebase
 */
export type FirestoreDataSource = DataSourceDefinition & {
    engine: "firestore";
    transport: "direct";
    driver: FirestoreDataDriver;
};

/**
 * A Firestore data source for `<Rebase dataSources={[…]}>`: the browser reads
 * and writes the collections whose `dataSource` is `key` straight from
 * Firestore, beside the Postgres tables the Rebase client serves.
 *
 * The entry is the same object on every render while the options are, so it
 * can be written inline in `dataSources` without rebuilding the data layer.
 * It also registers Firestore's capabilities, so its collections never get
 * relation tabs or filters Firestore cannot run.
 *
 * @example
 * ```tsx
 * const firestoreSource = useFirestoreDataSource({ key: "firestore", firebaseApp });
 * return <Rebase client={rebaseClient} dataSources={[firestoreSource]}>…</Rebase>;
 * ```
 * @group Firebase
 */
export function useFirestoreDataSource({
    key,
    firebaseApp,
    databaseId,
    label,
    textSearchControllerBuilder,
    localTextSearchEnabled,
    firestoreIndexesBuilder
}: FirestoreDataSourceOptions): FirestoreDataSource {
    // Again here, not only when the package was evaluated: a bundle can hold
    // a second copy of the types package that was evaluated after it.
    registerFirestoreCapabilities();

    const driver = useFirestoreDriver({
        firebaseApp,
        textSearchControllerBuilder,
        localTextSearchEnabled,
        firestoreIndexesBuilder,
        dataSourceKey: key,
        databaseId
    });

    return useMemo<FirestoreDataSource>(() => ({
        key,
        engine: "firestore",
        transport: "direct",
        driver,
        ...(databaseId !== undefined ? { databaseId } : {}),
        ...(label !== undefined ? { label } : {})
    }), [key, driver, databaseId, label]);
}
