import { jest } from "@jest/globals";
import { createAuth, createMemoryStorage } from "./auth";
import type { Transport } from "./transport";

/**
 * How far ahead the token refresh is allowed to be scheduled.
 *
 * `scheduleRefresh` computes `(expiresAt - REFRESH_BUFFER_MS) - Date.now()` and
 * hands it to `setTimeout`, with a floor for the past and no ceiling. Node and
 * every browser store that delay in a **32-bit signed integer**: hand them more
 * than 2,147,483,647 ms — about 24.8 days — and the timer does not wait, it
 * clamps to 1 ms and fires immediately.
 *
 * `auth.accessExpiresIn` is configurable and defaults to `"1h"`, so this is
 * dormant on a default deployment. Set it to `"30d"` — an ordinary choice for an
 * internal tool or a kiosk — and every signed-in browser refreshes at once,
 * receives a token expiring another 30 days out, schedules again, overflows
 * again: a hot loop against `/auth/refresh`, one per open tab.
 *
 * A floor without a ceiling is the tell. Someone already knew the input was
 * untrusted and bounded one side of it. (Class 23.)
 */
const MAX_DELAY = 2_147_483_647;

function transport(): Transport {
    return {
        request: jest.fn<any>().mockResolvedValue({}),
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        setOnUnauthorized: jest.fn(),
        baseUrl: "http://localhost:3000",
        apiPath: "/api",
        fetchFn: jest.fn<any>().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
        getHeaders: () => ({}),
        resolveToken: jest.fn<any>().mockResolvedValue(null)
    } as unknown as Transport;
}

/** Storage already holding a session expiring `days` from now. */
function storageWithSession(days: number) {
    const storage = createMemoryStorage();
    storage.setItem("rebase_auth", JSON.stringify({
        accessToken: "at",
        refreshToken: "rt",
        expiresAt: Date.now() + days * 24 * 60 * 60 * 1000,
        user: { uid: "u1" }
    }));
    return storage;
}

describe("scheduled token refresh", () => {
    let delays: number[];
    let realSetTimeout: typeof setTimeout;

    beforeEach(() => {
        delays = [];
        realSetTimeout = globalThis.setTimeout;
        globalThis.setTimeout = ((fn: () => void, ms?: number) => {
            if (typeof ms === "number") delays.push(ms);
            return realSetTimeout(() => { /* never run in this test */ }, 0);
        }) as unknown as typeof setTimeout;
    });

    afterEach(() => { globalThis.setTimeout = realSetTimeout; });

    it("schedules a normal one-hour token in the ordinary way", () => {
        createAuth(transport(), { storage: storageWithSession(1 / 24) });

        const scheduled = delays.filter(d => d > 1000);
        expect(scheduled.length).toBeGreaterThan(0);
        expect(Math.max(...scheduled)).toBeLessThanOrEqual(MAX_DELAY);
    });

    it("never asks setTimeout for a delay it cannot hold", () => {
        // 30 days: 2,592,000,000 ms, past the 32-bit ceiling.
        createAuth(transport(), { storage: storageWithSession(30) });

        for (const d of delays) expect(d).toBeLessThanOrEqual(MAX_DELAY);
    });

    it("does not schedule a refresh for one millisecond from now", () => {
        // The symptom of the overflow: the clamp makes it immediate, and the
        // refresh that follows schedules another one just as far out.
        createAuth(transport(), { storage: storageWithSession(90) });

        const immediate = delays.filter(d => d > 0 && d < 1000);
        expect(immediate).toEqual([]);
    });
});
