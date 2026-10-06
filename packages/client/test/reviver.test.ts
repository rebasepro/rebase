import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { EntityReference, EntityRelation, GeoPoint, Vector } from "@rebasepro/types";
import { parseRebaseJson, rebaseReviver } from "../src/reviver";
import { createTransport } from "../src/transport";

/**
 * `parseRebaseJson` is `JSON.parse(text, rebaseReviver)` without the reviver's
 * cost on the bodies that need none.
 *
 * A reviver argument takes V8 off its fast JSON path and calls back for every
 * key and value, primitives included — 7× a plain parse on a 1,000-row page —
 * while the only values `rebaseReviver` changes are objects carrying `__type`.
 * So the answer has to be identical, instance for instance, and the slow path
 * has to be skipped when there is nothing for it to do.
 */

/** Rows the way a REST page carries them: flat columns, the odd typed value. */
function page(rows: number, typed: boolean): string {
    return JSON.stringify({
        data: Array.from({ length: rows }, (_, i) => ({
            id: i + 1,
            title: `Row ${i + 1}`,
            status: i % 3 === 0 ? "draft" : "published",
            score: i * 1.5,
            tags: ["a", "b"],
            nested: { deep: { deeper: [1, 2, { x: i }] } },
            ...(typed && {
                created: { __type: "date", value: "2026-01-02T03:04:05.000Z" },
                author: {
                    __type: "relation",
                    id: i,
                    path: "authors",
                    data: {
                        id: i,
                        path: "authors",
                        values: {
                            name: "Ada",
                            born: { __type: "Date", value: "1815-12-10T00:00:00.000Z" },
                            home: { __type: "GeoPoint", latitude: 51.5, longitude: -0.1 }
                        }
                    }
                },
                editor: { __type: "reference", id: 7, path: "users", driver: "postgres" },
                embedding: { __type: "Vector", value: [0.1, 0.2, 0.3] },
                broken: { __type: "date", value: "not a date" },
                notADate: { __type: "date", value: 42 },
                unknown: { __type: "Mystery", payload: 1 }
            })
        })),
        meta: { total: rows, hasMore: false }
    });
}

describe("parseRebaseJson", () => {
    const fixtures: Record<string, string> = {
        "a typed page": page(25, true),
        "an untyped page": page(25, false),
        "a bare typed value at the root": JSON.stringify({ __type: "date", value: "2026-01-02T00:00:00.000Z" }),
        "an array root": JSON.stringify([{ __type: "GeoPoint", latitude: 1, longitude: 2 }, 3, "x", null]),
        "primitives": "42",
        "a string root": JSON.stringify("__type"),
        "null": "null",
        "an empty object": "{}",
        "a relation with no data": JSON.stringify({ r: { __type: "relation", id: "a", path: "p" } }),
        "a __type spelled with escapes": "{\"\\u005f_type\":\"date\",\"value\":\"2026-01-02T00:00:00.000Z\"}",
        "a __proto__ key": "{\"__proto__\":{\"__type\":\"date\",\"value\":\"2026-01-02T00:00:00.000Z\"},\"a\":1}"
    };

    for (const [name, text] of Object.entries(fixtures)) {
        it(`answers exactly what the reviver does for ${name}`, () => {
            const expected = JSON.parse(text, rebaseReviver);
            const actual = parseRebaseJson(text);
            expect(actual).toStrictEqual(expected);
        });
    }

    it("builds the same instances, nested ones first", () => {
        const parsed = parseRebaseJson<{ data: Record<string, unknown>[] }>(page(1, true));
        const row = parsed.data[0];
        expect(row.created).toBeInstanceOf(Date);
        expect(row.editor).toBeInstanceOf(EntityReference);
        expect(row.embedding).toBeInstanceOf(Vector);
        expect(row.broken).toBeNull();
        expect(row.notADate).toEqual({ __type: "date", value: 42 });
        expect(row.unknown).toEqual({ __type: "Mystery", payload: 1 });
        expect(row.author).toBeInstanceOf(EntityRelation);
        // The relation's own `data` was revived before the relation was built
        // from it, as JSON.parse's bottom-up reviver does.
        const values = (row.author as EntityRelation).data?.values as Record<string, unknown>;
        expect(values.born).toBeInstanceOf(Date);
        expect(values.home).toBeInstanceOf(GeoPoint);
    });

    it("does not write through a __proto__ key", () => {
        const parsed = parseRebaseJson<Record<string, unknown>>(fixtures["a __proto__ key"]);
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
        expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
    });
});

describe("the transport parses with the fast path", () => {
    let parse: jest.SpiedFunction<typeof JSON.parse>;
    beforeEach(() => {
        jest.spyOn(console, "warn").mockImplementation(() => undefined);
        parse = jest.spyOn(JSON, "parse");
    });
    afterEach(() => { jest.restoreAllMocks(); });

    function transportServing(body: string) {
        const fetchFn = jest.fn(async () => ({
            ok: true,
            status: 200,
            statusText: "OK",
            headers: new Headers({ "content-type": "application/json" }),
            text: async () => body
        } as unknown as Response));
        return createTransport({ baseUrl: "http://api.test", fetch: fetchFn as unknown as typeof fetch });
    }

    it("never hands JSON.parse a reviver for a page with no typed values", async () => {
        const transport = transportServing(page(1_000, false));
        const res = await transport.request<{ data: unknown[] }>("/data/posts", { method: "GET" });

        expect(res.data).toHaveLength(1_000);
        const calls = parse.mock.calls.filter(([text]) => typeof text === "string" && text.length > 1_000);
        expect(calls).toHaveLength(1);
        // One argument: V8's fast path, not a callback per key and value.
        expect(calls[0][1]).toBeUndefined();
    });

    it("still revives a page that carries typed values", async () => {
        const transport = transportServing(page(3, true));
        const res = await transport.request<{ data: Record<string, unknown>[] }>("/data/posts", { method: "GET" });

        expect(res.data[0].created).toBeInstanceOf(Date);
        expect(res.data[0].author).toBeInstanceOf(EntityRelation);
        const calls = parse.mock.calls.filter(([text]) => typeof text === "string" && text.length > 100);
        expect(calls.every(([, reviver]) => reviver === undefined)).toBe(true);
    });
});
