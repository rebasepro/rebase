import { expect, it } from "@jest/globals";
import { Timestamp } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
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
