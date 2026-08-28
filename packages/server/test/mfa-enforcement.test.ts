/**
 * MFA enforcement — the properties, not the flags.
 *
 * MFA used to be decorative: `aal` had five writes and one read, every
 * session-minting route issued `aal1` unconditionally, and enrolling a factor
 * changed nothing about what a stolen password bought. A test that asserted a
 * flag was written, or that some helper was called, would have passed against
 * that code — so the assertions here are about what a credential can *do*:
 *
 *   - the response to a login by an enrolled user contains nothing that
 *     authenticates a protected request (bug class 8: assert the property);
 *   - a code that was accepted once cannot be accepted again;
 *   - a challenge cannot be guessed at without limit;
 *   - an `aal1` session cannot enrol its way to `aal2`.
 *
 * The rate limiters are deliberately NOT mocked here — one of the fixes under
 * test is a limiter — so each test that verifies codes uses its own uid, since
 * the account-scoped bucket is the point of it.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes, AuthModuleConfig } from "../src/auth/routes";
import type { AuthRepository, MfaChallengeInfo, MfaFactor } from "../src/auth/interfaces";
import { requireAuth } from "../src/auth/middleware";
import { configureJwt, generateAccessToken, verifyAccessToken } from "../src/auth/jwt";
import { base32Decode, generateTotp, generateTotpSecret, hashRecoveryCode } from "../src/auth/mfa";
import { encryptTotpSecret } from "../src/auth/mfa-crypto";
import { z } from "zod";

jest.mock("../src/auth/password");

jest.mock("../src/utils/logger", () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn().mockReturnThis()
    }
}));

import { hashPassword, verifyPassword, validatePasswordStrength } from "../src/auth/password";

const TEST_SECRET = "mfa-enforcement-secret-key-that-is-definitely-32-chars!!";

// ── A repository with real state ────────────────────────────────────────────
// Derived answers, not canned ones: `hasVerifiedMfaFactors` reads the factor
// list, and `claimMfaFactorCounter` actually claims. A fake that answered from
// constants could not fail the replay test.

interface FakeFactor extends MfaFactor {
    secretEncrypted: string;
    lastUsedCounter: number | null;
}

interface Harness {
    app: Hono<HonoEnv>;
    repo: AuthRepository;
    uid: string;
    email: string;
    /** Base32 TOTP secret of the enrolled factor, for computing valid codes. */
    totpSecret: string;
    factorId: string;
    state: {
        factors: FakeFactor[];
        challenges: Map<string, MfaChallengeInfo & { expiresAt: Date }>;
        recoveryCodeHashes: Set<string>;
        refreshTokens: Array<Record<string, unknown>>;
        createdFactors: number;
        createdRecoveryCodeSets: number;
    };
}

