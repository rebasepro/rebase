import { expect, it } from "@jest/globals";
import { Timestamp } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { cmsToFirestoreModel, firestoreToCMSModel } from "../src/hooks/useFirestoreDriver";

it("cmsToFirestoreModel", () => {
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
    const result = cmsToFirestoreModel(inputValues, {} as unknown as Firestore);
    expect(result).toEqual(inputValues);
});

it("timestamp conversion", () => {
    const timestamp = Timestamp.now();
    const date = timestamp.toDate();
    expect(firestoreToCMSModel({ created_on: timestamp })
    ).toEqual({ created_on: date });
});

it("timestamp array conversion", () => {

    const timestamp = Timestamp.now();
    const date = timestamp.toDate();

    expect(
        firestoreToCMSModel({ my_array: [timestamp] })
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

    const result = cmsToFirestoreModel(inputValues, {} as unknown as Firestore) as {
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

    const stored = cmsToFirestoreModel(inputValues, {} as unknown as Firestore);

    // On the way back a Firestore VectorValue has to become the tagged shape
    // again, or what the panel reads is not what it wrote.
    expect(firestoreToCMSModel(stored)).toEqual(inputValues);
});
