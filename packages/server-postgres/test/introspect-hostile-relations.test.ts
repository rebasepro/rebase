/**
 * The two places a table name from `pg_class` leaves the generator.
 *
 * Its sibling, `introspect-hostile-identifiers.test.ts`, covers what a hostile
 * name does to the TypeScript that gets WRITTEN. These cover the two places the
 * same name is used as something other than text:
 *
 *  - interpolated back into SQL, where a double quote closes the identifier and
 *    then the statement — and introspection runs with the privileges of
 *    whoever ran it, which for a database being adopted is usually a superuser;
 *  - joined onto a path, where `../` escapes the collections directory and the
 *    generator writes a `.ts` file wherever it points.
 *
 * "The catalogue is trusted" holds for your own database and is exactly the
 * assumption this tool cannot make: being pointed at a database somebody else
 * built is the whole purpose of `rebase init --introspect`.
 */
import { isUsableFileName, quoteIdentifier, quoteRelation } from "../src/schema/introspect-db-queries";

describe("quoting an identifier read from the catalogue", () => {
    it("wraps an ordinary name", () => {
        expect(quoteIdentifier("orders")).toBe('"orders"');
        expect(quoteRelation("public", "orders")).toBe('"public"."orders"');
    });

    /** Postgres's own escape: a quote inside a quoted identifier is doubled. */
    it("doubles an embedded quote rather than letting it close the identifier", () => {
        expect(quoteIdentifier('x" ; DROP TABLE users; --'))
            .toBe('"x"" ; DROP TABLE users; --"');
    });

    it("leaves no unbalanced quote for any of the shapes that end a statement", () => {
        const hostile = [
            'x"; DROP TABLE users; --',
            'x" UNION SELECT * FROM rebase.users --',
            '"',
            '""',
            'a"b"c'
        ];

        for (const name of hostile) {
            const quoted = quoteIdentifier(name);
            // Strip the outer pair, then every doubled quote. Nothing may remain.
            const inner = quoted.slice(1, -1).replace(/""/g, "");
            expect(inner).not.toContain('"');
        }
    });

    it("quotes both halves of a relation", () => {
        expect(quoteRelation('s"1', 't"2')).toBe('"s""1"."t""2"');
    });
});

describe("whether a table name may become a filename", () => {
    it.each([
        ["orders"],
        ["order_items"],
        ["Payment2024"],
        ["a"]
    ])("accepts %s", (name) => {
        expect(isUsableFileName(name)).toBe(true);
    });

    /**
     * The generator writes `<collectionsDir>/<tableName>.ts`, and `path.join`
     * resolves `..` — so without this the file lands wherever the name points,
     * written by whoever ran the command.
     */
    it.each([
        ["a parent traversal", "../../../etc/cron.d/x"],
        ["a bare traversal", ".."],
        ["a current-directory reference", "."],
        ["an absolute path", "/etc/passwd"],
        ["a nested path", "a/b"],
        ["a Windows path", "a\\b"],
        ["a Windows drive", "C:evil"],
        ["a hidden file", ".bashrc"],
        ["a trailing dot", "orders."],
        ["nothing at all", ""]
    ])("refuses %s", (_label, name) => {
        expect(isUsableFileName(name)).toBe(false);
    });

    it("refuses a name carrying a NUL, which truncates a path at the OS boundary", () => {
        expect(isUsableFileName("orders\u0000.png")).toBe(false);
    });

    it("refuses a name long enough to break a filesystem", () => {
        expect(isUsableFileName("a".repeat(500))).toBe(false);
    });
});
