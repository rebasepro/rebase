/**
 * The two bridges are inverses: a legacy collection converted into the table
 * model (`collectionsToTableDefs`) and lowered back (`lowerTables`) is the
 * collection it was.
 *
 * "Is" means deep equality, modulo exactly this — nothing else is normalised:
 *
 * 1. {@link UI_COLLECTION_FIELDS} and {@link UI_PROPERTY_FIELDS} are stripped
 *    from the original: the lift does not carry presentation, it reports it in
 *    `notCarried` (checked below, field by field);
 * 2. a function compares by presence: hooks and transforms come back as
 *    adapters that call the original (their behaviour is tested in the unit
 *    suites);
 * 3. a relation's `target` compares by the slug it resolves to (identity is
 *    tested in the unit suites and in server-postgres's plan-equivalence);
 * 4. a `Date` compares as the ISO string the table model stores;
 * 5. the definitions lowering attaches for the planner ({@link PLANNER_FIELDS})
 *    are not part of the legacy shape, and are left out of the lowered side
 *    (what they hold is tested in lower-tables.test.ts).
 *
 * The fixtures are written in the canonical form lowering produces where the
 * planner gives two spellings the same column; the server-postgres
 * plan-equivalence suite covers the other spellings, through the planner.
 */
import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";

import { collectionsToTableDefs } from "../../src/schema/lift-collection";
import { lowerTables } from "../../src/schema/lower-tables";
import { ALL, DOCUMENT_RULES, documents, everything, notes } from "./fixtures/legacy-capabilities";

/** Presentation fields of a collection, stripped before comparing (modulo 1). */
const UI_COLLECTION_FIELDS = ["name", "singularName", "icon", "admin", "childCollections", "ownerId"];
/** Presentation fields of a property, stripped before comparing (modulo 1). */
const UI_PROPERTY_FIELDS = ["name", "propertyConfig", "dynamicProps", "conditions", "mode", "timezone", "propertiesOrder", "admin", "metadata"];

/** What `lowerTables` attaches for the planner (modulo 5). */
const PLANNER_FIELDS = ["tableColumn", "tableRelation", "tableIndex"];

/** A value with modulo 2–5 applied. */
function canonical(value: unknown, path: string[] = []): unknown {
    if (typeof value === "function") {
        // A relation's target, by the slug it resolves to.
        if (path[path.length - 1] === "target") {
            const target: unknown = value();
            return typeof target === "object" && target !== null && "slug" in target ? `target:${String(target.slug)}` : "target:?";
        }
        return "[function]";
    }
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value;
    if (Array.isArray(value)) return value.map((entry, index) => canonical(entry, [...path, String(index)]));
    if (typeof value === "object" && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined || PLANNER_FIELDS.includes(key)) continue;
            out[key] = canonical(entry, [...path, key]);
        }
        return out;
    }
    return value;
}

/** A legacy collection with modulo 1 applied. */
function withoutPresentation(collection: CollectionConfig): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(collection)) {
        if (UI_COLLECTION_FIELDS.includes(key)) continue;
        if (key !== "properties") {
            out[key] = value;
            continue;
        }
        const properties: Record<string, unknown> = {};
        for (const [name, property] of Object.entries(collection.properties)) {
            properties[name] = Object.fromEntries(Object.entries(property).filter(([field]) => !UI_PROPERTY_FIELDS.includes(field)));
        }
        out.properties = properties;
    }
    return out;
}

function roundTrip(collections: readonly CollectionConfig[]): { lowered: PostgresCollectionConfig[]; notes: ReturnType<typeof collectionsToTableDefs>["notCarried"] } {
    const { tables, defaultRls, notCarried } = collectionsToTableDefs(collections);
    return { lowered: lowerTables(tables, defaultRls ? { defaultRls } : {}), notes: notCarried };
}

describe("bridge round trip: lowerTables(collectionsToTableDefs(c)) is c", () => {
    it("reproduces every hand-written legacy collection, in order", () => {
        const { lowered } = roundTrip(ALL);
        expect(lowered.map(collection => collection.slug)).toEqual(ALL.map(collection => collection.slug));
        lowered.forEach((collection, index) => {
            expect(canonical(withoutPresentation(collection))).toEqual(canonical(withoutPresentation(ALL[index])));
        });
    });

    it("derives the labels a collection declaring none was given, from the slug", () => {
        const { lowered } = roundTrip(ALL);
        expect(lowered.map(collection => [collection.slug, collection.name, collection.singularName])).toEqual(expect.arrayContaining([
            ["posts", "Posts", "Post"],
            ["post_titles", "Post Titles", "Post Title"],
            ["everything", "Everything", "Everything"]
        ]));
    });

    it("passes the security rules through as the very objects written", () => {
        const { lowered } = roundTrip(ALL);
        const back = lowered.find(collection => collection.slug === documents.slug);
        expect(back?.securityRules).toEqual(DOCUMENT_RULES);
        back?.securityRules?.forEach((rule, index) => expect(rule).toBe(DOCUMENT_RULES[index]));
    });

    it("returns the same lowered object from every relation into a table", () => {
        const { lowered } = roundTrip(ALL);
        const bySlug = new Map(lowered.map(collection => [collection.slug, collection]));
        for (const collection of lowered) {
            for (const relation of collection.relations ?? []) {
                const target = relation.target();
                expect(target).toBe(bySlug.get(target.slug));
                expect(relation.target()).toBe(target);
            }
        }
    });

    it("strips presentation into notCarried, field by field, and carries the rest", () => {
        // `notes` is the target of no relation, so it is converted once.
        const decorated: PostgresCollectionConfig = {
            ...notes,
            singularName: "Note",
            properties: {
                body: { type: "string", name: "Body", propertyConfig: "markdown", metadata: { crm: true } }
            }
        };
        Reflect.set(decorated, "icon", "article");
        const others = ALL.filter(collection => collection !== notes);
        const { lowered, notes: notCarried } = roundTrip([decorated, ...others]);
        expect(canonical(withoutPresentation(lowered[0]))).toEqual(canonical(withoutPresentation(decorated)));
        expect(notCarried.filter(note => note.collection === "notes").map(note => [note.key ?? "", note.field, note.kind])).toEqual([
            ["", "name", "ui"],
            ["", "singularName", "ui"],
            ["", "icon", "ui"],
            ["body", "name", "ui"],
            ["body", "propertyConfig", "ui"],
            ["body", "metadata", "metadata"]
        ]);
    });

    it("converts the kitchen-sink table with no note but its display name", () => {
        const { notes: notCarried } = roundTrip(ALL);
        expect(notCarried.filter(note => note.collection === everything.slug).map(note => note.field)).toEqual(["name"]);
    });
});
