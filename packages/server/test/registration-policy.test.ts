/**
 * Registration policy — the advertise/enforce agreement.
 *
 * The empty-database dead end was not a bug in either endpoint. Both were
 * individually reasonable; they simply computed the same predicate in three
 * places and one of them fell behind. `GET /auth/config` said registration was
 * open, `POST /auth/register` said it was closed, and the login UI dutifully
 * rendered a form that could only ever 403.
 *
 * So these tests are not "does registration work". They are:
 *
 *   1. the predicate itself, as a truth table, and
 *   2. **agreement** — for every combination of flags and table state, what
 *      `/auth/config` advertises is what `/auth/register` actually does.
 *
 * (2) is the one that matters. Any future term added to the rule is covered by
 * it automatically, which a test written against either endpoint alone is not.
 *
 * Everything here is driven through `createBuiltinAuthAdapter`, deliberately.
 * The previous tests built `createAuthRoutes` directly and passed
 * `disableSelfRegistration` straight into it — so they went green while the
 * adapter, which is the only path a real backend takes, never plumbed the flag
 * at all and the "hard kill switch" did nothing whatsoever in production. A
 * test that bypasses the wiring cannot see a wiring bug.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import { isRegistrationOpen, isSteadyStateRegistrationOpen } from "../src/auth/registration-policy";
import type { AuthRepository } from "../src/auth/interfaces";
import { configureJwt } from "../src/auth/jwt";

jest.mock("../src/auth/password");

jest.mock("../src/utils/logger", () => ({
    logger: {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
        child: jest.fn().mockReturnThis()
    }
}));

jest.mock("../src/auth/rate-limiter", () => {
    const passthrough = async (_c: unknown, next: () => Promise<void>) => next();
    return { createRateLimiter: () => passthrough, defaultAuthLimiter: passthrough, strictAuthLimiter: passthrough };
});

import { hashPassword, verifyPassword, validatePasswordStrength } from "../src/auth/password";

const TEST_SECRET = "registration-policy-secret-key-that-is-definitely-32-chars!!";

// ── The predicate ───────────────────────────────────────────────────────────

describe("isRegistrationOpen", () => {
    it("admits the first user on an empty table even when registration is off", () => {
        // The bootstrap exception. Without it a backend deployed with
        // allowRegistration: false can never create its own admin.
        expect(isRegistrationOpen({ allowRegistration: false, needsSetup: true })).toBe(true);
    });

    it("closes again the moment a user exists", () => {
        expect(isRegistrationOpen({ allowRegistration: false, needsSetup: false })).toBe(false);
    });

    it("honours allowRegistration in steady state", () => {
        expect(isRegistrationOpen({ allowRegistration: true, needsSetup: false })).toBe(true);
    });

    it("lets disableSelfRegistration override everything, including bootstrap", () => {
        const outcomes = [true, false].flatMap(allowRegistration =>
            [true, false].map(needsSetup => ({
                allowRegistration,
                needsSetup,
                open: isRegistrationOpen({ disableSelfRegistration: true, allowRegistration, needsSetup })
            }))
        );
        // Compared as a whole so a failure names the combination that leaked.
        expect(outcomes.filter(o => o.open)).toEqual([]);
    });

    it("treats the steady-state form as the full form with an occupied table", () => {
        // The register route uses the steady-state form to avoid counting rows
        // on every anonymous request. If the two ever disagree, that
        // optimisation silently changes the rule.
        for (const disableSelfRegistration of [true, false]) {
            for (const allowRegistration of [true, false]) {
                expect(
                    isSteadyStateRegistrationOpen({ disableSelfRegistration, allowRegistration })
                ).toBe(
                    isRegistrationOpen({ disableSelfRegistration, allowRegistration, needsSetup: false })
                );
            }
        }
    });
});

// ── The wiring ──────────────────────────────────────────────────────────────

/**
 * A stateful repository, so "empty table" and "first user just registered" are
 * the same object at two points in time rather than two unrelated mocks. The
 * register route's own first-user check reads back what it just wrote, and a
 * stateless mock makes that path untestable.
 */
