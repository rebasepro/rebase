import { describe, expect, it } from "@jest/globals";
import type { AdminCollection } from "@rebasepro/cms-types";

import { firestoreCollectionPatches, firestoreSourceEdit } from "../../src/collection_editor/firestore_edit";
import { SplitEditError } from "../../src/collection_editor/split_edit_error";

/**
 * A save of the collection editor on a Firestore collection: the collection
 * as the panel holds it (what `defineFirestoreCollection` returned, the admin
 * block flattened beside it) before and after the edit, into
 * `FirestoreCollectionPatch`es in the definition's own vocabulary, and those
 * into the frontend source editor's operations.
 */

const customerChip = () => null;

/** `examples/hybrid/frontend/src/cms/events.ts`, as the panel holds it. */
function events(): AdminCollection {
    const admin = { icon: "Bolt", group: "Firestore" };
    return {
        slug: "fs_events",
        path: "events",
        name: "Live events (Firestore)",
        singularName: "Live event",
        dataSource: "firestore",
        engine: "firestore",
        admin,
        ...admin,
        properties: {
            type: {
                name: "Event type",
                type: "string",
                validation: { required: true },
                enum: { signup: "Sign-up", checkout: "Checkout", support: "Support request" }
            },
            payload: { name: "Payload", type: "map" },
            customerId: { name: "Customer", type: "reference", path: "customers", admin: { Preview: customerChip } },
            receivedAt: { name: "Received at", type: "date", autoValue: "on_create" }
        }
    };
}

const slug = "fs_events";

describe("a field's label, type and validation", () => {
    it("a label is one setFieldOption", () => {
        const after = events();
        after.properties.payload = { ...after.properties.payload, name: "Body" };
        expect(firestoreCollectionPatches(events(), after)).toEqual([
            { op: "setFieldOption", collection: slug, key: "payload", path: ["name"], value: "Body" }
        ]);
    });

    it("a type change sets the type and removes what the old type had", () => {
        const after = events();
        after.properties.receivedAt = { name: "Received at", type: "string" };
        expect(firestoreCollectionPatches(events(), after)).toEqual([
            { op: "setFieldOption", collection: slug, key: "receivedAt", path: ["type"], value: "string" },
            { op: "removeFieldOption", collection: slug, key: "receivedAt", path: ["autoValue"] }
        ]);
    });

    it("validation is written at the rule that changed; `required` as `required`, and with its twin", () => {
        const after = events();
        after.properties.payload = { name: "Payload", type: "map", validation: { required: true } };
        after.properties.type = { ...after.properties.type, validation: { required: false } };
        const patches = firestoreCollectionPatches(events(), after);
        expect(patches).toEqual([
            { op: "removeFieldOption", collection: slug, key: "type", path: ["required"] },
            { op: "setFieldOption", collection: slug, key: "payload", path: ["required"], value: true }
        ]);
        expect(firestoreSourceEdit(slug, patches).operations).toEqual([
            { op: "remove", path: ["fields", "type", "required"] },
            { op: "remove", path: ["fields", "type", "validation", "required"], prune: true },
            { op: "remove", path: ["fields", "payload", "validation", "required"], prune: true },
            { op: "set", path: ["fields", "payload", "required"], value: true }
        ]);
    });

    it("a string rule is set under validation", () => {
        const after = events();
        after.properties.type = { ...after.properties.type, validation: { required: true, max: 40 } };
        expect(firestoreCollectionPatches(events(), after)).toEqual([
            { op: "setFieldOption", collection: slug, key: "type", path: ["validation"], value: { max: 40 } }
        ]);
    });
});

describe("adding and removing fields", () => {
    it("a new field is written whole, in the field vocabulary; a removed one goes", () => {
        const after = events();
        after.properties.channel = { name: "Channel", type: "reference", path: "channels", validation: { required: true } };
        delete after.properties.payload;
        expect(firestoreCollectionPatches(events(), after)).toEqual([
            { op: "addField", collection: slug, key: "channel", field: { name: "Channel", type: "reference", target: "channels", required: true } },
            { op: "removeField", collection: slug, key: "payload" }
        ]);
    });

    it("a presentation key of a new field is written under its admin block", () => {
        const after = events();
        after.properties.notes = { name: "Notes", type: "string", multiline: true };
        expect(firestoreCollectionPatches(events(), after)[0]).toEqual(
            { op: "addField", collection: slug, key: "notes", field: { name: "Notes", type: "string", admin: { multiline: true } } });
    });

    it("the order the editor shows becomes moves, when the file states no order", () => {
        const after = events();
        after.propertiesOrder = ["customerId", "type", "payload", "receivedAt"];
        const patches = firestoreCollectionPatches(events(), after);
        expect(patches).toEqual([{ op: "moveField", collection: slug, key: "customerId", before: "type" }]);
        expect(firestoreSourceEdit(slug, patches).operations).toEqual([{ op: "move", path: ["fields", "customerId"], before: "type" }]);
    });

    it("an order the file states is set like any option", () => {
        const before = events();
        before.propertiesOrder = ["type", "payload", "customerId", "receivedAt"];
        const after = { ...before, propertiesOrder: ["payload", "type", "customerId", "receivedAt"] };
        expect(firestoreCollectionPatches(before, after)).toEqual([
            { op: "setOption", collection: slug, path: ["admin", "propertiesOrder"], value: ["payload", "type", "customerId", "receivedAt"] }
        ]);
    });
});

describe("collection options", () => {
    it("the name, an admin option and a removed option", () => {
        const after: AdminCollection = { ...events(), name: "Events", icon: "Event" };
        delete after.singularName;
        expect(firestoreCollectionPatches(events(), after)).toEqual([
            { op: "setOption", collection: slug, path: ["name"], value: "Events" },
            { op: "setOption", collection: slug, path: ["admin", "icon"], value: "Event" },
            { op: "removeOption", collection: slug, path: ["singularName"] }
        ]);
    });

    it("an unchanged collection is no patch at all; the cross-source reference is untouched", () => {
        const after = events();
        after.properties.payload = { ...after.properties.payload, name: "Body" };
        const patches = firestoreCollectionPatches(events(), after);
        expect(JSON.stringify(patches)).not.toContain("customers");
        expect(firestoreCollectionPatches(events(), events())).toEqual([]);
    });
});

describe("refusals", () => {
    it("a slug change", () => {
        expect(() => firestoreCollectionPatches(events(), { ...events(), slug: "events" })).toThrow(SplitEditError);
    });

    it("a changed value that is code", () => {
        const after = events();
        after.properties.customerId = { ...after.properties.customerId, admin: { Preview: () => null } };
        expect(() => firestoreCollectionPatches(events(), after)).toThrow(/edited in code/);
    });
});

describe("the source edit", () => {
    it("names the call by its slug and carries the version it was made against", () => {
        expect(firestoreSourceEdit(slug, [{ op: "renameField", collection: slug, key: "payload", to: "body" }], "abc")).toEqual({
            target: { callee: "defineFirestoreCollection", key: "slug", value: slug },
            version: "abc",
            operations: [{ op: "rename", path: ["fields", "payload"], to: "body" }]
        });
    });

    it("a nested option removal prunes what it empties", () => {
        expect(firestoreSourceEdit(slug, [{ op: "removeOption", collection: slug, path: ["admin", "icon"] }]).operations)
            .toEqual([{ op: "remove", path: ["admin", "icon"], prune: true }]);
    });
});
