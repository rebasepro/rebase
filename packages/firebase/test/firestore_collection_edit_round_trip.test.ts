import { describe, expect, it } from "@jest/globals";
import { defineFirestoreCollection, type FirestoreFields } from "../src/collections";
// The collection editor's pure diff, from its source: `@rebasepro/cms` does
// not export it (it is loaded with the editor's first save), and this package
// is the one that owns what a Firestore definition means.
import {
    firestoreCollectionPatches,
    firestoreSourceEdit,
    type FrontendSourceOperation
} from "../../cms/src/collection_editor/firestore_edit";

/**
 * The collection editor's save of a Firestore collection, end to end at the
 * value level: the definition as written → `defineFirestoreCollection` → the
 * collection the editor shows → the person's edit → patches → the frontend
 * source editor's operations, applied to the definition → `defineFirestoreCollection`
 * again. The collection that comes out must be the one the person saved: the
 * edit reached the definition in its own vocabulary, and nothing else moved.
 */

type Definition = { [key: string]: unknown };

const isObject = (value: unknown): value is { [key: string]: unknown } =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** What the frontend source editor does to the call's argument, over the value instead of the text. */
function applyOperations(definition: Definition, operations: readonly FrontendSourceOperation[]): Definition {
    const root: Definition = structuredClone(Object.fromEntries(Object.entries(definition).filter(([, v]) => typeof v !== "function")));
    for (const [key, value] of Object.entries(definition)) if (typeof value === "function") root[key] = value;
    const parentOf = (path: readonly string[], create: boolean): { [key: string]: unknown } | undefined => {
        let object = root;
        for (const key of path.slice(0, -1)) {
            const next = object[key];
            if (!isObject(next)) {
                if (!create) return undefined;
                object[key] = {};
            }
            const reached = object[key];
            if (!isObject(reached)) return undefined;
            object = reached;
        }
        return object;
    };
    /** Rebuild `object` with its keys in `order`, so insertion order is the file's order. */
    const reorder = (object: { [key: string]: unknown }, order: string[]) => {
        const entries: [string, unknown][] = order.map(key => [key, object[key]]);
        for (const key of Object.keys(object)) delete object[key];
        for (const [key, value] of entries) object[key] = value;
    };
    for (const operation of operations) {
        const last = operation.path[operation.path.length - 1];
        switch (operation.op) {
            case "set": {
                const parent = parentOf(operation.path, true);
                if (!parent) throw new Error("unreachable");
                const exists = last in parent;
                parent[last] = structuredClone(operation.value);
                if (!exists && operation.before !== undefined) {
                    const keys = Object.keys(parent).filter(key => key !== last);
                    keys.splice(keys.indexOf(operation.before), 0, last);
                    reorder(parent, keys);
                }
                break;
            }
            case "remove": {
                const parent = parentOf(operation.path, false);
                if (!parent || !(last in parent)) break;
                delete parent[last];
                if (operation.prune && Object.keys(parent).length === 0 && operation.path.length > 1) {
                    const grand = parentOf(operation.path.slice(0, -1), false);
                    if (grand) delete grand[operation.path[operation.path.length - 2]];
                }
                break;
            }
            case "rename": {
                const parent = parentOf(operation.path, false);
                if (!parent) throw new Error("unreachable");
                const keys = Object.keys(parent).map(key => (key === last ? operation.to : key));
                parent[operation.to] = parent[last];
                delete parent[last];
                reorder(parent, keys);
                break;
            }
            case "move": {
                const parent = parentOf(operation.path, false);
                if (!parent) throw new Error("unreachable");
                const keys = Object.keys(parent).filter(key => key !== last);
                keys.splice(operation.before !== undefined ? keys.indexOf(operation.before) : keys.length, 0, last);
                reorder(parent, keys);
                break;
            }
        }
    }
    return root;
}

const traces = () => [];