function createRepo(seedUsers: number) {
    const users: Array<{ id: string; email: string; passwordHash: string | null }> = [];
    for (let i = 0; i < seedUsers; i++) {
        users.push({ id: `seed-${i}`, email: `seed-${i}@test.dev`, passwordHash: "salt:hash" });
    }
    let next = 0;

    const full = (u: { id: string; email: string; passwordHash: string | null }) => ({
        ...u,
        displayName: "Test",
        photoUrl: null,
        emailVerified: false,
        emailVerificationToken: null,
        emailVerificationSentAt: null,
        isAnonymous: false,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
    });

    return {
        users,
        repo: {
            listUsers: jest.fn(async () => users.map(full)),
            listUsersPaginated: jest.fn(async () => ({
                users: users.map(full), total: users.length, limit: 1, offset: 0
            })),
            getUserByEmail: jest.fn(async (email: string) => {
                const found = users.find(u => u.email === email);
                return found ? full(found) : null;
            }),
            createUser: jest.fn(async (data: { email: string; passwordHash?: string }) => {
                const user = { id: `created-${next++}`, email: data.email, passwordHash: data.passwordHash ?? null };
                users.push(user);
                return full(user);
            }),
            deleteUser: jest.fn(async (id: string) => {
                const index = users.findIndex(u => u.id === id);
                if (index >= 0) users.splice(index, 1);
            }),
            getUserById: jest.fn(async (id: string) => {
                const found = users.find(u => u.id === id);
                return found ? full(found) : null;
            }),
            getUserWithRoles: jest.fn(async (uid: string) => ({
                user: full(users.find(u => u.id === uid)!), roles: []
            })),
            getUserRoles: jest.fn(async () => []),
            getUserRoleIds: jest.fn(async () => []),
            setUserRoles: jest.fn(async () => undefined),
            assignDefaultRole: jest.fn(async () => undefined),
            getUserByIdentity: jest.fn(async () => null),
            linkUserIdentity: jest.fn(async () => undefined),
            getUserIdentities: jest.fn(async () => []),
            updateUser: jest.fn(async () => undefined),
            updatePassword: jest.fn(async () => undefined),
            setEmailVerified: jest.fn(async () => undefined),
            setVerificationToken: jest.fn(async () => undefined),
            getUserByVerificationToken: jest.fn(async () => null),
            createRefreshToken: jest.fn(async () => undefined),
            findRefreshTokenByHash: jest.fn(async () => null),
            deleteRefreshToken: jest.fn(async () => undefined),
            deleteAllRefreshTokensForUser: jest.fn(async () => undefined),
            listRefreshTokensForUser: jest.fn(async () => []),
            deleteRefreshTokenById: jest.fn(async () => undefined),
            markRefreshTokenRotated: jest.fn(async () => undefined),
            revokeRefreshTokenSession: jest.fn(async () => undefined),
            pruneRefreshTokens: jest.fn(async () => undefined),
            getTokensValidAfter: jest.fn(async () => null),
            setTokensValidAfter: jest.fn(async () => undefined),
            createPasswordResetToken: jest.fn(async () => undefined),
            findValidPasswordResetToken: jest.fn(async () => null),
            markPasswordResetTokenUsed: jest.fn(async () => undefined),
            deleteExpiredPasswordResetTokens: jest.fn(async () => undefined)
        } as unknown as AuthRepository
    };
}

interface Scenario {
    disableSelfRegistration: boolean;
    allowRegistration: boolean;
    /** Users already in the table. 0 is the bootstrap window. */
    existingUsers: number;
    /** Opt-in anonymous sign-in. Absent means the default, which is off. */
    allowAnonymous?: boolean;
}

function build(scenario: Scenario) {
    configureJwt({ secret: TEST_SECRET, accessExpiresIn: "15m", refreshExpiresIn: "7d" });
    (validatePasswordStrength as jest.Mock).mockReturnValue({ valid: true, errors: [] });
    (hashPassword as jest.Mock).mockResolvedValue("hashed-pw");
    (verifyPassword as jest.Mock).mockResolvedValue(true);

    const { repo } = createRepo(scenario.existingUsers);
    const adapter = createBuiltinAuthAdapter({
        authRepository: repo,
        allowRegistration: scenario.allowRegistration,
        disableSelfRegistration: scenario.disableSelfRegistration,
        allowAnonymous: scenario.allowAnonymous
    });

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    // Mounted exactly as init.ts mounts it.
    app.route("/auth", adapter.createAuthRoutes()!);

    return { adapter, app };
}

const SCENARIOS: Scenario[] = [false, true].flatMap(disableSelfRegistration =>
    [false, true].flatMap(allowRegistration =>
        [0, 1].map(existingUsers => ({ disableSelfRegistration, allowRegistration, existingUsers }))
    )
);

const label = (s: Scenario) =>
    `disableSelfRegistration=${s.disableSelfRegistration} allowRegistration=${s.allowRegistration} ` +
    `${s.existingUsers === 0 ? "empty table" : "table has a user"}`;

describe("what /auth/config advertises is what /auth/register does", () => {
    it.each(SCENARIOS.map(s => [label(s), s] as const))("%s", async (_label, scenario) => {
        const { adapter, app } = build(scenario);

        // What the login UI is told. This is the value `GET /auth/config`
        // returns on a real backend — init.ts answers that path from
        // getCapabilities(), before the auth router is ever consulted.
        const capabilities = await adapter.getCapabilities();

        // What actually happens when the user submits the form it rendered.
        const response = await app.request("/auth/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                email: "newcomer@test.dev",
                password: "a-sufficiently-long-password",
                displayName: "Newcomer"
            })
        });
        const accepted = response.status < 400;

        // Compared as an object so a failure shows which side said what,
        // rather than just "expected true, got false".
        expect({
            advertisedByRegistrationEnabled: capabilities.registrationEnabled,
            advertisedByRegistration: capabilities.registration,
            acceptedByRegisterRoute: accepted
        }).toEqual({
            advertisedByRegistrationEnabled: accepted,
            advertisedByRegistration: accepted,
            acceptedByRegisterRoute: accepted
        });

        // And both must equal the shared rule, so neither drifted together in
        // the same wrong direction.
        expect(accepted).toBe(isRegistrationOpen({
            disableSelfRegistration: scenario.disableSelfRegistration,
            allowRegistration: scenario.allowRegistration,
            needsSetup: scenario.existingUsers === 0
        }));
    });
});

