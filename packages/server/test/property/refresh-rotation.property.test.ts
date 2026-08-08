/**
 * The refresh-token rotation state machine, driven as a state machine.
 *
 * The comments in `/refresh` are unusually specific about *sequences*: a client
 * that never received the answer, two tabs booting together, a response lost to
 * a deploy, a refresh in flight when a password reset lands. Every one of those
 * is a statement about what happens after several operations, and an
 * example-based test can only ever check the sequences someone wrote down.
 *
 * So this drives random sequences against a real in-memory store — not jest
 * mocks, because a mock returns what the previous line told it to and therefore
 * cannot have a state machine's bugs — and checks the invariants after **every**
 * step.
 *
 * The invariants are taken from the handler's own comments, which are the
 * closest thing to a specification this has:
 *
 *  - a revoked session is over, and none of its tokens authenticate;
 *  - a session that began before the user's revocation mark is void;
 *  - a superseded token inside the reuse window still works, and stays in the
 *    same session;
 *  - a superseded token outside the window is refused **without ending the
 *    session** — "punishing its holder for a late straggler is how a legitimate
 *    user gets signed out";
 *  - the live token of a live session always works. No accidental lockout.
 */

import fc from "fast-check";
import { Hono } from "hono";
import type { HonoEnv } from "../../src/api/types";
import { errorHandler } from "../../src/api/errors";
import { createAuthRoutes, type AuthModuleConfig } from "../../src/auth/routes";
import type { AuthRepository } from "../../src/auth/interfaces";
import { configureJwt, hashRefreshToken } from "../../src/auth/jwt";

jest.mock("../../src/auth/password");
jest.mock("../../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));
jest.mock("../../src/auth/rate-limiter", () => {
    const passthrough = async (_c: unknown, next: () => Promise<void>) => next();
    return { createRateLimiter: () => passthrough, defaultAuthLimiter: passthrough, strictAuthLimiter: passthrough };
});

const SECRET = "property-test-secret-key-that-is-definitely-32-chars-long!!";
const REUSE_WINDOW_SECONDS = 10;

interface Row {
    id: string;
    uid: string;
    sessionId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    sessionStartedAt: Date;
    rotatedAt: Date | null;
    revoked: boolean;
}

/**
 * A real store. Every method does what the Postgres one is specified to do,
 * including `pruneRefreshTokens`, which deletes rows — the operation most
 * likely to remove something another invariant still depends on, and therefore
 * the one worth modelling rather than stubbing away.
 */
class MemoryTokenStore {
    rows: Row[] = [];
    validAfter = new Map<string, Date>();
    private seq = 0;

    async createRefreshToken(
        uid: string, tokenHash: string, expiresAt: Date,
        _ua?: string, _ip?: string,
        session?: { id: string; startedAt: Date }
    ): Promise<void> {
        const id = `rt-${this.seq++}`;
        this.rows.push({
            id, uid, tokenHash, expiresAt,
            sessionId: session?.id ?? id,
            createdAt: new Date(),
            sessionStartedAt: session?.startedAt ?? new Date(),
            rotatedAt: null,
            revoked: false
        });
    }

    async findRefreshTokenByHash(hash: string): Promise<Row | null> {
        return this.rows.find(r => r.tokenHash === hash) ?? null;
    }

    async markRefreshTokenRotated(hash: string): Promise<void> {
        const row = this.rows.find(r => r.tokenHash === hash);
        if (row) row.rotatedAt = new Date();
    }

    async deleteRefreshToken(hash: string): Promise<void> {
        this.rows = this.rows.filter(r => r.tokenHash !== hash);
    }

    async revokeRefreshTokenSession(sessionId: string): Promise<void> {
        for (const r of this.rows) if (r.sessionId === sessionId) r.revoked = true;
    }

    async pruneRefreshTokens(uid: string, sessionId: string, supersededBefore: Date): Promise<void> {
        this.rows = this.rows.filter(r =>
            !(r.uid === uid && r.sessionId === sessionId && r.rotatedAt !== null && r.rotatedAt < supersededBefore));
    }

    async getTokensValidAfter(uid: string): Promise<Date | null> {
        return this.validAfter.get(uid) ?? null;
    }

    async setTokensValidAfter(uid: string, at: Date): Promise<void> {
        this.validAfter.set(uid, at);
    }
}

function buildApp(store: MemoryTokenStore) {
    const repo = {
        ...store,
        createRefreshToken: store.createRefreshToken.bind(store),
        findRefreshTokenByHash: store.findRefreshTokenByHash.bind(store),
        markRefreshTokenRotated: store.markRefreshTokenRotated.bind(store),
        deleteRefreshToken: store.deleteRefreshToken.bind(store),
        revokeRefreshTokenSession: store.revokeRefreshTokenSession.bind(store),
        pruneRefreshTokens: store.pruneRefreshTokens.bind(store),
        getTokensValidAfter: store.getTokensValidAfter.bind(store),
        setTokensValidAfter: store.setTokensValidAfter.bind(store),
        getUserRoles: async () => [{ id: "editor", name: "Editor", isAdmin: false }],
        getUserById: async (id: string) => ({
            id, email: "u@test.com", passwordHash: null, displayName: "U", photoUrl: null,
            emailVerified: true, emailVerificationToken: null, emailVerificationSentAt: null,
            createdAt: new Date(), updatedAt: new Date()
        }),
        listRefreshTokensForUser: async () => [],
        deleteAllRefreshTokensForUser: async () => undefined,
        deleteRefreshTokenById: async () => undefined
    } as unknown as AuthRepository;

    const config: AuthModuleConfig = {
        authRepo: repo,
        allowRegistration: true,
        refreshTokenReuseIntervalSeconds: REUSE_WINDOW_SECONDS
    } as AuthModuleConfig;

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes(config));
    return app;
}

