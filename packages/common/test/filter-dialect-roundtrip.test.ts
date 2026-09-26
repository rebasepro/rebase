import { deserializeFilter, serializeFilter } from "../src/data/filter-dialect";

/**
 * What the REST filter codec does to values it cannot represent.
 *
 * Everything here is reachable from the typed SDK over HTTP, and every case was
 * silently wrong rather than an error — the query ran, and returned the wrong
 * rows.
 */
describe("filter dialect round trip", () => {
    const roundTrip = (filter: unknown) =>
        deserializeFilter(serializeFilter(filter as never) as never);

    /**
     * `.where("deleted_at", "==", null)` is type-legal and the Postgres
     * compiler implements it as IS NULL. It serialized as `eq.null`, which is
     * indistinguishable from a search for the four-character string, so it came
     * back as `["==", "null"]` and compiled to `deleted_at = 'null'`. Only the
     * wire trip broke it.
     */
    it("carries a null comparison as a null test, not the string \"null\"", () => {
        expect(roundTrip({ deleted_at: ["==", null] })).toEqual({ deleted_at: ["is-null", null] });
        expect(roundTrip({ deleted_at: ["!=", null] })).toEqual({ deleted_at: ["is-not-null", null] });
    });

    it("still carries the literal string \"null\" as a string", () => {
        // The other half: making null unambiguous must not swallow the string.
        expect(roundTrip({ name: ["==", "null"] })).toEqual({ name: ["==", "null"] });
    });

    /**
     * `.where("id", "in", [])` matches nothing. It came back as `[""]` — a
     * search for the empty string — which on a uuid column is a 500 and on a
     * text column is silently the wrong rows.
     */
    it("keeps an empty list empty", () => {
        expect(roundTrip({ id: ["in", []] })).toEqual({ id: ["in", []] });
        expect(roundTrip({ id: ["not-in", []] })).toEqual({ id: ["not-in", []] });
    });

    it("keeps [] and [\"\"] distinct", () => {
        // A comma-joined format has no way to write "zero items", so the empty
        // list gets a token of its own: a lone backslash, which no real value
        // can produce because escaping doubles every backslash. Both readings
        // stay exact rather than one being traded for the other.
        expect(roundTrip({ tag: ["in", [""]] })).toEqual({ tag: ["in", [""]] });
        expect(roundTrip({ tag: ["in", []] })).toEqual({ tag: ["in", []] });
        expect(roundTrip({ tag: ["in", ["\\"]] })).toEqual({ tag: ["in", ["\\"]] });
    });

    /**
     * The operator prefix comes off the wire and was used to index a plain
     * object, so every `Object.prototype` key answered — `?f=valueOf.x` yielded
     * the inherited *function* as the operator, past a guard that reads as
     * though it rejects anything unknown.
     */
    it.each(["valueOf", "toString", "constructor", "hasOwnProperty", "__proto__"])(
        "treats the inherited key %p as a value, not an operator",
        name => {
            const parsed = deserializeFilter({ f: `${name}.x` }) as Record<string, [string, unknown]>;
            expect(parsed.f[0]).toBe("==");
            expect(parsed.f[1]).toBe(`${name}.x`);
        }
    );

    it("still resolves the real operators", () => {
        // The control: a codec that treated everything as a value would pass
        // the case above.
        expect(deserializeFilter({ age: "gte.18" })).toEqual({ age: [">=", "18"] });
        expect(deserializeFilter({ s: "eq.active" })).toEqual({ s: ["==", "active"] });
    });
});

/**
 * A query parameter's scalar operand is sent raw, and the decoder read any
 * parenthesised operand as a list — for every operator. So
 * `["==", "(deleted)"]` reached the server as `["==", ["deleted"]]`, which
 * matches nothing, and `["!=", "(deleted)"]` returned the very rows it was
 * written to exclude. Placeholders like `(none)` and `(untitled)` are ordinary
 * values, and the same filter inside an `or(...)` group, or over the socket,
 * was right.
 */
describe("a parenthesised scalar in a query parameter", () => {
    const roundTrip = (filter: unknown) =>
        deserializeFilter(serializeFilter(filter as never) as never);

    const scalarOps = ["==", "!=", ">", ">=", "<", "<=", "array-contains", "like", "ilike", "not-like", "not-ilike"];
    const values = ["(deleted)", "(a,b)", "()", "(\\)", "(a\\,b)", "\\(a\\)", "\\\\\\(a\\\\\\)", "((x))"];

    it.each(scalarOps)("comes back as the same string for %p", (op) => {
        for (const value of values) {
            expect(roundTrip({ status: [op, value] })).toEqual({ status: [op, value] });
        }
    });

    it("still sends the scalars that were never ambiguous raw", () => {
        expect(serializeFilter({ status: ["==", "active"] })).toEqual({ status: "eq.active" });
        expect(serializeFilter({ path: ["==", "\\\\server\\share"] })).toEqual({ path: "eq.\\\\server\\share" });
        expect(serializeFilter({ name: ["like", "(draft%"] })).toEqual({ name: "like.(draft%" });
    });

    it("keeps reading the old wire forms as it did", () => {
        // Clients in the field send these, and each has one meaning.
        expect(deserializeFilter({ tags: "eq.(a,b)" })).toEqual({ tags: ["==", ["a", "b"]] });
        expect(deserializeFilter({ path: "eq.\\\\server\\share" })).toEqual({ path: ["==", "\\\\server\\share"] });
        expect(deserializeFilter({ note: "eq.a\\,b" })).toEqual({ note: ["==", "a\\,b"] });
        expect(deserializeFilter({ role: "in.(admin,editor)" })).toEqual({ role: ["in", ["admin", "editor"]] });
    });

    it("keeps an array value a list, so array equality still works", () => {
        expect(roundTrip({ tags: ["==", ["a", "b"]] })).toEqual({ tags: ["==", ["a", "b"]] });
        expect(roundTrip({ tags: ["array-contains", ["a"]] })).toEqual({ tags: ["array-contains", ["a"]] });
    });
});
