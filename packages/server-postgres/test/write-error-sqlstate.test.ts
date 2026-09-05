import { PersistService } from "../src/services/PersistService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A write that fails keeps the SQLSTATE that says why.
 *
 * The API error handler classifies from the SQLSTATE it finds by walking the
 * cause chain: `42P01` becomes `SCHEMA_DRIFT` with "table X does not exist. Run
 * `rebase db push`", `42501` becomes `DB_PERMISSION_DENIED` naming row-level
 * security. The write path translated the driver error into a friendly message
 * and returned a bare `new Error(message)` — severing the chain — so every
 * write against a table the code expects and the database lacks answered
 * `INTERNAL_ERROR` and "An unexpected error occurred".
 *
 * Reads were classified correctly the whole time, which is exactly why the
 * asymmetry survived: the same deployment fault produced a useful message on a
 * GET and a useless one on a POST.
 */
function pgFailure(code: string, message: string): Error {
    // What the caller actually catches: drizzle's wrapper, with the pg error
    // underneath it. `Failed query:` is the marker the logger redacts.
    return new Error("Failed query: insert into \"posts\"", {
        cause: Object.assign(new Error(message), { code, table: "posts" })
    });
}

/** The private translator, reached the way its callers reach it. */
function translate(error: unknown): Error {
    const service = new PersistService({} as never, new PostgresCollectionRegistry());
    return (service as unknown as {
        toUserFriendlyError(error: unknown, slug: string): Error;
    }).toUserFriendlyError(error, "posts");
}

describe("write-path errors keep their SQLSTATE", () => {
    it("carries the pg error as the cause of a missing-table failure", () => {
        const translated = translate(pgFailure("42P01", 'relation "posts" does not exist'));

        const cause = translated.cause as { code?: string } | undefined;
        expect(cause).toBeDefined();
        // Not the message — the message is already friendly and always was.
        // What was lost is the code the handler classifies from.
        expect(findSqlState(translated)).toBe("42P01");
    });

    it("carries it for a privilege failure too", () => {
        const translated = translate(pgFailure("42501", "permission denied for table posts"));
        expect(findSqlState(translated)).toBe("42501");
    });

    it("still returns an ApiError untouched, with its own status", () => {
        // A deliberate API error already carries a status and wording; wrapping
        // one would flatten a policy rejection into a 500.
        const denial = pgFailure("42501", 'new row violates row-level security policy for table "posts"');
        const translated = translate(denial) as { statusCode?: number; code?: string };
        expect(translated.statusCode).toBe(403);
        expect(translated.code).toBe("WRITE_DENIED");
    });

    it("keeps the cause when no SQLSTATE was found at all", () => {
        // A dropped connection mid-statement carries no SQLSTATE, and the
        // reason still sits one link down.
        const dropped = new Error("Failed query: insert into \"posts\"", {
            cause: new Error("Connection terminated unexpectedly")
        });
        // The original error is attached whole, so the reason is one link
        // further down — which is where every reader of a cause chain looks.
        const chain = translate(dropped).cause as { cause?: Error } | undefined;
        expect(chain?.cause?.message).toContain("Connection terminated");
    });
});

/** The walk `api/errors.ts` performs, restated so this test asserts it. */
function findSqlState(error: unknown, depth = 0): string | undefined {
    if (!error || typeof error !== "object" || depth > 8) return undefined;
    const e = error as { code?: string; cause?: unknown };
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    return findSqlState(e.cause, depth + 1);
}