/** POST /auth/refresh, returning the status and the new token when granted. */
async function refresh(app: Hono<HonoEnv>, token: string): Promise<{ status: number; token?: string; code?: string }> {
    const res = await app.request("/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: token })
    });
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    return {
        status: res.status,
        token: (body as { tokens?: { refreshToken?: string } }).tokens?.refreshToken,
        code: (body as { code?: string; error?: { code?: string } }).code
            ?? (body as { error?: { code?: string } }).error?.code
    };
}

beforeAll(() => {
    configureJwt({ secret: SECRET } as never);
});

describe("refresh rotation — invariants across random operation sequences", () => {

    /**
     * What the driver believes about a token it holds.
     *
     * `aged` is separate from `superseded` because the handler treats them
     * differently and the first version of this model did not — it expected a
     * replay to succeed after the window had passed, and the property failed on
     * its own bookkeeping rather than on the code. Worth recording: when a
     * stateful property fails, the model is the first suspect, not the second.
     */
    type State = "live" | "superseded" | "aged";
    interface Held { token: string; sessionId: string; state: State }

    const operations = fc.array(
        fc.constantFrom("refresh-live", "replay-superseded", "age-out", "revoke-session", "revoke-all"),
        { minLength: 3, maxLength: 14 }
    );

    it("holds every invariant after every step", async () => {
        await fc.assert(fc.asyncProperty(operations, fc.nat({ max: 8 }), async (ops, pick) => {
            const store = new MemoryTokenStore();
            const app = buildApp(store);

            // Two sessions for one user: one to act on, one that must survive
            // everything done to the other.
            await store.createRefreshToken("u1", hashRefreshToken("seed-a"), future(), "", "", { id: "sess-a", startedAt: new Date() });
            await store.createRefreshToken("u1", hashRefreshToken("seed-b"), future(), "", "", { id: "sess-b", startedAt: new Date() });

            const held: Held[] = [
                { token: "seed-a", sessionId: "sess-a", state: "live" },
                { token: "seed-b", sessionId: "sess-b", state: "live" }
            ];
            const deadSessions = new Set<string>();
            let allRevoked = false;

            /** What the handler must answer for a token, per the model. */
            const expected = (h: Held): number => {
                if (allRevoked) return 401;
                if (deadSessions.has(h.sessionId)) return 401;
                if (h.state === "aged") return 401;
                return 200; // live, or superseded but inside the reuse window
            };

            for (const op of ops) {
                if (op === "refresh-live" || op === "replay-superseded") {
                    const wanted: State = op === "refresh-live" ? "live" : "superseded";
                    const candidates = held.filter(h => h.state === wanted);
                    if (candidates.length === 0) continue;
                    const target = candidates[pick % candidates.length];

                    // Siblings that must be unaffected by whatever happens next.
                    const siblings = held.filter(h => h !== target && h.state !== "aged");

                    const res = await refresh(app, target.token);
                    await settle();
                    expect({ op, token: target.state, status: res.status })
                        .toEqual({ op, token: target.state, status: expected(target) });

                    if (res.status === 200) {
                        // A replay leaves the existing rotation stamp alone and
                        // adds a sibling: two tabs end up holding two live
                        // tokens of one session, deliberately.
                        if (target.state === "live") target.state = "superseded";
                        held.push({ token: res.token!, sessionId: target.sessionId, state: "live" });

                        // The straggler must not have signed anybody out.
                        for (const s of siblings) {
                            expect({ op, sibling: s.state, status: await peek(app, store, s.token) })
                                .toEqual({ op, sibling: s.state, status: expected(s) });
                        }
                    }

                } else if (op === "age-out") {
                    // Simulate the reuse window elapsing, by backdating the very
                    // stamp the handler compares against.
                    const past = new Date(Date.now() - (REUSE_WINDOW_SECONDS + 60) * 1000);
                    for (const row of store.rows) if (row.rotatedAt) row.rotatedAt = past;
                    for (const h of held) if (h.state === "superseded") h.state = "aged";

                } else if (op === "revoke-session") {
                    const victim = held.find(h => !deadSessions.has(h.sessionId));
                    if (!victim) continue;
                    await store.revokeRefreshTokenSession(victim.sessionId);
                    deadSessions.add(victim.sessionId);

                } else if (op === "revoke-all") {
                    // What a password reset does: every session that began
                    // before the mark is void, row or no row.
                    allRevoked = true;
                    await store.setTokensValidAfter("u1", new Date(Date.now() + 1000));
                }

                // ── Checked after EVERY step, for EVERY token ever issued ────
                //
                // This is the part an example test cannot do: not "the operation
                // I just performed did the right thing" but "nothing else moved".
                for (const h of held) {
                    expect({ op, token: h.state, session: h.sessionId, status: await peek(app, store, h.token) })
                        .toEqual({ op, token: h.state, session: h.sessionId, status: expected(h) });
                }
                assertNoDuplicateHashes(store);
                assertRevokedSessionsAreDead(store, deadSessions);
            }
        }), { numRuns: Number(process.env.FC_RUNS ?? 100) });
    }, 600_000);
});

