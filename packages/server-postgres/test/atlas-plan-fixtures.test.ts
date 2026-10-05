/**
 * The push gate, read against what Atlas actually prints.
 *
 * Every file under `fixtures/atlas-dry-run/` is the verbatim output of
 * `atlas schema apply --dry-run` (the pinned binary, v1.2.3) against a real
 * PostgreSQL 18 — captured, not written. That is the point of this file. The
 * unit tests beside it once fed the detector a plan somebody typed, with no
 * `Planning migration statements (N in total):` heading above the first
 * statement; the real heading carries no `;` and does not start with `--`, so
 * it was glued onto the first statement and the anchored `ALTER TABLE` parse
 * read nothing. Every narrowing type change went through `db push` without a
 * prompt while 55 tests passed.
 *
 * To add a shape: run the pinned Atlas against a scratch database, redirect
 * stdout to a new `vX.Y.Z-<what>.txt`, and add its expectations here. Never
 * edit a fixture by hand — a hand-edited fixture is the fiction this file
 * exists to replace.
 */
import fs from "fs";
import path from "path";
import {
    detectDestructiveStatements,
    extractPlanStatements,
    type ExistingColumnType
} from "../src/schema/destructive-sql";
import { findGeneratedColumnConflicts, parseColumnMutations } from "../src/schema/generated-column-conflicts";

const FIXTURES = path.join(__dirname, "fixtures", "atlas-dry-run");
const fixture = (name: string): string => fs.readFileSync(path.join(FIXTURES, name), "utf-8");

/** What the capture database held before each plan — `format_type` spellings. */
const PEOPLE: ExistingColumnType[] = [
    ["id", "uuid"],
    ["name", "text"],
    ["bio", "text"],
    ["nickname", "text"],
    ["rating", "numeric(5,2)"],
    ["big", "bigint"],
    ["status", "people_status"],
    ["aliases", "text[]"],
    ["meta", "jsonb"],
    ["legacy", "text"]
].map(([column, type]) => ({ schema: "public", table: "people", column, type }));

describe("every captured Atlas plan", () => {
    const files = fs.readdirSync(FIXTURES).filter(name => name.endsWith(".txt"));

    it("is there to read", () => {
        expect(files.length).toBeGreaterThanOrEqual(7);
    });

    it.each(files)("%s: reads exactly as many statements as Atlas says it planned", (name) => {
        const plan = fixture(name);
        const announced = /^Planning migration statements \((\d+) in total\):/m.exec(plan);
        const expected = announced ? Number(announced[1]) : 0;
        expect(extractPlanStatements(plan)).toHaveLength(expected);
    });

    it.each(files)("%s: no statement carries Atlas's rendering", (name) => {
        for (const statement of extractPlanStatements(fixture(name))) {
            expect(statement).not.toMatch(/^\s*->/m);
            expect(statement).not.toMatch(/Planning migration statements|Running dry-run|Analyzing planned/);
            expect(statement).not.toMatch(/^\s*--/m);
            expect(statement.endsWith(";")).toBe(false);
        }
    });
});

describe("the destructive gate on a real plan", () => {
    it("flags every narrowing in a single-statement modify — the plan that went through unprompted", () => {
        const found = detectDestructiveStatements(fixture("v1.2.3-modify-narrowing.txt"), PEOPLE);
        expect(found).toHaveLength(1);
        expect(found[0].kind).toBe("ALTER COLUMN TYPE");
        expect(found[0].detail).toBe([
            "\"nickname\" text → character varying(3)",
            "\"rating\" numeric(5,2) → numeric(4,1)",
            "\"big\" bigint → integer",
            "\"aliases\" text[] → text",
            "\"meta\" jsonb → text"
        ].join("; "));
    });

    it("counts each destructive statement once, though Atlas prints it twice", () => {
        // The plan, then the same statements again under "Running dry-run
        // migration". Read both and a two-statement plan reads as four.
        const found = detectDestructiveStatements(fixture("v1.2.3-mixed.txt"), PEOPLE);
        expect(found.map(d => d.kind)).toEqual(["DROP COLUMN", "DROP TABLE"]);
        expect(found[1].statement).toBe("DROP TABLE \"public\".\"old_stuff\"");
    });

    it("flags an enum retyped to text and the type dropped after it", () => {
        const found = detectDestructiveStatements(fixture("v1.2.3-drop-enum-type.txt"), PEOPLE);
        expect(found.map(d => d.kind)).toEqual(["ALTER COLUMN TYPE", "DROP TYPE"]);
        expect(found[0].detail).toBe("\"status\" people_status → text");
    });

    it("passes a plan that only creates", () => {
        expect(detectDestructiveStatements(fixture("v1.2.3-create.txt"), [])).toEqual([]);
        expect(detectDestructiveStatements(fixture("v1.2.3-semicolon-in-literal.txt"), PEOPLE)).toEqual([]);
    });

    it("passes a database that is already in sync", () => {
        expect(detectDestructiveStatements(fixture("v1.2.3-synced.txt"), PEOPLE)).toEqual([]);
    });

    it("keeps a semicolon inside a literal in its statement", () => {
        const [statement] = extractPlanStatements(fixture("v1.2.3-semicolon-in-literal.txt"));
        expect(statement).toContain("DEFAULT 'a;b -> c'");
        expect(statement).toContain("ARRAY['x;'::text, 'y'::text]");
        expect(statement.trimEnd().endsWith(")")).toBe(true);
    });
});

