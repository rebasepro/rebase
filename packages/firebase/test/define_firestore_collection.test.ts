import { describe, expect, it } from "@jest/globals";
import {
    EntityReference,
    getDataSourceCapabilities,
    isFirebaseCollectionConfig,
    type FirebaseProperties
} from "@rebasepro/types";
import { resolveDataSource } from "@rebasepro/common";
import { defineFirestoreCollection, type FirestoreDocumentOf } from "../src/collections";

/**
 * `defineFirestoreCollection` — the one way to declare a Firestore collection.
 *
 * The runtime half is a normalisation (fields → the property model the admin
 * and the driver read); the type half is the document type inferred from the
 * fields and the per-field checks. The `@ts-expect-error` lines are evaluated
 * by `pnpm typecheck` (this directory is in `tsconfig.tests.json`).
 */

/** `true` when `A` and `B` are the same type, else a compile error at the call. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function assertType<T extends true>(_proof: T): void { /* compile-time only */ }

const eventTraces = defineFirestoreCollection({
    slug: "fs_event_traces",
    path: "traces",
    name: "Traces",
    dataSource: "firestore",
    fields: {
        step: { name: "Step", type: "string" }
    }
});

// Spec §6.3, verbatim.
const firestoreEvents = defineFirestoreCollection({
    slug: "fs_events",
    path: "events",
    name: "Live Events (Firestore)",
    dataSource: "firestore",
    fields: {
        type: { name: "Event Type", type: "string", required: true },
        payload: { name: "Payload", type: "map" },
        customerId: { name: "Customer", type: "reference", target: "customers" }
    },
    subcollections: () => [eventTraces]
});