// ── helpers ──────────────────────────────────────────────────────────

const future = () => new Date(Date.now() + 86_400_000);

/**
 * Let the handler's fire-and-forget housekeeping settle.
 *
 * `pruneRefreshTokens` is deliberately not awaited — rotation must not fail
 * because cleanup did — so without this it lands at an arbitrary point later
 * and mutates the store under whatever is running then. Harmless in production,
 * fatal to a test that snapshots rows.
 */
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

/**
 * Whether a token would be accepted, without consuming it.
 *
 * There is no read-only endpoint, so this really does refresh and then restores
 * the store from a snapshot. Restoring rather than reimplementing the decision
 * is the point: a local copy of the handler's rules would check this test
 * against itself instead of against the code.
 */
async function peek(app: Hono<HonoEnv>, store: MemoryTokenStore, token: string): Promise<number> {
    await settle();
    const snapshot = store.rows.map(r => ({ ...r }));
    const validAfter = new Map(store.validAfter);
    const res = await refresh(app, token);
    await settle();
    store.rows = snapshot;
    store.validAfter = validAfter;
    return res.status;
}

function assertNoDuplicateHashes(store: MemoryTokenStore): void {
    const hashes = store.rows.map(r => r.tokenHash);
    expect(new Set(hashes).size).toBe(hashes.length);
}

function assertRevokedSessionsAreDead(store: MemoryTokenStore, dead: Set<string>): void {
    for (const row of store.rows) {
        if (dead.has(row.sessionId)) {
            expect({ session: row.sessionId, revoked: row.revoked })
                .toEqual({ session: row.sessionId, revoked: true });
        }
    }
}