/**
 * `translations` as each pk capture's database held it: keyed on `id`, with
 * `locale` an ordinary column (absent in the add-column capture, where the
 * key change brings it).
 */
const TRANSLATIONS: ExistingColumnType[] = [
    ["id", "integer"],
    ["locale", "text"],
    ["title", "text"]
].map(([column, type]) => ({ schema: "public", table: "translations", column, type }));

/**
 * A primary key is a row's address: Rebase reads, links and routes every row
 * by it. Changing which columns it covers changes every row's id at once, so
 * each record's URL, every foreign key into the table and any id stored
 * outside it stop finding the row. Atlas plans that as one routine-looking
 * `ALTER TABLE` naming no DROP of data, and `db push` applied it unprompted.
 */
describe("a primary key change on a real plan", () => {
    it.each([
        ["v1.2.3-pk-widen.txt", "(\"id\", \"locale\")"],
        ["v1.2.3-pk-add-column.txt", "(\"id\", \"locale\")"],
        ["v1.2.3-pk-narrow.txt", "(\"id\")"],
        ["v1.2.3-pk-move.txt", "(\"locale\")"]
    ])("%s: is destructive, and says every row's id changes", (name, key) => {
        const found = detectDestructiveStatements(fixture(name), TRANSLATIONS);
        expect(found).toHaveLength(1);
        expect(found[0].kind).toBe("PRIMARY KEY CHANGE");
        expect(found[0].detail).toBe(
            `"public"."translations" is re-keyed on ${key}: every row's id changes, so anything that ` +
            "refers to a row by its id — a URL, a foreign key, an id stored elsewhere — stops finding it"
        );
    });

    it("flags a key added to a table that had none", () => {
        const found = detectDestructiveStatements(fixture("v1.2.3-pk-keyless.txt"), TRANSLATIONS);
        expect(found).toHaveLength(1);
        expect(found[0].kind).toBe("PRIMARY KEY CHANGE");
        expect(found[0].detail).toBe(
            "\"public\".\"translations\" gets the primary key (\"id\"): rows are addressed by it from now on, " +
            "and the push fails if two rows share a value"
        );
    });

    it("does not take a foreign key rebuilt in place for a key change", () => {
        expect(detectDestructiveStatements(fixture("v1.2.3-fk-on-delete.txt"), TRANSLATIONS)).toEqual([]);
    });

    it("does not flag the PRIMARY KEY a new table declares", () => {
        expect(detectDestructiveStatements(fixture("v1.2.3-create.txt"), [])).toEqual([]);
        expect(detectDestructiveStatements(fixture("v1.2.3-mixed.txt"), PEOPLE).map(d => d.kind))
            .toEqual(["DROP COLUMN", "DROP TABLE"]);
    });
});

describe("the generated-column rebuild on a real plan", () => {
    it("sees the retyped column a search vector reads", () => {
        const mutations = parseColumnMutations(fixture("v1.2.3-modify-searched-column.txt"));
        expect(mutations).toEqual([{ schema: "public", table: "people", column: "nickname", kind: "type" }]);
        const conflicts = findGeneratedColumnConflicts(mutations, [
            { schema: "public", table: "people", column: "search_vector", dependsOn: "nickname" }
        ]);
        expect(conflicts.map(c => `${c.table}.${c.column}`)).toEqual(["people.search_vector"]);
    });

    it("reads each mutation once, though Atlas prints the statement twice", () => {
        const mutations = parseColumnMutations(fixture("v1.2.3-mixed.txt"));
        expect(mutations).toEqual([
            { schema: "public", table: "people", column: "rating", kind: "type" },
            { schema: "public", table: "people", column: "legacy", kind: "drop" }
        ]);
    });
});
