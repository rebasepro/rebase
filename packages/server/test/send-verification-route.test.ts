/**
 * `POST /auth/send-verification` — rate limiting, and the link it mails.
 *
 * This was the only email-sending route in the codebase with no limiter of any
 * kind, and being authenticated is not the protection it looks like: nothing
 * verifies the address a registration is given, so an attacker registers a
 * victim's address, signs in to the account they just made, and loops this
 * route. Each call mints a token and mails the victim.
 *
 * Unlike the rest of the auth suite these tests use the *real* limiters —
 * the whole point is that the route registers them.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, AuthModuleConfig } from "../src/auth/routes";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

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

function unverifiedUser(id: string) {
    return {
        id,
        email: `${id}@bigcorp.test`,
        passwordHash: "salt:hash",
        displayName: "Victim",
        photoUrl: null,
        emailVerified: false,
        emailVerificationToken: null,
        emailVerificationSentAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
    };
}

let sent: jest.Mock;

function createApp() {
    sent = jest.fn().mockResolvedValue(undefined);

    const authRepo = {
        getUserById: jest.fn().mockImplementation((id: string) => Promise.resolve(unverifiedUser(id))),
        getUserByEmail: jest.fn().mockResolvedValue(null),
        getUserRoles: jest.fn().mockResolvedValue([]),
        setVerificationToken: jest.fn().mockResolvedValue(undefined),
        listUsersPaginated: jest.fn().mockResolvedValue({ users: [],
total: 0,
limit: 1,
offset: 0 })
    } as unknown as jest.Mocked<AuthRepository>;

    const config: AuthModuleConfig = {
        authRepo,
        allowRegistration: true,
        emailService: { send: sent,
isConfigured: () => true } as unknown as AuthModuleConfig["emailService"],
        emailConfig: { from: "noreply@app.test",
appName: "TestApp",
resetPasswordUrl: "https://app.test" }
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes(config));
    return app;
}

function post(app: Hono<HonoEnv>, uid: string) {
    return app.request("/auth/send-verification", {
        method: "POST",
        headers: { Authorization: `Bearer ${generateAccessToken(uid, ["editor"])}` }
    });
}

describe("POST /auth/send-verification rate limiting", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    it("stops one account from looping the route into a mail bomb", async () => {
        const app = createApp();

        const statuses: number[] = [];
        for (let i = 0; i < 7; i++) {
            statuses.push((await post(app, "attacker-session")).status);
        }

        expect(statuses.filter(s => s === 200).length).toBeGreaterThan(0);
        expect(statuses).toContain(429);
        // The mail actually stops going out — not just the status changing.
        expect(sent.mock.calls.length).toBeLessThan(statuses.length);
    });

    it("answers 429 with a Retry-After the client can act on", async () => {
        const app = createApp();

        let last: Response | undefined;
        for (let i = 0; i < 7; i++) {
            last = await post(app, "attacker-session");
        }

        expect(last!.status).toBe(429);
        expect(last!.headers.get("Retry-After")).toBeTruthy();
        expect(await last!.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    });

    it("throttles per account, so one exhausted bucket does not lock everyone out", async () => {
        const app = createApp();

        // `attacker-session` is already over its limit from the tests above —
        // the limiters are module-level singletons, deliberately shared here.
        expect((await post(app, "attacker-session")).status).toBe(429);
        expect((await post(app, "unrelated-user")).status).toBe(200);
    });
});

describe("POST /auth/send-verification link", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
    });

    it("mails an absolute link when only resetPasswordUrl is configured", async () => {
        // No boot path sets `verifyEmailUrl`, which is exactly the configuration
        // here. Without the fallback the href is `/verify-email?token=…` — a
        // relative URL, dead in every mail client, reported as success.
        const app = createApp();

        const res = await post(app, "link-check");
        expect(res.status).toBe(200);

        const message = sent.mock.calls[0][0] as { html: string; text: string };
        expect(message.html).toContain("https://app.test/verify-email?token=");
        expect(message.text).toContain("https://app.test/verify-email?token=");
        expect(message.html).not.toContain("href=\"/verify-email");
    });
});
