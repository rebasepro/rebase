import { RebaseApiError } from "@rebasepro/types";
import { CALLBACK_REJECTED, toCallbackError } from "./callback-errors";

/**
 * The behaviour under test is the one both `docs/collections/callbacks.md` and
 * `docs/backend/hooks.md` promised and neither delivered: a `before*` callback
 * that throws blocks the write with a **400 carrying the author's message**,
 * rather than a 500 whose body the normalizer masks to "Internal Server Error".
 */
describe("toCallbackError", () => {
    it("turns a plain Error into a 400 that keeps the author's message", () => {
        const out = toCallbackError(new Error("Price cannot be negative"), "beforeSave", "products");
        expect(out).toBeInstanceOf(RebaseApiError);
        const err = out as RebaseApiError;
        expect(err.status).toBe(400);
        expect(err.code).toBe(CALLBACK_REJECTED);
        expect(err.message).toBe("Price cannot be negative");
        expect(err.details).toEqual({ stage: "beforeSave", path: "products" });
    });

    it("keeps the original as `cause`, so the log still has the stack", () => {
        const thrown = new Error("nope");
        const err = toCallbackError(thrown, "beforeDelete", "orders") as RebaseApiError;
        expect((err as { cause?: unknown }).cause).toBe(thrown);
    });

    it("passes through a RebaseApiError, which is how a callback picks its own status", () => {
        // The class a `config/collections/*.ts` file can import: that file is
        // bundled into the admin SPA, so the server's `ApiError` is unreachable
        // from it and this is the only typed option an author has.
        const thrown = new RebaseApiError("That title is taken", { status: 409, code: "TITLE_TAKEN" });
        expect(toCallbackError(thrown, "beforeSave", "posts")).toBe(thrown);
    });

    it("passes through the server's ApiError shape, matched structurally", () => {
        // Structural, not `instanceof`: a monorepo can resolve two copies of a
        // package and `instanceof` is false across them.
        const apiError = Object.assign(new Error("forbidden"), { statusCode: 403, code: "FORBIDDEN" });
        expect(toCallbackError(apiError, "beforeSave", "posts")).toBe(apiError);
    });

    it("handles a thrown string, and a thrown non-error", () => {
        expect((toCallbackError("just a string", "beforeSave", "p") as RebaseApiError).message)
            .toBe("just a string");
        expect((toCallbackError({ weird: true }, "beforeSave", "p") as RebaseApiError).message)
            .toBe("beforeSave rejected the write");
    });

    it("does not mistake a null throw for an object carrying a status", () => {
        const err = toCallbackError(null, "beforeSave", "p") as RebaseApiError;
        expect(err.status).toBe(400);
    });
});
