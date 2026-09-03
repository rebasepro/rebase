/**
 * The two things that protect a route which mails an address the caller named.
 *
 * `POST /auth/forgot-password` and `POST /auth/otp` both answer the same words
 * whether or not the address has an account — deliberately, so the endpoint
 * cannot be asked "is this person a customer?". Two channels leaked around that
 * anyway:
 *
 *  - **Time.** Only the branch with a real account did a token insert, a
 *    template render and an SMTP round trip, so the response time was the
 *    answer the response text refused to give.
 *  - **The mailbox.** The only limiter was keyed per IP, and an IP is the
 *    attacker's to rotate. The mailbox filling up belongs to somebody who
 *    cannot rotate anything, and the domain the messages come from is the
 *    operator's own sending reputation.
 *
 * Unlike the rest of the auth suite, this file uses the REAL limiters — the
 * whole point is that the routes register them.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, AuthModuleConfig } from "../src/auth/routes";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt } from "../src/auth/jwt";
import { RECIPIENT_ROUTE_FLOOR_MS } from "../src/auth/rate-limiter";

jest.mock("../src/utils/logger", () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn().mockReturnThis()
    }
}));

const TEST_SECRET = "integration-test-secret-key-that-is-definitely-32-chars-long!!";

function user(email: string) {
    return {
        id: "user-1",
        email,
        passwordHash: "salt:hash",
        displayName: "Someone",
        photoUrl: null,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

let sent: jest.Mock;
let knownAddresses: Set<string>;

function createApp() {
    sent = jest.fn().mockResolvedValue(undefined);
    knownAddresses = new Set();

    const authRepo = {
        getUserByEmail: jest.fn(async (email: string) =>
            (knownAddresses.has(email) ? user(email) : null)),
        createPasswordResetToken: jest.fn().mockResolvedValue(undefined),
        createMagicLinkToken: jest.fn().mockResolvedValue(undefined),
        getUserRoleIds: jest.fn().mockResolvedValue([])
    } as unknown as AuthRepository;

    const config: AuthModuleConfig = {
        authRepo,
        emailService: { send: sent, isConfigured: () => true } as never,
        emailConfig: { from: "noreply@example.test" } as never,
        jwtSecret: TEST_SECRET,
        // The OTP routes are opt-in, and one of the two routes under test here
        // is theirs.
        enableEmailOtp: true
    } as unknown as AuthModuleConfig;

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes(config));
    return app;
}

const json = (body: Record<string, unknown>) => ({
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
});

beforeAll(() => configureJwt({ secret: TEST_SECRET }));

describe("a route that answers \"if an account exists…\"", () => {
    /**
     * Asserted as a floor rather than as an equality between the two branches:
     * a unit test cannot honestly measure two handlers into the same
     * microsecond, but it can prove that neither answers before the floor,
     * which is what makes the difference between them unobservable.
     */
    it("holds a known and an unknown address to the same floor", async () => {
        const app = createApp();
        knownAddresses.add("floor-known@test.com");

        const unknownStart = Date.now();
        await app.request("/auth/forgot-password", json({ email: "floor-unknown@test.com" }));
        const unknownMs = Date.now() - unknownStart;

        const knownStart = Date.now();
        await app.request("/auth/forgot-password", json({ email: "floor-known@test.com" }));
        const knownMs = Date.now() - knownStart;

        // A small tolerance for timer granularity, not for the property.
        expect(unknownMs).toBeGreaterThanOrEqual(RECIPIENT_ROUTE_FLOOR_MS - 25);
        expect(knownMs).toBeGreaterThanOrEqual(RECIPIENT_ROUTE_FLOOR_MS - 25);
    }, 20_000);

    it("does not wait on the mail server before answering", async () => {
        // The send is off the response path, so a slow SMTP server cannot
        // reintroduce the difference the floor exists to hide.
        const app = createApp();
        knownAddresses.add("slow-smtp@test.com");
        sent.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 3000)));

        const started = Date.now();
        const res = await app.request("/auth/forgot-password", json({ email: "slow-smtp@test.com" }));

        expect(res.status).toBe(200);
        expect(Date.now() - started).toBeLessThan(2000);
    }, 20_000);
});

describe("how many messages one address may be sent", () => {
    it("stops a password-reset mail bomb, however many IPs ask", async () => {
        const app = createApp();
        const email = "reset-target@test.com";
        knownAddresses.add(email);

        let last: Response | undefined;
        for (let i = 0; i < 8; i++) {
            last = await app.request("/auth/forgot-password", json({ email }));
        }

        expect(last!.status).toBe(429);
        // And the messages actually stopped, rather than the status alone
        // changing while the send kept happening.
        expect(sent.mock.calls.length).toBeLessThan(8);
    }, 30_000);

    it("counts per address, so one target does not lock out everybody else", async () => {
        const app = createApp();
        knownAddresses.add("noisy@test.com");
        knownAddresses.add("quiet@test.com");

        for (let i = 0; i < 8; i++) {
            await app.request("/auth/forgot-password", json({ email: "noisy@test.com" }));
        }

        const other = await app.request("/auth/forgot-password", json({ email: "quiet@test.com" }));
        expect(other.status).toBe(200);
    }, 30_000);

    it("stops a sign-in-code mail bomb too", async () => {
        const app = createApp();
        const email = "otp-target@test.com";
        knownAddresses.add(email);

        let last: Response | undefined;
        for (let i = 0; i < 8; i++) {
            last = await app.request("/auth/otp", json({ email }));
        }

        expect(last!.status).toBe(429);
    }, 30_000);
});