function createHarness(opts: { uid: string; enrolled?: boolean; verified?: boolean } = { uid: "user-1" }): Harness {
    const uid = opts.uid;
    const email = `${uid}@example.com`;
    const { secret } = generateTotpSecret("TestApp", email);
    const factorId = `factor-${uid}`;

    const state: Harness["state"] = {
        factors: [],
        challenges: new Map(),
        recoveryCodeHashes: new Set(),
        refreshTokens: [],
        createdFactors: 0,
        createdRecoveryCodeSets: 0
    };

    if (opts.enrolled) {
        state.factors.push({
            id: factorId,
            uid,
            factorType: "totp",
            friendlyName: "Phone",
            verified: opts.verified ?? true,
            secretEncrypted: encryptTotpSecret(secret),
            lastUsedCounter: null,
            createdAt: new Date(),
            updatedAt: new Date()
        });
    }

    const user = {
        id: uid,
        email,
        passwordHash: "salt:hash",
        displayName: "Test User",
        photoUrl: null,
        emailVerified: true,
        isAnonymous: false,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date()
    };

    let challengeSeq = 0;

    const repo = {
        getUserByEmail: jest.fn().mockImplementation(async (e: string) => (e === email ? user : null)),
        getUserById: jest.fn().mockImplementation(async (id: string) => (id === uid ? user : null)),
        getUserByIdentity: jest.fn().mockResolvedValue(null),
        linkUserIdentity: jest.fn().mockResolvedValue(undefined),
        createUser: jest.fn().mockResolvedValue(user),
        updateUser: jest.fn().mockResolvedValue(user),
        listUsers: jest.fn().mockResolvedValue([user, { id: "someone-else" }]),
        listUsersPaginated: jest.fn().mockResolvedValue({ users: [user],
total: 2,
limit: 1,
offset: 0 }),
        getUserRoles: jest.fn().mockResolvedValue([{ id: "editor",
name: "Editor",
isAdmin: false }]),
        assignDefaultRole: jest.fn().mockResolvedValue(undefined),
        setUserRoles: jest.fn().mockResolvedValue(undefined),

        createRefreshToken: jest.fn().mockImplementation(
            async (u: string, hash: string, expiresAt: Date, ua?: string, ip?: string, session?: Record<string, unknown>) => {
                state.refreshTokens.push({ uid: u,
tokenHash: hash,
expiresAt,
session });
            }
        ),
        findRefreshTokenByHash: jest.fn().mockResolvedValue(null),
        deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
        markRefreshTokenRotated: jest.fn().mockResolvedValue(undefined),
        pruneRefreshTokens: jest.fn().mockResolvedValue(undefined),
        getTokensValidAfter: jest.fn().mockResolvedValue(null),
        listRefreshTokensForUser: jest.fn().mockResolvedValue([]),

        // ── MFA ──
        getMfaFactors: jest.fn().mockImplementation(async (u: string) => state.factors.filter(f => f.uid === u)),
        getMfaFactorById: jest.fn().mockImplementation(async (id: string) => state.factors.find(f => f.id === id) ?? null),
        hasVerifiedMfaFactors: jest.fn().mockImplementation(
            async (u: string) => state.factors.some(f => f.uid === u && f.verified)
        ),
        createMfaFactor: jest.fn().mockImplementation(async (u: string, factorType: "totp", secretEncrypted: string) => {
            state.createdFactors += 1;
            const created: FakeFactor = {
                id: `factor-new-${state.createdFactors}`,
                uid: u,
                factorType,
                verified: false,
                secretEncrypted,
                lastUsedCounter: null,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            state.factors.push(created);
            return created;
        }),
        verifyMfaFactor: jest.fn().mockImplementation(async (id: string) => {
            const factor = state.factors.find(f => f.id === id);
            if (factor) factor.verified = true;
        }),
        deleteMfaFactor: jest.fn().mockImplementation(async (id: string, u: string) => {
            state.factors = state.factors.filter(f => !(f.id === id && f.uid === u));
        }),
        claimMfaFactorCounter: jest.fn().mockImplementation(async (id: string, counter: number) => {
            const factor = state.factors.find(f => f.id === id);
            if (!factor) return false;
            if (factor.lastUsedCounter !== null && factor.lastUsedCounter >= counter) return false;
            factor.lastUsedCounter = counter;
            return true;
        }),
        createMfaChallenge: jest.fn().mockImplementation(async (fid: string, ip?: string) => {
            challengeSeq += 1;
            const challenge = {
                id: `challenge-${challengeSeq}`,
                factorId: fid,
                createdAt: new Date(),
                ipAddress: ip,
                attempts: 0,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000)
            };
            state.challenges.set(challenge.id, challenge);
            return challenge;
        }),
        getMfaChallengeById: jest.fn().mockImplementation(async (id: string) => {
            const challenge = state.challenges.get(id);
            if (!challenge || challenge.verifiedAt || challenge.expiresAt <= new Date()) return null;
            return challenge;
        }),
        verifyMfaChallenge: jest.fn().mockImplementation(async (id: string) => {
            const challenge = state.challenges.get(id);
            if (challenge) challenge.verifiedAt = new Date();
        }),
        recordMfaChallengeAttempt: jest.fn().mockImplementation(async (id: string) => {
            const challenge = state.challenges.get(id);
            if (!challenge) return 0;
            challenge.attempts = (challenge.attempts ?? 0) + 1;
            return challenge.attempts;
        }),
        createRecoveryCodes: jest.fn().mockImplementation(async (u: string, hashes: string[]) => {
            state.createdRecoveryCodeSets += 1;
            state.recoveryCodeHashes = new Set(hashes);
        }),
        useRecoveryCode: jest.fn().mockImplementation(async (u: string, hash: string) => {
            if (!state.recoveryCodeHashes.has(hash)) return false;
            state.recoveryCodeHashes.delete(hash);
            return true;
        }),
        getUnusedRecoveryCodeCount: jest.fn().mockImplementation(async () => state.recoveryCodeHashes.size),
        deleteAllRecoveryCodes: jest.fn().mockImplementation(async () => {
            state.recoveryCodeHashes.clear();
        })
    } as unknown as AuthRepository;

    const config: AuthModuleConfig = {
        authRepo: repo,
        allowRegistration: true,
        oauthProviders: [
            {
                id: "google",
                schema: z.object({ idToken: z.string().min(1) }),
                verify: async () => ({
                    providerId: "g-123",
                    email,
                    displayName: "Test User",
                    photoUrl: null,
                    emailVerified: true
                })
            }
        ]
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes(config));
    // The thing MFA is supposed to protect: any route behind a session.
    app.get("/protected", requireAuth, (c) => {
        const principal = c.get("user") as { uid: string; aal?: string };
        return c.json({ uid: principal.uid,
aal: principal.aal });
    });

    return { app,
repo,
uid,
email,
totpSecret: secret,
factorId,
state };
}