/** `examples/hybrid/frontend/src/cms/events.ts`, plus a subcollections thunk the edit must keep. */
const definition = (): Definition => ({
    slug: "fs_events",
    path: "events",
    name: "Live events (Firestore)",
    singularName: "Live event",
    dataSource: "firestore",
    fields: {
        type: {
            name: "Event type",
            type: "string",
            required: true,
            enum: { signup: "Sign-up", checkout: "Checkout", support: "Support request" }
        },
        payload: { name: "Payload", type: "map" },
        customerId: { name: "Customer", type: "reference", target: "customers" },
        receivedAt: { name: "Received at", type: "date", autoValue: "on_create" }
    },
    admin: { icon: "Bolt", group: "Firestore" },
    subcollections: traces
});

const isFields = (value: unknown): value is FirestoreFields =>
    isObject(value) && Object.values(value).every(field => isObject(field) && typeof field.type === "string");

function define(value: Definition) {
    const { fields, slug, name, path, singularName, dataSource, admin, subcollections } = value;
    if (!isFields(fields) || typeof slug !== "string" || typeof name !== "string") throw new Error("not a definition");
    return defineFirestoreCollection({
        slug,
        name,
        fields,
        ...(typeof path === "string" ? { path } : {}),
        ...(typeof singularName === "string" ? { singularName } : {}),
        ...(typeof dataSource === "string" ? { dataSource } : {}),
        ...(isObject(admin) ? { admin: { ...(typeof admin.icon === "string" ? { icon: admin.icon } : {}), ...(typeof admin.group === "string" ? { group: admin.group } : {}) } } : {}),
        ...(subcollections === traces ? { subcollections: traces } : {})
    });
}

/** The collection as the panel holds it: the admin block flattened beside it. */
function shown(value: Definition) {
    const collection = define(value);
    return { ...collection, ...(collection.admin ?? {}) };
}

function roundTrip(edit: (collection: ReturnType<typeof shown>) => void) {
    const before = shown(definition());
    const after = shown(definition());
    edit(after);
    const patches = firestoreCollectionPatches(before, after);
    const edited = applyOperations(definition(), firestoreSourceEdit("fs_events", patches).operations);
    return { patches, edited, saved: after, composed: shown(edited) };
}

describe("an edit in the collection editor reaches the definition and comes back as saved", () => {
    it("a label, a type, a rule, required", () => {
        const { composed, saved, edited } = roundTrip(after => {
            after.properties.payload = { name: "Body", type: "string", validation: { required: true, max: 200 } };
            after.properties.type = { ...after.properties.type, validation: { required: false } };
        });
        expect(composed.properties.payload).toEqual(saved.properties.payload);
        expect(composed.properties.type.validation?.required).toBeFalsy();
        expect(composed.properties.customerId).toEqual(saved.properties.customerId);
        expect(edited.fields).toMatchObject({ payload: { name: "Body", type: "string", required: true, validation: { max: 200 } } });
        expect(JSON.stringify(edited.fields)).not.toContain("\"required\":false");
    });

    it("adding and removing fields", () => {
        const { composed, saved, edited } = roundTrip(after => {
            after.properties.channel = { name: "Channel", type: "string", multiline: true, validation: { required: true } };
            delete after.properties.receivedAt;
        });
        expect(composed.properties).toEqual({
            ...saved.properties,
            channel: { name: "Channel", type: "string", admin: { multiline: true }, validation: { required: true } }
        });
        expect(Object.keys(edited.fields ?? {})).toEqual(["type", "payload", "customerId", "channel"]);
    });

    it("a reorder, an option and an admin option; the cross-source reference and the thunk are untouched", () => {
        const { composed, edited } = roundTrip(after => {
            after.propertiesOrder = ["customerId", "type", "payload", "receivedAt"];
            after.name = "Events";
            after.icon = "Event";
        });
        expect(Object.keys(edited.fields ?? {})).toEqual(["customerId", "type", "payload", "receivedAt"]);
        expect(composed.name).toBe("Events");
        expect(composed.admin).toEqual({ icon: "Event", group: "Firestore" });
        expect(composed.properties.customerId).toEqual({ name: "Customer", type: "reference", path: "customers" });
        expect(edited.subcollections).toBe(traces);
    });
});
