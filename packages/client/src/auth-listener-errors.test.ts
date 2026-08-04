import { jest } from "@jest/globals";
import { createAuth } from "./auth";
import type { Transport } from "./transport";

/**
 * What happens to an error thrown by the app's own auth listener.
 *
 * `emit` isolates listeners from each other, which is right — one bad handler
 * must not stop the rest from being told about a sign-in. It also discarded the
 * error entirely, which is not: the throw came from the *caller's* code, and it
 * vanished with nothing in the console, so a broken `onAuthStateChange` handler
 * looked like an event that never fired.
 *
 * The socket in this same package already reports these
 * ("Error in channel handler:"). This was the one listener loop that did not.
 */
function transport(): Transport {
    return {
        request: jest.fn<any>().mockResolvedValue({}),
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        setOnUnauthorized: jest.fn(),
        baseUrl: "http://localhost:3000",
        apiPath: "/api",
        fetchFn: globalThis.fetch,
        getHeaders: () => ({}),
        resolveToken: jest.fn<any>().mockResolvedValue(null)
    } as unknown as Transport;
}

describe("auth state listeners", () => {
    let error: ReturnType<typeof jest.spyOn>;

    beforeEach(() => { error = jest.spyOn(console, "error").mockImplementation(() => { /* quiet */ }); });
    afterEach(() => error.mockRestore());

    it("keeps telling the other listeners when one throws", () => {
        const auth = createAuth(transport());
        const second = jest.fn();

        auth.onAuthStateChange(() => { throw new Error("handler blew up"); });
        auth.onAuthStateChange(second);
        auth.signOut();

        expect(second).toHaveBeenCalled();
    });

    it("reports the throw instead of discarding it", () => {
        const auth = createAuth(transport());
        auth.onAuthStateChange(() => { throw new Error("handler blew up"); });

        auth.signOut();

        const said = error.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");
        expect(said).toMatch(/handler blew up/);
    });
});
