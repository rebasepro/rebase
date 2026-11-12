import { afterAll, describe, expect, it } from "@jest/globals";
import { deleteApp, initializeApp } from "firebase/app";
import { doc, DocumentReference, getFirestore, refEqual, terminate } from "firebase/firestore";
import { EntityReference } from "@rebasepro/types";
import { firestoreToRebaseModel, rebaseToFirestoreModel } from "../src/hooks/useFirestoreDriver";

/**
 * How a Firestore document stores a reference, by where it points.
 *
 * A Firestore collection beside Postgres tables references both: another
 * Firestore document (`fs_customers`) and a Postgres row (`customers/42`).
 * Until this, every reference was written as `doc(path, id)` — so the Postgres
 * row became a `DocumentReference` to `customers/42` in Firestore, a document
 * that does not exist, which no query for customer 42 could match, and which
 * read back as a pointer into Firestore.
 */

/** An offline Firestore: nothing here reaches a server. */
const app = initializeApp({ projectId: "demo-cross-engine", apiKey: "offline", appId: "offline" }, "cross-engine-test");
const firestore = getFirestore(app);
afterAll(() => terminate(firestore).then(() => deleteApp(app)));

/** The driver of the `firestore` data source, as `useFirestoreDataSource({ key: "firestore" })` builds it. */
const own = { dataSourceKey: "firestore" };

const postgresCustomer = new EntityReference({ id: "42", path: "customers", driver: "(default)" });
const firestoreCustomer = new EntityReference({ id: "c1", path: "customers", driver: "firestore" });

describe("a reference to a record of another data source", () => {

    it("is stored as the record's id", () => {
        const stored = rebaseToFirestoreModel({ customerId: postgresCustomer, others: [postgresCustomer] }, firestore, own);
        expect(stored).toEqual({ customerId: "42", others: ["42"] });
    });

    it("reads back as that id, for the admin to turn into a reference from the field's target", () => {
        const stored = rebaseToFirestoreModel({ customerId: postgresCustomer }, firestore, own);
        expect(firestoreToRebaseModel(stored, own)).toEqual({ customerId: "42" });
    });

    it("is queried by that id", () => {
        // A filter value goes through the same conversion as a saved one, so
        // `customerId == <picked customer>` matches what was saved.
        expect(rebaseToFirestoreModel(postgresCustomer, firestore, own)).toBe("42");
    });

    it("was written as a dangling DocumentReference when the driver did not know its data source", () => {
        // What every save did before: still what a driver built without a
        // data-source key does, so a Firestore-only project's references are
        // written exactly as before.
        const stored = rebaseToFirestoreModel(postgresCustomer, firestore);
        expect(stored).toBeInstanceOf(DocumentReference);
        expect(stored instanceof DocumentReference ? stored.path : undefined).toBe("customers/42");
    });
});

describe("a reference to a document of the same Firestore", () => {

    it("is still a DocumentReference, whether it names its data source or not", () => {
        for (const reference of [firestoreCustomer, new EntityReference({ id: "c1", path: "customers" })]) {
            const stored = rebaseToFirestoreModel(reference, firestore, own);
            expect(stored).toBeInstanceOf(DocumentReference);
            expect(stored instanceof DocumentReference ? stored.path : undefined).toBe("customers/c1");
        }
        // The engine name means the same thing as the key.
        const byEngine = new EntityReference({ id: "c1", path: "customers", driver: "firestore" });
        expect(rebaseToFirestoreModel(byEngine, firestore, { dataSourceKey: "analytics" })).toBeInstanceOf(DocumentReference);
    });

    it("reads back carrying the data source it was read from", () => {
        const read = firestoreToRebaseModel({ customer: doc(firestore, "customers", "c1") }, own);
        expect(read).toEqual({ customer: new EntityReference({ id: "c1", path: "customers", databaseId: "(default)", driver: "firestore" }) });

        // Round trip: written back as the same DocumentReference.
        const value = read !== null && typeof read === "object" ? Reflect.get(read, "customer") : undefined;
        const rewritten = rebaseToFirestoreModel(value, firestore, own);
        expect(rewritten instanceof DocumentReference && refEqual(rewritten, doc(firestore, "customers", "c1"))).toBe(true);
    });

    it("reads back without a data source when the driver knows none, as before", () => {
        expect(firestoreToRebaseModel(doc(firestore, "customers", "c1")))
            .toEqual(new EntityReference({ id: "c1", path: "customers", databaseId: "(default)" }));
    });
});
