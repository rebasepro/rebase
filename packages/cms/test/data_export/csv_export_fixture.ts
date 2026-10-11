import { Entity, EntityReference, EntityRelation, Properties } from "@rebasepro/types";

/**
 * A collection export that exercises every way a CSV cell is built: nested
 * maps, arrays that expand into one column per item (and grow as the rows go
 * on, so a streamed export meets them late), arrays of maps, to-many
 * relations, a tuple array, a value whose shape disagrees with its property,
 * an additional column that overrides a property, quoting, newlines and
 * formula triggers.
 *
 * `__fixtures__/export_golden_*.csv` are what the export wrote for these rows
 * before it streamed (b46e18c85, the in-memory `downloadEntitiesExport`). A
 * streamed export has to write the same bytes.
 */
export const fixtureProperties: Properties = {
    name: { type: "string" },
    price: { type: "number" },
    active: { type: "boolean" },
    published: { type: "date" },
    address: {
        type: "map",
        properties: {
            street: { type: "string" },
            city: { type: "string" },
            geo: { type: "map", properties: { lat: { type: "number" }, lng: { type: "number" } } }
        }
    },
    tags: { type: "array", of: { type: "string" } },
    links: { type: "array", of: { type: "map", properties: { label: { type: "string" }, url: { type: "string" } } } },
    authors: { type: "relation", relation: { target: "authors", cardinality: "many" } } as never,
    owner: { type: "reference", path: "users" } as never,
    pair: { type: "array", of: [{ type: "string" }, { type: "number" }] },
    location: { type: "geopoint" },
    notes: { type: "string" },
    meta: { type: "map" }
};

/** Out of declaration order, with a key no property has. */
export const fixturePropertiesOrder = [
    "name", "missing_prop", "tags", "address", "price", "links", "authors", "owner",
    "pair", "published", "active", "location", "notes", "meta"
];

export const fixtureAdditionalHeaders = ["computed", "name"];

const rel = (id: string) => new EntityRelation(id, "authors");

export function fixtureEntities(): Entity<Record<string, unknown>>[] {
    const rows: Record<string, unknown>[] = [
        {
            name: "Plain", price: 10, active: true, published: "2024-01-02T03:04:05.000Z",
            address: { street: "1 Main St", city: "Rome", geo: { lat: 41.9, lng: 12.5 } },
            tags: [], links: [], authors: [rel("a1")], owner: new EntityReference({ id: "u1", path: "users" }),
            pair: ["x", 1], location: { latitude: 1, longitude: 2 }, notes: "first", meta: { k: "v" },
            extra: "not a property"
        },
        {
            name: "Quote \"inside\", comma", price: -5, active: false, published: 1700000000000,
            address: { street: "Line 1\nLine 2", city: "=SUM(A1)" },
            tags: ["a"], links: [{ label: "A \"q\"", url: "https://a.example" }],
            authors: [{ __type: "relation", id: "a2" }], owner: null,
            pair: ["y"], notes: { 0: "zero", 1: "one" }, meta: { 3: "three" }
        },
        {
            name: "+1", price: 0, published: "not a date",
            tags: undefined, links: undefined, authors: [], pair: ["z", 2, "extra"],
            notes: "@handle", meta: null
        },
        {
            name: "\tTabbed", price: 3.5, active: true, published: new Date("2023-05-06T07:08:09.000Z"),
            address: { city: "Paris" }, tags: ["a", "b"],
            links: [{ label: "B", url: "u" }, { label: "C" }], authors: [rel("a3"), rel("a4")],
            owner: new EntityReference({ id: "u2", path: "users" }), notes: "-12", meta: [1, 2]
        },
        {
            id: "override-id", name: "Has id in values", tags: ["only"], notes: "CRLF\r\ninside", meta: {}
        },
        {
            name: "Additional overrides name", price: 7, tags: ["t1", "t2", "t3"],
            links: [{ label: "D", url: "d" }, { label: "E", url: "e" }, { label: "F", url: "f" }],
            authors: [rel("a5"), rel("a6"), rel("a7")], pair: [], notes: ["n1", "n2", "n3"]
        },
        {
            name: "Unicode ✓ ünïcödé", price: 1e21, active: false, address: "not a map",
            tags: "not an array", notes: "", meta: { nested: { deep: [1, { x: "y" }] } }
        },
        {
            name: "", price: null, tags: [null, undefined, "c"], links: [null], authors: null,
            notes: null
        },
        {
            name: "Late long array", tags: ["1", "2", "3", "4", "5"], notes: "plain",
            address: { street: "\"quoted street\"", geo: { lat: 0, lng: -0.5 } }
        },
        {
            name: "Literal bracket key", tags: ["x"], notes: "n"
        },
        {
            name: "Empty values"
        },
        {
            name: "Last", price: 99, active: true, tags: ["z", "y"], pair: ["last", 9],
            authors: [rel("a8")], notes: "=cmd|' /C calc'!A0", meta: { a: "b" }
        }
    ];
    return rows.map((values, i) => ({ id: "row-" + i, path: "items", values }));
}

/** One record per row, as `resolveAdditionalExportValues` returns them. */
export function fixtureAdditional(): Record<string, unknown>[] {
    return fixtureEntities().map((_, i) => {
        const record: Record<string, unknown> = { computed: i % 3 === 0 ? "c" + i : i };
        if (i === 5) record.name = "OVERRIDDEN";
        // A key spelled like an expanded array column: the cell under
        // `tags[0]` reads it, whatever the row's `tags` holds.
        if (i === 9) record["tags[0]"] = "literal";
        return record;
    });
}

/**
 * A property key with a `.` in it. Spread, `a.b[0]` reads `a` → `b` → item 0,
 * not item 0 of `a.b`, so these rows cannot be re-cut from their text.
 */
export const dottedKeyProperties: Properties = {
    "a.b": { type: "array", of: { type: "string" } },
    a: { type: "map", properties: { b: { type: "array", of: { type: "string" } } } },
    tags: { type: "array", of: { type: "string" } }
};

export function dottedKeyEntities(): Entity<Record<string, unknown>>[] {
    return [
        { "a.b": ["x"], a: { b: ["p", "q"] }, tags: ["t"] },
        { "a.b": ["y", "z"], a: { b: ["r"] }, tags: [] },
        { "a.b": "not an array", tags: ["1", "2", "3"] }
    ].map((values, i) => ({ id: "d" + i, path: "items", values }));
}
