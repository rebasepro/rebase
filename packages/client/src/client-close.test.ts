import { jest } from "@jest/globals";
import { createRebaseClient } from "./index";

/**
 * `close()` has one job: leave nothing behind that can keep a process alive.
 *
 * The realtime socket is the obvious such handle and was the only one this
 * method released. The scheduled token refresh is the other, and it is easy to
 * miss because it only exists once somebody signs in: `scheduleRefresh` arms a
 * plain `setTimeout` for roughly the access token's lifetime, and it is not
 * `unref`'d. So a signed-in Node client — a seed script, a cron handler, a job,
 * an SSR request — released its socket, called `close()` exactly as documented,
 * and still hung until the token would have expired.
 *
 * Found by `tests/e2e/tests/client-sdk-e2e.ts`, which reported every check green and
 * then never exited. Pinned here rather than only there because that suite needs
 * Docker and a real Postgres, and this costs nothing.
 *
 * The assertion is the pending timer count, not a spy on `stopAutoRefresh`:
 * what matters is that no handle survives, not which internal call removed it.
 */
describe("client.close()", () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    /** A login response shaped exactly as `handleAuthResponse` reads it. */
    function loginResponse(accessTokenExpiresAt: number) {
        return new Response(
            JSON.stringify({
                tokens: { accessToken: "access-token",
refreshToken: "refresh-token",
accessTokenExpiresAt },
                user: { uid: "user-1",
email: "user@example.test" }
            }),
            { status: 200,
headers: { "content-type": "application/json" } }
        );
    }

    it("clears the scheduled token refresh, so a signed-in script can exit", async () => {
        jest.useFakeTimers();

        // An hour out, so the refresh is scheduled rather than fired
        // immediately — `scheduleRefresh` runs the refresh inline when the
        // delay has already elapsed, which would arm no timer and let a broken
        // `close()` pass this test.
        const expiresAt = Date.now() + 60 * 60 * 1000;
        globalThis.fetch = jest.fn(async () => loginResponse(expiresAt)) as unknown as typeof fetch;

        // `realtime: false` so the socket cannot account for a pending handle:
        // the only thing this test may observe is the refresh timer.
        const client = createRebaseClient({ baseUrl: "http://localhost:9999",
realtime: false });

        await client.auth.signInWithEmail("user@example.test", "password");
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        client.close();
        expect(jest.getTimerCount()).toBe(0);
    });

    it("is safe on a client that never signed in, and safe to call twice", () => {
        jest.useFakeTimers();

        const client = createRebaseClient({ baseUrl: "http://localhost:9999",
realtime: false });

        expect(() => {
            client.close();
            client.close();
        }).not.toThrow();
        expect(jest.getTimerCount()).toBe(0);
    });
});
