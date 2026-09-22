/**
 * What an edit of a stored record sends.
 *
 * An update replaces each top-level property it carries: the value sent *is*
 * the column's new value. So a property that changed has to travel whole — a
 * map sent as the one key that changed erases its other keys, and a geopoint
 * sent as one coordinate is refused. And a `Date` is an object with no keys of
 * its own: a diff that walked into it found nothing to report, and the edit
 * was dropped from the save without a word.
 */
import { EntityRelation } from "@rebasepro/types";
import { getChangedProperties, getChanges, getEditHandoffValues } from "../../src/form/form_utils";

const january = new Date("2026-01-01T10:00:00Z");
const february = new Date("2026-02-01T10:00:00Z");

type Post = {
    title: string;
    publishedAt: Date | null;
    address: { street?: string; city?: string; openedAt?: Date };
    meta: Record<string, unknown>;
    location: { latitude: number; longitude: number };
    author: EntityRelation | null;
};

const stored: Post = {
    title: "Hello",
    publishedAt: january,
    address: { street: "Main 1", city: "Rome" },
    meta: { a: 1, b: 2 },
    location: { latitude: 1, longitude: 2 },
    author: new EntityRelation(1, "authors", { name: "Ada" })
};

describe("getChangedProperties", () => {

    it("sends an edited date", () => {
        const changes = getChangedProperties<Post>({ ...stored, publishedAt: february }, stored);
        expect(Object.keys(changes)).toEqual(["publishedAt"]);
        expect(changes.publishedAt).toBeInstanceOf(Date);
        expect(changes.publishedAt?.getTime()).toEqual(february.getTime());
    });

    it("sends a cleared date", () => {
        expect(getChangedProperties<Post>({ ...stored, publishedAt: null }, stored))
            .toEqual({ publishedAt: null });
    });

    it("sends nothing for a date that is the same instant in another instance", () => {
        expect(getChangedProperties<Post>({ ...stored, publishedAt: new Date(january.getTime()) }, stored))
            .toEqual({});
    });

    it("sends a map whole when one of its keys changed", () => {
        const changes = getChangedProperties<Post>({
            ...stored,
            address: { street: "Main 1", city: "Milan" }
        }, stored);
        expect(changes).toEqual({ address: { street: "Main 1", city: "Milan" } });
    });

    it("sends a map whole when a date inside it changed", () => {
        const withDate: Post = { ...stored, address: { ...stored.address, openedAt: january } };
        const changes = getChangedProperties<Post>({
            ...withDate,
            address: { ...withDate.address, openedAt: february }
        }, withDate);
        expect(Object.keys(changes)).toEqual(["address"]);
        expect(changes.address?.street).toEqual("Main 1");
        expect(changes.address?.openedAt?.getTime()).toEqual(february.getTime());
    });

    it("sends a key-value map whole when one key was removed", () => {
        // The key-value field removes a key by setting it to `undefined`,
        // which JSON leaves out. Sent alone, that was `{"meta":{}}`.
        const changes = getChangedProperties<Post>({ ...stored, meta: { a: 1, b: undefined } }, stored);
        expect(JSON.stringify(changes)).toEqual("{\"meta\":{\"a\":1}}");
    });

    it("sends a geopoint with both coordinates when one moved", () => {
        const changes = getChangedProperties<Post>({
            ...stored,
            location: { latitude: 5, longitude: 2 }
        }, stored);
        expect(changes).toEqual({ location: { latitude: 5, longitude: 2 } });
    });

    it("sends a changed relation as the relation", () => {
        const author = new EntityRelation(2, "authors");
        const changes = getChangedProperties<Post>({ ...stored, author }, stored);
        expect(changes.author).toBe(author);
    });

    it("sends nothing when nothing changed", () => {
        expect(getChangedProperties<Post>({ ...stored, address: { ...stored.address } }, stored)).toEqual({});
    });

});

describe("getChanges", () => {

    it("reports an edited date instead of walking into it", () => {
        const changes = getChanges<Post>({ ...stored, publishedAt: february }, stored);
        expect(changes.publishedAt).toBeInstanceOf(Date);
        expect(changes.publishedAt?.getTime()).toEqual(february.getTime());
    });

    it("reports a class instance whole", () => {
        const author = new EntityRelation(2, "authors");
        expect(getChanges<Post>({ ...stored, author }, stored).author).toBe(author);
    });

    it("still diffs a plain object key by key", () => {
        // The local-changes backup is a subset of the record, and it is
        // measured against the form key by key.
        expect(getChanges<Post>({ ...stored, address: { street: "Main 1", city: "Milan" } }, stored))
            .toEqual({ address: { city: "Milan" } });
    });

    it("carries a date set without touching the field across a layout change", () => {
        const carried = getEditHandoffValues<Post>({
            status: "existing",
            dirty: true,
            values: { ...stored, publishedAt: february },
            touched: {},
            storedValues: stored
        });
        expect(carried?.publishedAt).toBeInstanceOf(Date);
        expect(carried?.publishedAt?.getTime()).toEqual(february.getTime());
    });

});