describe("defineFirestoreCollection", () => {

    it("returns a Firestore collection the admin routes by its data source", () => {
        expect(isFirebaseCollectionConfig(firestoreEvents)).toBe(true);
        expect(firestoreEvents.engine).toBe("firestore");
        expect(firestoreEvents.slug).toBe("fs_events");
        expect(firestoreEvents.path).toBe("events");
        expect(firestoreEvents.dataSource).toBe("firestore");
        expect(firestoreEvents.subcollections?.()).toEqual([eventTraces]);
        expect("fields" in firestoreEvents).toBe(false);

        const registry = { firestore: { key: "firestore", engine: "firestore", transport: "direct" as const } };
        const resolved = resolveDataSource(firestoreEvents, registry);
        expect(resolved).toMatchObject({ key: "firestore", engine: "firestore", transport: "direct" });
    });

    it("writes the shorthands out as the property model", () => {
        expect(firestoreEvents.properties).toEqual({
            type: { name: "Event Type", type: "string", validation: { required: true } },
            payload: { name: "Payload", type: "map" },
            customerId: { name: "Customer", type: "reference", path: "customers" }
        });
    });

    it("normalises nested fields: map properties, array of, oneOf blocks", () => {
        const blog = defineFirestoreCollection({
            slug: "blog",
            name: "Blog",
            fields: {
                author: {
                    type: "map",
                    properties: {
                        name: { type: "string", required: true },
                        profile: { type: "reference", target: "users" }
                    }
                },
                related: { type: "array", of: { type: "reference", target: "products" } },
                pair: { type: "array", of: [{ type: "string", required: true }, { type: "number" }] },
                content: {
                    type: "array",
                    oneOf: {
                        typeField: "type",
                        valueField: "value",
                        properties: {
                            text: { type: "string", admin: { markdown: true } },
                            products: { type: "array", of: { type: "reference", target: "products" } }
                        }
                    }
                },
                status: {
                    type: "string",
                    required: true,
                    enum: [{ id: "draft", label: "Draft", color: "grayLight" }, { id: "published", label: "Published", color: "greenDark" }],
                    validation: { requiredMessage: "Pick a status" }
                }
            }
        });
        const expected: FirebaseProperties = {
            author: {
                type: "map",
                properties: {
                    name: { type: "string", validation: { required: true } },
                    profile: { type: "reference", path: "users" }
                }
            },
            related: { type: "array", of: { type: "reference", path: "products" } },
            pair: { type: "array", of: [{ type: "string", validation: { required: true } }, { type: "number" }] },
            content: {
                type: "array",
                oneOf: {
                    typeField: "type",
                    valueField: "value",
                    properties: {
                        text: { type: "string", admin: { markdown: true } },
                        products: { type: "array", of: { type: "reference", path: "products" } }
                    }
                }
            },
            status: {
                type: "string",
                enum: [{ id: "draft", label: "Draft", color: "grayLight" }, { id: "published", label: "Published", color: "greenDark" }],
                validation: { requiredMessage: "Pick a status", required: true }
            }
        };
        expect(blog.properties).toEqual(expected);
        expect(blog.dataSource).toBeUndefined();
    });

    it("refuses what has a single way of being written elsewhere", () => {
        expect(() => defineFirestoreCollection({
            slug: "x",
            name: "X",
            // @ts-expect-error — `path` on a reference field: Firestore fields say `target`.
            fields: { ref: { type: "reference", path: "customers" } }
        })).toThrow(/field "ref" sets `path`.*`target: "<collection slug>"`/);

        expect(() => defineFirestoreCollection({
            slug: "x",
            name: "X",
            fields: { title: { type: "string", required: true, validation: { required: false } } }
        })).toThrow(/field "title" says `required: true` and `validation.required: false`/);

        expect(() => defineFirestoreCollection({
            slug: "x",
            name: "X",
            fields: {},
            // @ts-expect-error — a Firestore collection has fields, not properties.
            properties: {}
        })).toThrow(/declares its fields under `fields`/);

        expect(() => defineFirestoreCollection({
            slug: "x",
            name: "X",
            // @ts-expect-error — a relation is a Postgres table's, not a Firestore field.
            fields: { author: { type: "relation" } }
        })).toThrow(/type "relation", which Firestore does not store/);
    });

    it("checks each field against its own kind", () => {
        defineFirestoreCollection({
            slug: "x",
            name: "X",
            fields: {
                // @ts-expect-error — misspelled `validation` is not a key of a string field.
                title: { type: "string", validaton: { required: true } }
            }
        });
        defineFirestoreCollection({
            slug: "x",
            name: "X",
            fields: {
                // @ts-expect-error — `target` belongs to a reference field.
                title: { type: "string", target: "customers" }
            }
        });
        defineFirestoreCollection({
            slug: "x",
            name: "X",
            fields: {
                // @ts-expect-error — `columnType` is a Postgres column's.
                count: { type: "number", columnType: "integer" }
            }
        });
    });

    it("infers the document type from the fields", () => {
        type EventDocument = FirestoreDocumentOf<{
            type: { name: "Event Type"; type: "string"; required: true };
            payload: { name: "Payload"; type: "map" };
            customerId: { name: "Customer"; type: "reference"; target: "customers" };
            happenedAt: { type: "date"; validation: { required: true } };
            tags: { type: "array"; of: { type: "string" } };
        }>;
        assertType<Equals<EventDocument["type"], string>>(true);
        assertType<Equals<EventDocument["customerId"], EntityReference | undefined>>(true);
        assertType<Equals<EventDocument["happenedAt"], Date>>(true);
        assertType<Equals<EventDocument["tags"], string[] | undefined>>(true);
        assertType<Equals<keyof EventDocument, "type" | "payload" | "customerId" | "happenedAt" | "tags">>(true);

        // The admin block is checked against the collection's own keys.
        defineFirestoreCollection({
            slug: "y",
            name: "Y",
            fields: { title: { type: "string", required: true } },
            admin: { display: { title: "title" }, propertiesOrder: ["title"] }
        });
        defineFirestoreCollection({
            slug: "y",
            name: "Y",
            fields: { title: { type: "string", required: true } },
            // @ts-expect-error — `name` is not one of this collection's fields.
            admin: { propertiesOrder: ["name"] }
        });

        // A required field is a required key of what a callback is handed.
        defineFirestoreCollection({
            slug: "z",
            name: "Z",
            fields: { title: { type: "string", required: true } },
            callbacks: {
                beforeSave: ({ values }) => {
                    const title: string | undefined = values.title;
                    return { ...values, title: title?.trim() };
                }
            }
        });
    });

    it("leaves Firestore's capabilities registered, whatever the types package says", () => {
        // Imported above for `defineFirestoreCollection` alone: evaluating the
        // package registered them.
        const registered: unknown = Reflect.get(globalThis, Symbol.for("@rebasepro/types.dataSourceCapabilities.v1"));
        expect(registered instanceof Map && registered.has("firestore")).toBe(true);

        const capabilities = getDataSourceCapabilities(resolveDataSource(firestoreEvents).engine);
        expect(capabilities.supportsRelations).toBe(false);
        expect(capabilities.supportsSubcollections).toBe(true);
        expect(capabilities.filterOperators).not.toContain("ilike");
        expect(capabilities.filterOperators).not.toContain("like");
        expect(capabilities.filterOperators).toContain("==");
    });
});