function post(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return {
        method: "POST" as const,
        headers: { "Content-Type": "application/json",
...headers },
        body: JSON.stringify(body)
    };
}

/** Every string anywhere in a JSON value — i.e. every candidate credential. */
function allStrings(value: unknown, found: string[] = []): string[] {
    if (typeof value === "string") found.push(value);
    else if (Array.isArray(value)) value.forEach(v => allStrings(v, found));
    else if (value && typeof value === "object") Object.values(value).forEach(v => allStrings(v, found));
    return found;
}

async function currentCode(secret: string): Promise<string> {
    return generateTotp(base32Decode(secret));
}

describe("MFA enforcement", () => {
    beforeAll(() => {
        process.env.MFA_ENCRYPTION_KEY = "mfa-test-encryption-key-0123456789abcdef";
        configureJwt({ secret: TEST_SECRET,
accessExpiresIn: "1h" });
        (validatePasswordStrength as jest.Mock).mockReturnValue({ valid: true,
errors: [] });
        (hashPassword as jest.Mock).mockResolvedValue("hashed-pw");
        (verifyPassword as jest.Mock).mockResolvedValue(true);
    });

    // ── C1 ──────────────────────────────────────────────────────────────
    describe("session issuance is gated on the second factor", () => {
        it("hands a password login nothing that authenticates a protected request", async () => {
            const h = createHarness({ uid: "gate-login",
enrolled: true });

            const res = await h.app.request("/auth/login", post({ email: h.email,
password: "correct-horse" }));

            expect(res.status).toBe(401);
            const body = await res.json() as { error: { code: string; details: { mfaToken: string; factors: Array<{ id: string }> } } };
            expect(body.error.code).toBe("MFA_REQUIRED");
            expect(body.error.details.factors.map(f => f.id)).toEqual([h.factorId]);

            // The property, not the flag: nothing in that response — the
            // pre-auth token included — may be spent as a session.
            for (const candidate of allStrings(body)) {
                const probe = await h.app.request("/protected", { headers: { Authorization: `Bearer ${candidate}` } });
                expect(probe.status).toBe(401);
            }

            // And no session was opened server-side either.
            expect(h.state.refreshTokens).toHaveLength(0);
        });

        it("gates the OAuth callback the same way", async () => {
            const h = createHarness({ uid: "gate-oauth",
enrolled: true });

            const res = await h.app.request("/auth/google", post({ idToken: "valid-token" }));

            expect(res.status).toBe(401);
            expect((await res.json() as { error: { code: string } }).error.code).toBe("MFA_REQUIRED");
            expect(h.state.refreshTokens).toHaveLength(0);
        });

        it("still signs in an account with no verified factor", async () => {
            // Non-vacuity: the gate must be the factor, not the route.
            const h = createHarness({ uid: "gate-none" });

            const res = await h.app.request("/auth/login", post({ email: h.email,
password: "correct-horse" }));

            expect(res.status).toBe(200);
            const body = await res.json() as { tokens: { accessToken: string } };
            const probe = await h.app.request("/protected", {
                headers: { Authorization: `Bearer ${body.tokens.accessToken}` }
            });
            expect(probe.status).toBe(200);
            expect((await probe.json() as { aal: string }).aal).toBe("aal1");
        });

        it("does not treat an unverified factor as a second factor", async () => {
            // An abandoned enrolment must not lock the account out of login.
            const h = createHarness({ uid: "gate-unverified",
enrolled: true,
verified: false });

            const res = await h.app.request("/auth/login", post({ email: h.email,
password: "correct-horse" }));
            expect(res.status).toBe(200);
        });

        it("mints the session only once the code is presented, at aal2", async () => {
            const h = createHarness({ uid: "gate-complete",
enrolled: true });

            const login = await h.app.request("/auth/login", post({ email: h.email,
password: "correct-horse" }));
            const { error } = await login.json() as { error: { details: { mfaToken: string } } };
            const pre = { Authorization: `Bearer ${error.details.mfaToken}` };

            const challengeRes = await h.app.request("/auth/mfa/challenge", post({ factorId: h.factorId }, pre));
            expect(challengeRes.status).toBe(200);
            const { challengeId } = await challengeRes.json() as { challengeId: string };

            const verifyRes = await h.app.request(
                "/auth/mfa/challenge/verify",
                post({ challengeId,
code: await currentCode(h.totpSecret) }, pre)
            );
            expect(verifyRes.status).toBe(200);
            const verified = await verifyRes.json() as { tokens: { accessToken: string }; user?: { uid: string } };

            const probe = await h.app.request("/protected", {
                headers: { Authorization: `Bearer ${verified.tokens.accessToken}` }
            });
            expect(probe.status).toBe(200);
            expect(await probe.json()).toEqual({ uid: "gate-complete",
aal: "aal2" });

            // The session row records the level, so refresh can carry it.
            expect(h.state.refreshTokens).toHaveLength(1);
            expect((h.state.refreshTokens[0].session as { aal: string }).aal).toBe("aal2");
        });
    });

    // ── C1, refresh half ────────────────────────────────────────────────
    describe("POST /auth/refresh carries the session's assurance level", () => {
        function storedRow(overrides: Record<string, unknown>) {
            return {
                id: "rt-1",
                uid: "refresh-user",
                sessionId: "session-1",
                tokenHash: "hash",
                expiresAt: new Date(Date.now() + 86400000),
                createdAt: new Date(),
                sessionStartedAt: new Date(),
                rotatedAt: null,
                revoked: false,
                ...overrides
            };
        }

        it("keeps an aal2 session at aal2 instead of silently downgrading it", async () => {
            const h = createHarness({ uid: "refresh-user",
enrolled: true });
            (h.repo.findRefreshTokenByHash as jest.Mock).mockResolvedValueOnce(storedRow({ aal: "aal2" }));

            const res = await h.app.request("/auth/refresh", post({ refreshToken: "the-token" }));

            expect(res.status).toBe(200);
            const { tokens } = await res.json() as { tokens: { accessToken: string } };
            expect((await verifyAccessToken(tokens.accessToken))?.aal).toBe("aal2");
            expect((h.state.refreshTokens[0].session as { aal: string }).aal).toBe("aal2");
        });

        it("does not promote a session that was never stepped up", async () => {
            const h = createHarness({ uid: "refresh-user",
enrolled: true });
            (h.repo.findRefreshTokenByHash as jest.Mock).mockResolvedValueOnce(storedRow({}));

            const res = await h.app.request("/auth/refresh", post({ refreshToken: "the-token" }));

            const { tokens } = await res.json() as { tokens: { accessToken: string } };
            expect((await verifyAccessToken(tokens.accessToken))?.aal).toBe("aal1");
        });
    });

    // ── H1 ──────────────────────────────────────────────────────────────
    describe("changing enrolled factors requires the existing factor", () => {
        async function session(uid: string, aal: "aal1" | "aal2" = "aal1") {
            return { Authorization: `Bearer ${await generateAccessToken(uid, ["editor"], aal)}` };
        }

        it("refuses to enrol a second factor from an aal1 session", async () => {
            // The self-service step-up: enrol → verify with a code you computed
            // → aal2 → delete the victim's factor. It dies at the first step.
            const h = createHarness({ uid: "h1-enrol",
enrolled: true });

            const res = await h.app.request("/auth/mfa/enroll", post({}, await session("h1-enrol")));

            expect(res.status).toBe(403);
            expect((await res.json() as { error: { code: string } }).error.code).toBe("AAL2_REQUIRED");
            expect(h.state.createdFactors).toBe(0);
            // …and the account's existing recovery codes were not wiped on the way.
            expect(h.state.createdRecoveryCodeSets).toBe(0);
        });

        it("refuses to confirm a factor from an aal1 session when one is already verified", async () => {
            const h = createHarness({ uid: "h1-verify",
enrolled: true });
            // A factor smuggled in some other way is still not confirmable.
            h.state.factors.push({
                id: "factor-attacker",
                uid: "h1-verify",
                factorType: "totp",
                verified: false,
                secretEncrypted: encryptTotpSecret(h.totpSecret),
                lastUsedCounter: null,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            const res = await h.app.request(
                "/auth/mfa/verify",
                post({ factorId: "factor-attacker",
code: await currentCode(h.totpSecret) }, await session("h1-verify"))
            );

            expect(res.status).toBe(403);
            expect(h.state.factors.find(f => f.id === "factor-attacker")?.verified).toBe(false);
        });

        it("allows the first enrolment on an account with no factor", async () => {
            const h = createHarness({ uid: "h1-first" });

            const res = await h.app.request("/auth/mfa/enroll", post({}, await session("h1-first")));

            expect(res.status).toBe(201);
            expect(h.state.createdFactors).toBe(1);
        });

        it("allows enrolment from a session that presented the existing factor", async () => {
            const h = createHarness({ uid: "h1-stepped",
enrolled: true });

            const res = await h.app.request("/auth/mfa/enroll", post({}, await session("h1-stepped", "aal2")));

            expect(res.status).toBe(201);
        });
    });

    // ── H3 ──────────────────────────────────────────────────────────────
    describe("an accepted TOTP code cannot be replayed", () => {
        it("refuses the same code on a second challenge inside its window", async () => {
            const h = createHarness({ uid: "h3-replay",
enrolled: true });
            const pre = { Authorization: `Bearer ${await generateAccessToken("h3-replay", ["editor"])}` };
            const code = await currentCode(h.totpSecret);

            const first = await h.app.request("/auth/mfa/challenge", post({ factorId: h.factorId }, pre));
            const firstId = (await first.json() as { challengeId: string }).challengeId;
            const accepted = await h.app.request("/auth/mfa/challenge/verify", post({ challengeId: firstId,
code }, pre));
            expect(accepted.status).toBe(200);
            expect(h.state.refreshTokens).toHaveLength(1);

            // Same digits, still inside the ±1 step window, fresh challenge.
            const second = await h.app.request("/auth/mfa/challenge", post({ factorId: h.factorId }, pre));
            const secondId = (await second.json() as { challengeId: string }).challengeId;
            const replay = await h.app.request("/auth/mfa/challenge/verify", post({ challengeId: secondId,
code }, pre));

            expect(replay.status).toBe(401);
            expect((await replay.json() as { error: { code: string } }).error.code).toBe("INVALID_CODE");
            // The replay bought no durable credential — that is what made it
            // worth doing.
            expect(h.state.refreshTokens).toHaveLength(1);
        });
    });

    // ── H2 ──────────────────────────────────────────────────────────────
    describe("a challenge cannot be guessed at without limit", () => {
        it("counts failures and refuses a spent challenge even with the right code", async () => {
            const h = createHarness({ uid: "h2-attempts",
enrolled: true });
            const pre = { Authorization: `Bearer ${await generateAccessToken("h2-attempts", ["editor"])}` };

            const opened = await h.app.request("/auth/mfa/challenge", post({ factorId: h.factorId }, pre));
            const challengeId = (await opened.json() as { challengeId: string }).challengeId;

            for (let i = 0; i < 5; i++) {
                const wrong = await h.app.request("/auth/mfa/challenge/verify", post({ challengeId,
code: "000000" }, pre));
                expect(wrong.status).toBe(401);
            }
            expect(h.state.challenges.get(challengeId)?.attempts).toBe(5);

            const withRealCode = await h.app.request(
                "/auth/mfa/challenge/verify",
                post({ challengeId,
code: await currentCode(h.totpSecret) }, pre)
            );

            expect(withRealCode.status).toBe(401);
            expect((await withRealCode.json() as { error: { code: string } }).error.code).toBe("CHALLENGE_EXHAUSTED");
            expect(h.state.refreshTokens).toHaveLength(0);
        });

        it("throttles verification per account, not per IP", async () => {
            // The limiter is keyed on the uid because an IP is the attacker's
            // to rotate: every request below carries a different forwarded
            // address, and they must still be counted together.
            const h = createHarness({ uid: "h2-limit",
enrolled: true });
            const pre = { Authorization: `Bearer ${await generateAccessToken("h2-limit", ["editor"])}` };

            const opened = await h.app.request("/auth/mfa/challenge", post({ factorId: h.factorId }, pre));
            const challengeId = (await opened.json() as { challengeId: string }).challengeId;

            const statuses: number[] = [];
            for (let i = 0; i < 12; i++) {
                const res = await h.app.request("/auth/mfa/challenge/verify", post(
                    { challengeId,
code: "000000" },
                    { ...pre,
"x-forwarded-for": `203.0.113.${i}` }
                ));
                statuses.push(res.status);
            }

            expect(statuses).toContain(429);
        });
    });
});
