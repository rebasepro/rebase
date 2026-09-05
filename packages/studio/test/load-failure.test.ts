import { classifyLoadFailure } from "../src/components/load-failure";

/**
 * A refusal is not a fault. Reproduced from a live customer project: its
 * `storageAuthorize` hook denies an unscoped root listing by design, the Files
 * tab always opens at the root, and the console rendered "Error loading storage
 * — Not authorized for this object" over a project with nothing wrong with it.
 */
describe("classifyLoadFailure", () => {
    it("reads a 403 as the project's own policy, not a platform failure", () => {
        const err = Object.assign(new Error("Not authorized for this object"), { status: 403 });
        const f = classifyLoadFailure(err);
        expect(f.kind).toBe("denied");
        expect(f.retryable).toBe(false);
    });

    it("classifies the message even when the SDK dropped the status", () => {
        // This is how it actually arrived: a bare Error with the server's text
        // and no status anywhere on it.
        expect(classifyLoadFailure(new Error("Not authorized for this object")).kind).toBe("denied");
        expect(classifyLoadFailure(new Error("Forbidden")).kind).toBe("denied");
    });

    it("treats a 401 the same way — it is the same conversation", () => {
        expect(classifyLoadFailure(Object.assign(new Error("no"), { status: 401 })).kind).toBe("denied");
    });

    it("still reports a real failure as a real failure", () => {
        const f = classifyLoadFailure(new Error("network request failed"));
        expect(f.kind).toBe("unavailable");
        expect(f.retryable).toBe(true);
    });

    it("does not read a 500 as a refusal", () => {
        const f = classifyLoadFailure(Object.assign(new Error("boom"), { status: 500 }));
        expect(f.kind).toBe("unavailable");
    });

    it("never re-words the server", () => {
        // The console and the CLI must not say different things about one refusal.
        expect(classifyLoadFailure(new Error("Not authorized for this object")).detail)
            .toBe("Not authorized for this object");
    });

    it("survives something that is not an Error at all", () => {
        expect(classifyLoadFailure("nope").kind).toBe("unavailable");
        expect(classifyLoadFailure(null).kind).toBe("unavailable");
    });
});
