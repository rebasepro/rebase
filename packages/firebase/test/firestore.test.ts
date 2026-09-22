import { afterAll, describe, expect, it } from "@jest/globals";
import { deleteApp, initializeApp } from "firebase/app";
import { deleteField, doc, DocumentData, getFirestore, terminate, Timestamp, writeBatch } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { rebaseToFirestoreModel, firestoreToRebaseModel, resolveOffsetWindow } from "../src/hooks/useFirestoreDriver";

it("rebaseToFirestoreModel", () => {
    const inputValues = {
        content:
            [{
                type: "question",
                id: "question_1",
                question_type: "single_choice"
            }],
        main_image: null,
        order: 2,
        title: { en: "Test pill in english" }
    };
    const result = rebaseToFirestoreModel(inputValues, {} as unknown as Firestore);
    expect(result).toEqual(inputValues);
});

it("timestamp conversion", () => {
    const timestamp = Timestamp.now();
    const date = timestamp.toDate();
    expect(firestoreToRebaseModel({ created_on: timestamp })
    ).toEqual({ created_on: date });
});

it("timestamp array conversion", () => {

    const timestamp = Timestamp.now();
    const date = timestamp.toDate();

    expect(
        firestoreToRebaseModel({ my_array: [timestamp] })
    ).toEqual({ my_array: [date] });

});

it("vector conversion", () => {
    // The tag is `__type__`, not `type`. Spelled the wrong way it falls through
    // to the generic object branch — which is exactly what the old
    // `if (result.embedding?.toArray) … else expect(result).toBeDefined()`
    // shape hid: a broken mapping took the else branch and passed.
    const inputValues = {
        embedding: {
            __type__: "__vector__",
            value: [0.1, 0.2, 0.3]
        }
    };

    const result = rebaseToFirestoreModel(inputValues, {} as unknown as Firestore) as {
        embedding: { toArray: () => number[] }
    };

    expect(typeof result.embedding.toArray).toBe("function");
    expect(result.embedding.toArray()).toEqual([0.1, 0.2, 0.3]);
});

it("vector round trip", () => {
    const inputValues = {
        embedding: {
            __type__: "__vector__",
            value: [0.1, 0.2, 0.3]
        }
    };

    const stored = rebaseToFirestoreModel(inputValues, {} as unknown as Firestore);

    // On the way back a Firestore VectorValue has to become the tagged shape
    // again, or what the panel reads is not what it wrote.
    expect(firestoreToRebaseModel(stored)).toEqual(inputValues);
});

it("reads past the offset", () => {
    // Firestore has no `offset()`, so page two has to be read as
    // `offset + limit` documents with the first `offset` dropped. Ignoring the
    // offset — which is what the driver did — served page one every time, and
    // `findAll()` walked in place until it tripped its row cap.
    expect(resolveOffsetWindow(50, 100)).toEqual({
        fetchLimit: 150,
        skip: 100
    });
});

it("leaves an unpaged read alone", () => {
    expect(resolveOffsetWindow(50, 0)).toEqual({
        fetchLimit: 50,
        skip: 0
    });
    expect(resolveOffsetWindow(50, undefined)).toEqual({
        fetchLimit: 50,
        skip: 0
    });
    expect(resolveOffsetWindow(undefined, undefined)).toEqual({
        fetchLimit: undefined,
        skip: 0
    });
});

it("skips without a limit", () => {
    expect(resolveOffsetWindow(undefined, 20)).toEqual({
        fetchLimit: undefined,
        skip: 20
    });
});

describe("undefined values", () => {

    const app = initializeApp({
        projectId: "demo-firestore-model",
        apiKey: "offline",
        appId: "offline"
    }, "firestore-model-test");
    const firestore = getFirestore(app);

    afterAll(() => terminate(firestore).then(() => deleteApp(app)));

    /** What Firestore would be asked to write, checked by its own validator. */
    function validateWrite(values: unknown): void {
        if (typeof values !== "object" || values === null || Array.isArray(values)) {
            throw new Error("a save converts to a map");
        }
        const data: DocumentData = Object.fromEntries(Object.entries(values));
        // A batch parses and validates on `set`, and sends nothing until
        // `commit()` — so this needs no server.
        writeBatch(firestore).set(doc(firestore, "posts", "p1"), data, { merge: true });
    }

    it("drops an undefined key in a map inside an array", () => {
        // Firestore cannot delete a field inside an array element, so a
        // `deleteField()` there made it refuse the whole save: "deleteField()
        // is not currently supported inside arrays". An array element is
        // written whole, so the key is simply left out.
        const converted = rebaseToFirestoreModel({
            title: "t",
            blocks: [{ kind: "text", caption: undefined, meta: { note: undefined, lang: "en" } }]
        }, firestore);

        expect(converted).toStrictEqual({
            title: "t",
            blocks: [{ kind: "text", meta: { lang: "en" } }]
        });
        expect(() => validateWrite(converted)).not.toThrow();
    });

    it("still deletes an undefined field of the document or of one of its maps", () => {
        const converted = rebaseToFirestoreModel({
            subtitle: undefined,
            address: { street: undefined, city: "Madrid" }
        }, firestore);

        expect(converted).toStrictEqual({
            subtitle: deleteField(),
            address: { street: deleteField(), city: "Madrid" }
        });
        expect(() => validateWrite(converted)).not.toThrow();
    });

});
