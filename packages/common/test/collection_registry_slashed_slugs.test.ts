import { CollectionConfig } from "@rebasepro/types";
import { CollectionRegistry } from "../src/collections/CollectionRegistry";

/**
 * A slug may contain slashes. Firestore apps address versioned or
 * locale-partitioned collections that way — `medico/v2.0.0/joints` is one
 * collection's name — and those collections have subcollections of their own.
 *
 * The walker read the first segment as the root, so it looked for a collection
 * called `medico`, threw, and every subcollection under such a slug resolved to
 * nothing: the joint's tabs rendered empty.
 */

const variants: CollectionConfig = {
    name: "Variants",
    slug: "variants",
    engine: "firestore",
    properties: {}
};

const movements: CollectionConfig = {
    name: "Movements",
    slug: "movements",
    engine: "firestore",
    subcollections: () => [variants],
    properties: {}
};

const joints: CollectionConfig = {
    name: "Joints",
    slug: "medico/v2.0.0/joints",
    engine: "firestore",
    subcollections: () => [movements],
    properties: {}
};

/** Two segments: the whole path's parity is off by one for everything under it. */
const episodes: CollectionConfig = {
    name: "Episodes",
    slug: "episodes",
    engine: "firestore",
    properties: {}
};

const podcasts: CollectionConfig = {
    name: "Podcasts",
    slug: "content/podcasts",
    engine: "firestore",
    subcollections: () => [episodes],
    properties: {}
};

/** A shorter registered slug the longer one starts with. */
const content: CollectionConfig = {
    name: "Content",
    slug: "content",
    engine: "firestore",
    properties: {}
};

const registry = () => new CollectionRegistry([joints, podcasts, content]);

const slugsOf = (resolved: { collections: CollectionConfig[] }) => resolved.collections.map(c => c.slug);

describe("CollectionRegistry.resolvePathToCollections with a slug containing slashes", () => {

    it("resolves the collection itself", () => {
        expect(registry().resolvePathToCollections("medico/v2.0.0/joints").finalCollection.slug)
            .toBe("medico/v2.0.0/joints");
    });

    it("resolves a subcollection under it", () => {
        const resolved = registry().resolvePathToCollections("medico/v2.0.0/joints/j1/movements");

        expect(resolved.finalCollection.slug).toBe("movements");
        expect(slugsOf(resolved)).toEqual(["medico/v2.0.0/joints", "movements"]);
        expect(resolved.entityIds).toEqual(["j1"]);
    });

    it("resolves a subcollection nested one level further down", () => {
        const resolved = registry().resolvePathToCollections("medico/v2.0.0/joints/j1/movements/m1/variants");

        expect(slugsOf(resolved)).toEqual(["medico/v2.0.0/joints", "movements", "variants"]);
        expect(resolved.entityIds).toEqual(["j1", "m1"]);
    });

    it("counts parity after a slug with an even number of segments", () => {
        // Four segments, and a collection path: `content/podcasts` + one pair.
        // Counting the whole path called it a record path and refused it.
        const resolved = registry().resolvePathToCollections("content/podcasts/p1/episodes");

        expect(slugsOf(resolved)).toEqual(["content/podcasts", "episodes"]);
        expect(resolved.entityIds).toEqual(["p1"]);
    });

    it("prefers the longest registered slug the path starts with", () => {
        // `content` is registered too, and `content/podcasts` also reads as
        // its record `podcasts`. The longer slug is the collection.
        expect(registry().resolvePathToCollections("content/podcasts").finalCollection.slug)
            .toBe("content/podcasts");
        expect(registry().resolvePathToCollections("content").finalCollection.slug)
            .toBe("content");
    });

    it("matches whole segments only", () => {
        // `content/podcasts` is not a prefix of `content/podcasts_archive`, so
        // the root is `content` and `podcasts_archive` one of its records.
        expect(() => registry().resolvePathToCollections("content/podcasts_archive/p1/episodes"))
            .toThrow("No subcollections found for content");
    });

    it("refuses a path that ends at a record, unless asked to resolve one", () => {
        expect(() => registry().resolvePathToCollections("medico/v2.0.0/joints/j1"))
            .toThrow("ends at the record 'j1'");

        const resolved = registry().resolvePathToCollections("medico/v2.0.0/joints/j1/movements/m1", { allowRecordPath: true });
        expect(resolved.finalCollection.slug).toBe("movements");
        expect(resolved.entityIds).toEqual(["j1", "m1"]);
    });

});
