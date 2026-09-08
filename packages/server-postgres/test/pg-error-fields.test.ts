import { CollectionConfig } from "@rebasepro/types";
import { pgErrorToFriendlyMessage, pgFieldViolations, sanitizeErrorForClient, type PostgresError } from "../src/utils/pg-error-utils";

/**
 * A database refusal names a physical column. A caller only ever sees wire
 * names. Nothing translated between the two, so a `23502` on `author_id` told
 * an API consumer about a key their generated client has never mentioned, and a
 * `22P02` from an enum told them `Invalid data format in "posts".` — no field at
 * all, on the most common data error there is.
 */
describe("pg errors name the field, not the column", () => {
    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" },
            authorId: { type: "number" },
            status: { type: "string", enum: { draft: "Draft", published: "Published" } },
            contactEmail: { type: "string", columnName: "email" }
        }
    };

    const err = (parts: Partial<PostgresError> & { code: string }): PostgresError =>
        Object.assign(new Error(parts.message ?? "boom"), parts) as PostgresError;

    describe("23502 not_null_violation", () => {
        it("derives the wire name from the column Postgres named", () => {
            expect(pgFieldViolations(err({ code: "23502", column: "author_id" }), posts))
                .toEqual([{ field: "authorId", code: "23502" }]);
        });

        it("prefers an explicit columnName mapping over snake_case", () => {
            expect(pgFieldViolations(err({ code: "23502", column: "email" }), posts))
                .toEqual([{ field: "contactEmail", code: "23502" }]);
        });

        it("puts the field in the message too", () => {
            const { message } = pgErrorToFriendlyMessage(
                err({ code: "23502", column: "author_id", table: "posts" }),
                "posts",
                { collection: posts }
            );
            expect(message).toContain("authorId");
            expect(message).not.toContain("author_id");
        });

        it("falls back to the column when the collection is unknown", () => {
            const { message, violations } = pgErrorToFriendlyMessage(
                err({ code: "23502", column: "author_id", table: "posts" }),
                "posts"
            );
            expect(message).toContain("author_id");
            // No collection means no mapping, and inventing one would mark the
            // wrong input red. An empty list is the honest answer.
            expect(violations).toEqual([]);
        });
    });

    describe("23505 unique_violation", () => {
        it("reads the column list out of the detail, never the values", () => {
            const violations = pgFieldViolations(
                err({ code: "23505", detail: "Key (email)=(ada@example.com) already exists." }),
                posts
            );
            expect(violations).toEqual([{ field: "contactEmail", code: "23505" }]);
        });

        it("handles a composite key", () => {
            const violations = pgFieldViolations(
                err({ code: "23505", detail: "Key (title, author_id)=(Hi, 9) already exists." }),
                posts
            );
            expect(violations).toEqual([
                { field: "title", code: "23505" },
                { field: "authorId", code: "23505" }
            ]);
        });

        it("falls back to the constraint name when the detail is withheld", () => {
            expect(pgFieldViolations(err({ code: "23505", constraint: "posts_title_key" }), posts))
                .toEqual([{ field: "title", code: "23505" }]);
        });

        it("says nothing for a constraint name that is not a column", () => {
            // A hand-written constraint name is not a column list, and guessing
            // would put a field in the response that does not exist.
            expect(pgFieldViolations(err({ code: "23505", constraint: "one_draft_per_author" }), posts))
                .toEqual([]);
        });

        it("keeps the value out of the production message while still naming the field", () => {
            const { message, violations } = pgErrorToFriendlyMessage(
                err({
                    code: "23505",
                    detail: "Key (email)=(ada@example.com) already exists.",
                    constraint: "posts_email_key",
                    table: "posts"
                }),
                "posts",
                { verbose: false, collection: posts }
            );
            // The sharp one: this detail answers "is this person registered?"
            // for any address on a table RLS is otherwise hiding.
            expect(message).not.toContain("ada@example.com");
            expect(violations).toEqual([{ field: "contactEmail", code: "23505" }]);
        });
    });

    describe("22P02 invalid_text_representation", () => {
        it("decodes the enum type name, which is <table>_<column>", () => {
            const violations = pgFieldViolations(
                err({ code: "22P02", message: 'invalid input value for enum posts_status: "archived"' }),
                posts
            );
            expect(violations).toEqual([{ field: "status", code: "22P02" }]);
        });

        it("decodes a schema-qualified enum type", () => {
            const violations = pgFieldViolations(
                err({ code: "22P02", message: 'invalid input value for enum public.posts_status: "archived"' }),
                posts
            );
            expect(violations).toEqual([{ field: "status", code: "22P02" }]);
        });

        it("says nothing for a bad uuid literal, which names no column", () => {
            expect(pgFieldViolations(
                err({ code: "22P02", message: 'invalid input syntax for type uuid: "abc"' }),
                posts
            )).toEqual([]);
        });

        it("does not echo the value in the production message", () => {
            const { message } = pgErrorToFriendlyMessage(
                err({ code: "22P02", message: 'invalid input value for enum posts_status: "archived"' }),
                "posts",
                { verbose: false, collection: posts }
            );
            expect(message).not.toContain("archived");
        });
    });

    describe("23503 foreign_key_violation", () => {
        it("names the local column, not the value it pointed at", () => {
            const violations = pgFieldViolations(
                err({
                    code: "23503",
                    detail: 'Key (author_id)=(9) is not present in table "authors".',
                    constraint: "posts_author_id_fkey"
                }),
                posts
            );
            expect(violations).toEqual([{ field: "authorId", code: "23503" }]);
        });
    });

    describe("what stays out", () => {
        it("says nothing for a failure that is the deployment's, not the caller's", () => {
            // A missing table or a privilege problem has no field to fix, and
            // naming one would send the reader to the wrong place.
            expect(pgFieldViolations(err({ code: "42P01", table: "posts" }), posts)).toEqual([]);
            expect(pgFieldViolations(err({ code: "42501", table: "posts" }), posts)).toEqual([]);
            expect(pgFieldViolations(err({ code: "23514", constraint: "posts_title_check" }), posts)).toEqual([]);
        });
    });

    describe("sanitizeErrorForClient", () => {
        it("carries the violations through when a collection is given", () => {
            jest.spyOn(console, "error").mockImplementation(() => {});
            const wrapped = new Error("Failed query: insert into posts", {
                cause: err({ code: "23502", column: "author_id", table: "posts" })
            });
            const result = sanitizeErrorForClient(wrapped, "posts", { collection: posts });
            expect(result.violations).toEqual([{ field: "authorId", code: "23502" }]);
            jest.restoreAllMocks();
        });

        it("omits the key entirely when there is nothing to say", () => {
            jest.spyOn(console, "error").mockImplementation(() => {});
            const wrapped = new Error("Failed query", { cause: err({ code: "42P01", table: "posts" }) });
            expect("violations" in sanitizeErrorForClient(wrapped, "posts", { collection: posts })).toBe(false);
            jest.restoreAllMocks();
        });
    });
});
