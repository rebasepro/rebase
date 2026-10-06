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

    it("does not read a 401 as a refusal: the session ended, the caller still holds their scopes", () => {
        // A 401 is "who are you" — a revoked or expired session — not "your
        // role may not". Read as denied, the API keys pane told an administrator
        // they lack keys:read, and hid Retry.
        const f = classifyLoadFailure(Object.assign(new Error("Invalid or expired token"), { status: 401 }));
        expect(f.kind).toBe("unavailable");
        expect(f.retryable).toBe(true);
        expect(f.detail).toBe("Invalid or expired token");
    });

    it("does not read a server fault as a refusal because its message says 'permission denied'", () => {
        // The server's answer to a missing GRANT (`DB_PERMISSION_DENIED`, a 500).
        // It is the platform's fault, and the pane must not blame the caller's
        // scopes or take Retry away.
        const message = "Permission denied by the database: the role this request runs as has no privilege on table "
            + "\"rebase.api_keys\". That is a missing GRANT to that role, not a row-level security policy.";
        const f = classifyLoadFailure(Object.assign(new Error(message), { status: 500, code: "DB_PERMISSION_DENIED" }));
        expect(f.kind).toBe("unavailable");
        expect(f.retryable).toBe(true);

        expect(classifyLoadFailure(Object.assign(new Error("Forbidden"), { status: 502 })).kind).toBe("unavailable");
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