describe("the kill switch reaches the adapter", () => {
    // The regression that motivated this file: disableSelfRegistration was
    // declared on the route module and read by both config endpoints, but
    // BuiltinAuthAdapterConfig never carried it, so nothing a user of the
    // framework wrote could ever set it.
    it("closes the bootstrap window that allowRegistration: false leaves open", async () => {
        const open = build({ disableSelfRegistration: false, allowRegistration: false, existingUsers: 0 });
        expect((await open.adapter.getCapabilities()).registrationEnabled).toBe(true);

        const shut = build({ disableSelfRegistration: true, allowRegistration: false, existingUsers: 0 });
        const capabilities = await shut.adapter.getCapabilities();
        expect(capabilities.registrationEnabled).toBe(false);
        // needsSetup stays true: the database really is empty, and the admin UI
        // uses it to explain why there is nothing to sign in to. What must not
        // happen is offering a registration form alongside it.
        expect(capabilities.needsSetup).toBe(true);
    });
});

// ── Anonymous sign-in ───────────────────────────────────────────────────────

/**
 * Anonymous sign-in is registration that never asked.
 *
 * `POST /auth/anonymous` inserts a `users` row and assigns `defaultRole`
 * exactly as `POST /auth/register` does. It was mounted unconditionally and
 * consulted none of the gates above, and there was no key to turn it off — so
 * the "hard kill switch" closed the front door while this stayed open. Two
 * unauthenticated requests then produced a permanent email/password account:
 * `/auth/anonymous` for the row and the session, `/auth/anonymous/link` to put
 * credentials on it.
 *
 * These drive the adapter rather than `createAuthRoutes`, for the reason at the
 * top of this file: the wiring is where the flag went missing last time.
 */
describe("anonymous sign-in obeys the registration gates", () => {
    const post = (app: ReturnType<typeof build>["app"], path: string, body?: unknown) =>
        app.request(path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {})
        });

    it("is off by default, so an untouched config does not hand out accounts", async () => {
        const { app } = build({
            disableSelfRegistration: false,
            allowRegistration: true,
            existingUsers: 1
        });

        const res = await post(app, "/auth/anonymous");

        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("ANONYMOUS_AUTH_DISABLED");
    });

    it("works once the deployment opts in", async () => {
        const { app } = build({
            disableSelfRegistration: false,
            allowRegistration: true,
            existingUsers: 1,
            allowAnonymous: true
        });

        const res = await post(app, "/auth/anonymous");

        expect(res.status).toBe(201);
    });

    it("stays shut when disableSelfRegistration overrides the opt-in", async () => {
        // The scenario from the audit: an operator sets the kill switch AND
        // someone has enabled anonymous. The kill switch is documented to block
        // self-registration outright, so it wins.
        const { app } = build({
            disableSelfRegistration: true,
            allowRegistration: false,
            existingUsers: 1,
            allowAnonymous: true
        });

        const res = await post(app, "/auth/anonymous");

        expect(res.status).toBe(403);
    });

    it("closes the link route too, so a session minted earlier cannot finish the upgrade", async () => {
        // /anonymous/link is the second half of the two-request path to a
        // permanent account. Gating only the first half would leave any
        // already-issued anonymous session able to complete it.
        const { app } = build({
            disableSelfRegistration: false,
            allowRegistration: true,
            existingUsers: 1,
            allowAnonymous: true
        });
        const created = await post(app, "/auth/anonymous");
        expect(created.status).toBe(201);
        const token = (await created.json() as { tokens: { accessToken: string } }).tokens.accessToken;

        const { app: shut } = build({
            disableSelfRegistration: false,
            allowRegistration: true,
            existingUsers: 1,
            allowAnonymous: false
        });
        const res = await shut.request("/auth/anonymous/link", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ email: "someone@test.dev", password: "a-strong-password" })
        });

        expect(res.status).toBe(403);
    });

    it("advertises the state it enforces", async () => {
        // A capability that exists and is not in the capability surface is how
        // a client ends up calling a route it cannot discover is off.
        const off = build({
            disableSelfRegistration: false,
            allowRegistration: true,
            existingUsers: 1
        });
        expect((await off.adapter.getCapabilities()).anonymousLogin).toBe(false);

        const on = build({
            disableSelfRegistration: false,
            allowRegistration: true,
            existingUsers: 1,
            allowAnonymous: true
        });
        expect((await on.adapter.getCapabilities()).anonymousLogin).toBe(true);

        const killed = build({
            disableSelfRegistration: true,
            allowRegistration: true,
            existingUsers: 1,
            allowAnonymous: true
        });
        expect((await killed.adapter.getCapabilities()).anonymousLogin).toBe(false);
    });
});
