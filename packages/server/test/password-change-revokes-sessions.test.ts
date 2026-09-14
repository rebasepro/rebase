import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { AuthAdapter, AuthCollectionConfig } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createBuiltinAuthAdapter, type BuiltinAuthAdapterConfig } from "../src/auth/builtin-auth-adapter";
import { hashToken } from "../src/auth/admin-user-ops";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken, generateRefreshToken, getRefreshTokenExpiry, hashRefreshToken } from "../src/auth/jwt";

/**
 * Setting a password on an existing account ends every session it holds.
 *
 * The self-service reset and change-password always did this. The admin reset
 * route — all of its branches — and `PUT /admin/users/:uid` did not, and they
 * are the ones an administrator reaches for when an account has been phished:
 * the password changed, and the attacker's refresh token went on minting access
 * tokens for the rest of its 30-day life. Both admin and victim believed the
 * account was recovered.
 *
 * So the subject here is the *feature*, not a route: every way a password can be
 * set on someone's account is in `CASES`, each is driven through the adapter a
 * real backend is built from, and each is held to the same outcome. A route
 * that already worked and a route that did not look identical from inside
 * either one; only the list makes the difference visible.
 *
 * The store is a real one rather than jest mocks, for the reason
 * `refresh-rotation.property.test.ts` gives: a mock returns what the previous
 * line told it to, so it cannot tell a revoked session from a live one.
 */

// Every refused refresh and the deliberate 500 below would otherwise be logged.
jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const SECRET = "password-change-revocation-secret-key-at-least-32-chars";

const VICTIM = "victim-1";
const BYSTANDER = "bystander-1";
const ADMIN = "admin-1";
const ORIGINAL_PASSWORD = "Original-Passw0rd";
const NEW_PASSWORD = "Chosen-N3w-Passw0rd";
/**
 * The shape the documented `onResetPassword` example produces. It fails the
 * default strength rules, deliberately: those judge what an admin types, and a
 * hook is the developer's own server code choosing on their behalf.
 */
const HOOK_PASSWORD = "reset_k3j9x2";

/** A readable, instant stand-in for scrypt, so a test can say which password is stored. */
const hash = (password: string) => `hashed:${password}`;
const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => hash(password),
    verifyPassword: async (password: string, stored: string) => stored === hash(password)
};

interface StoredUser {
    id: string;
    email: string;
    displayName: string | null;
    passwordHash: string | null;
    roles: string[];
}

interface RefreshRow {
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
 * An auth store that keeps state, covering what these routes touch.
 *
 * `watermark: false` is a repository that does not implement
 * `get/setTokensValidAfter` — which is what the MongoDB driver is today. On it
 * the deleted refresh rows are the whole of the revocation, so running every
 * case on both shapes is what holds each half of `revokeAllSessions` to
 * account: with the watermark, a session whose rows survived would still be
 * refused on refresh, and a missing delete would go unnoticed.
 */
class MemoryAuthStore {
    users = new Map<string, StoredUser>();
    rows: RefreshRow[] = [];
    validAfter = new Map<string, Date>();
    resetTokens = new Map<string, { uid: string; expiresAt: Date; used: boolean }>();
    failTokenMint = false;
    private seq = 0;

    constructor(private readonly watermark: boolean) {}

    addUser(id: string, roles: string[], password = ORIGINAL_PASSWORD): void {
        this.users.set(id, { id, email: `${id}@example.test`, displayName: id, passwordHash: hash(password), roles });
    }

    private toUserData(user: StoredUser): UserData {
        return {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            passwordHash: user.passwordHash,
            photoUrl: null,
            emailVerified: true,
            createdAt: new Date(0),
            updatedAt: new Date()
        };
    }

    repo(): AuthRepository {
        const repo: Partial<AuthRepository> = {
            getUserById: async (id) => {
                const user = this.users.get(id);
                return user ? this.toUserData(user) : null;
            },
            getUserRoleIds: async (uid) => this.users.get(uid)?.roles ?? [],
            getUserRoles: async (uid) => (this.users.get(uid)?.roles ?? [])
                .map(id => ({ id, name: id, isAdmin: id === "admin" })),
            getUserWithRoles: async (uid) => {
                const user = this.users.get(uid);
                return user
                    ? { user: this.toUserData(user), roles: user.roles.map(id => ({ id, name: id, isAdmin: id === "admin" })) }
                    : null;
            },
            // Writes whatever it is handed, `passwordHash` included — so a route
            // that sets a password this way still changes it, and is caught by
            // what it failed to revoke rather than by the store refusing.
            updateUser: async (id, data) => {
                const user = this.users.get(id);
                if (!user) return null;
                if (data.email !== undefined) user.email = data.email;
                if (data.displayName !== undefined) user.displayName = data.displayName;
                if (data.passwordHash !== undefined) user.passwordHash = data.passwordHash;
                return this.toUserData(user);
            },
            updatePassword: async (id, passwordHash) => {
                const user = this.users.get(id);
                if (user) user.passwordHash = passwordHash;
            },

            createRefreshToken: async (uid, tokenHash, expiresAt, _ua, _ip, session) => {
                this.insertRow(uid, tokenHash, expiresAt, session?.startedAt ?? new Date(), session?.id);
            },
            findRefreshTokenByHash: async (tokenHash) => this.rows.find(r => r.tokenHash === tokenHash) ?? null,
            markRefreshTokenRotated: async (tokenHash) => {
                const row = this.rows.find(r => r.tokenHash === tokenHash);
                if (row) row.rotatedAt = new Date();
            },
            deleteRefreshToken: async (tokenHash) => {
                this.rows = this.rows.filter(r => r.tokenHash !== tokenHash);
            },
            deleteAllRefreshTokensForUser: async (uid) => {
                this.rows = this.rows.filter(r => r.uid !== uid);
            },
            pruneRefreshTokens: async () => undefined,

            createPasswordResetToken: async (uid, tokenHash, expiresAt) => {
                if (this.failTokenMint) throw new Error("connection terminated unexpectedly");
                this.resetTokens.set(tokenHash, { uid, expiresAt, used: false });
            },
            findValidPasswordResetToken: async (tokenHash) => {
                const token = this.resetTokens.get(tokenHash);
                return token && !token.used && token.expiresAt > new Date()
                    ? { uid: token.uid, expiresAt: token.expiresAt }
                    : null;
            },
            markPasswordResetTokenUsed: async (tokenHash) => {
                const token = this.resetTokens.get(tokenHash);
                if (token) token.used = true;
            }
        };
        if (this.watermark) {
            repo.getTokensValidAfter = async (uid) => this.validAfter.get(uid) ?? null;
            repo.setTokensValidAfter = async (uid, at) => {
                this.validAfter.set(uid, at);
            };
        }
        return repo as AuthRepository;
    }

    insertRow(uid: string, tokenHash: string, expiresAt: Date, sessionStartedAt: Date, sessionId?: string): void {
        const id = `rt-${this.seq++}`;
        this.rows.push({
            id, uid, tokenHash, expiresAt, sessionStartedAt,
            sessionId: sessionId ?? id,
            createdAt: new Date(),
            rotatedAt: null,
            revoked: false
        });
    }
}

interface Session {
    accessToken: string;
    refreshToken: string;
}

/**
 * A session that began a minute ago — the stolen one.
 *
 * The minute matters. `iat` is whole seconds, and a token minted in the same
 * second as the watermark is not "before" it (see `token-revocation.test.ts`),
 * so a session opened and revoked inside one test would survive for a reason
 * that has nothing to do with the code under test. A real stolen session is
 * older than the reset; this one is too.
 */
async function sessionFromAMinuteAgo(store: MemoryAuthStore, uid: string): Promise<Session> {
    const startedAt = Date.now() - 60_000;
    const clock = jest.spyOn(Date, "now").mockReturnValue(startedAt);
    let accessToken: string;
    try {
        accessToken = await generateAccessToken(uid, store.users.get(uid)!.roles);
    } finally {
        clock.mockRestore();
    }
    const refreshToken = generateRefreshToken();
    store.insertRow(uid, await hashRefreshToken(refreshToken), getRefreshTokenExpiry(), new Date(startedAt));
    return { accessToken, refreshToken };
}

interface World {
    store: MemoryAuthStore;
    adapter: AuthAdapter;
    app: Hono<HonoEnv>;
    /** A request as the administrator. */
    asAdmin: (method: string, url: string, body?: unknown) => Promise<Response>;
}

async function buildWorld(watermark: boolean, config: Partial<BuiltinAuthAdapterConfig> = {}): Promise<World> {
    const store = new MemoryAuthStore(watermark);
    store.addUser(VICTIM, ["editor"]);
    store.addUser(BYSTANDER, ["editor"]);
    store.addUser(ADMIN, ["admin"]);

    const adapter = createBuiltinAuthAdapter({
        authRepository: store.repo(),
        authHooks: HOOKS,
        ...config
    });
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", adapter.createAuthRoutes!()!);
    app.route("/admin", adapter.createAdminRoutes!()!);

    const adminToken = await generateAccessToken(ADMIN, ["admin"]);
    const asAdmin = (method: string, url: string, body?: unknown) => Promise.resolve(app.request(url, {
        method,
        headers: { "Authorization": `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
    }));
    return { store, adapter, app, asAdmin };
}

/** `POST /auth/refresh` with this token, as the holder of a stolen one would. */
async function refreshStatus(world: World, refreshToken: string): Promise<number> {
    const res = await world.app.request("/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
    });
    return res.status;
}

/** Whether the data plane would take this access token — the adapter's own check. */
async function accessTokenAccepted(world: World, accessToken: string): Promise<boolean> {
    const user = await world.adapter.verifyRequest!(new Request("https://example.test/api/data/posts", {
        headers: { authorization: `Bearer ${accessToken}` }
    }));
    return user !== null;
}

const workingMail = () => ({ isConfigured: () => true, send: jest.fn(async () => ({})) });
const failingMail = () => ({
    isConfigured: () => true,
    send: jest.fn(async () => {
        throw new Error("SMTP 421 try again later");
    })
});
const EMAIL_CONFIG = { from: "noreply@example.test", resetPasswordUrl: "https://app.example.test" };

interface Case {
    name: string;
    config?: () => Partial<BuiltinAuthAdapterConfig>;
    /**
     * Set the victim's password by this route. Resolves with the password it
     * set, or `undefined` when it sets none (an emailed link, a hook that sends
     * its own) — in which case the stored one must be left exactly as it was.
     */
    act: (world: World) => Promise<string | undefined>;
}

async function expectOk(res: Response): Promise<Record<string, unknown>> {
    const body = await res.json() as Record<string, unknown>;
    expect({ status: res.status, body }).toEqual({ status: 200, body: expect.anything() });
    return body;
}

const adminReset = (body?: unknown) => async (world: World) => {
    const res = await world.asAdmin("POST", `/admin/users/${VICTIM}/reset-password`, body);
    return (await expectOk(res)).temporaryPassword as string | undefined;
};

const CASES: Case[] = [
    {
        name: "admin reset, setting the password directly",
        act: async (world) => {
            await adminReset({ password: NEW_PASSWORD })(world);
            return NEW_PASSWORD;
        }
    },
    {
        name: "admin reset, no email service (temporary password)",
        act: async (world) => {
            const temporaryPassword = await adminReset()(world);
            expect(typeof temporaryPassword).toBe("string");
            return temporaryPassword;
        }
    },
    {
        name: "admin reset, email configured but the send fails (temporary password)",
        config: () => ({ emailService: failingMail() as never, emailConfig: EMAIL_CONFIG }),
        act: async (world) => {
            const temporaryPassword = await adminReset()(world);
            expect(typeof temporaryPassword).toBe("string");
            return temporaryPassword;
        }
    },
    {
        // No password is written until the user opens the link — which is
        // exactly the window the attacker must not be left in.
        name: "admin reset, reset link emailed",
        config: () => ({ emailService: workingMail() as never, emailConfig: EMAIL_CONFIG }),
        act: async (world) => {
            expect(await adminReset()(world)).toBeUndefined();
            return undefined;
        }
    },
    {
        name: "admin reset, a collection onResetPassword hook that sends its own link",
        config: () => ({
            collectionAuthConfig: {
                enabled: true,
                onResetPassword: async () => ({ invitationSent: true })
            } satisfies AuthCollectionConfig
        }),
        act: async (world) => {
            await adminReset()(world);
            return undefined;
        }
    },
    {
        // The documented example's shape. Its context has `hashPassword` and
        // no way to store anything, so the route is the only thing that can
        // make the password it shows the admin a real one.
        name: "admin reset, a collection onResetPassword hook returning a temporary password",
        config: () => ({
            collectionAuthConfig: {
                enabled: true,
                onResetPassword: async () => ({ temporaryPassword: HOOK_PASSWORD, invitationSent: false })
            } satisfies AuthCollectionConfig
        }),
        act: async (world) => {
            expect(await adminReset()(world)).toBe(HOOK_PASSWORD);
            return HOOK_PASSWORD;
        }
    },
    {
        name: "admin reset, an onAdminResetPassword hook that sends its own link",
        config: () => ({ authHooks: { ...HOOKS, onAdminResetPassword: async () => ({ invitationSent: true }) } }),
        act: async (world) => {
            await adminReset()(world);
            return undefined;
        }
    },
    {
        // This hook is handed `authRepo` and could write the password itself;
        // it is held to the same contract as the collection hook, so whether it
        // remembered to is not the difference between a working password and
        // a dead one.
        name: "admin reset, an onAdminResetPassword hook returning a temporary password",
        config: () => ({
            authHooks: { ...HOOKS, onAdminResetPassword: async () => ({ temporaryPassword: HOOK_PASSWORD, invitationSent: false }) }
        }),
        act: async (world) => {
            expect(await adminReset()(world)).toBe(HOOK_PASSWORD);
            return HOOK_PASSWORD;
        }
    },
    {
        name: "PUT /admin/users/:uid with a password",
        act: async (world) => {
            await expectOk(await world.asAdmin("PUT", `/admin/users/${VICTIM}`, { password: NEW_PASSWORD }));
            return NEW_PASSWORD;
        }
    },
    {
        name: "userManagement.updateUser with a password",
        act: async (world) => {
            await world.adapter.userManagement!.updateUser(VICTIM, { password: NEW_PASSWORD });
            return NEW_PASSWORD;
        }
    },
    {
        name: "self-service reset (POST /auth/reset-password)",
        act: async (world) => {
            const token = "emailed-reset-token";
            world.store.resetTokens.set(hashToken(token), { uid: VICTIM, expiresAt: new Date(Date.now() + 3_600_000), used: false });
            await expectOk(await world.app.request("/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password: NEW_PASSWORD })
            }));
            return NEW_PASSWORD;
        }
    },
    {
        name: "change-password (POST /auth/change-password)",
        act: async (world) => {
            // The victim, signed in on their own device, not the stolen session.
            const ownToken = await generateAccessToken(VICTIM, ["editor"]);
            await expectOk(await world.app.request("/auth/change-password", {
                method: "POST",
                headers: { "Authorization": `Bearer ${ownToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ oldPassword: ORIGINAL_PASSWORD, newPassword: NEW_PASSWORD })
            }));
            return NEW_PASSWORD;
        }
    }
];

beforeAll(() => {
    configureJwt({ secret: SECRET, accessExpiresIn: "1h" });
});

describe.each([
    ["with the revocation watermark (Postgres)", true],
    ["without the watermark (MongoDB)", false]
])("a password set on an existing account, %s", (_label, watermark) => {
    it.each(CASES.map(c => [c.name, c] as const))("%s: ends the account's sessions", async (_name, testCase) => {
        const world = await buildWorld(watermark, testCase.config?.());
        const stolen = await sessionFromAMinuteAgo(world.store, VICTIM);
        const bystander = await sessionFromAMinuteAgo(world.store, BYSTANDER);

        // Precondition, or the refusals below would prove nothing.
        expect(await accessTokenAccepted(world, stolen.accessToken)).toBe(true);

        const setPassword = await testCase.act(world);

        // The route really did what it was asked: the password is the new one,
        // or — for a link or a hook — untouched.
        expect(world.store.users.get(VICTIM)!.passwordHash).toBe(hash(setPassword ?? ORIGINAL_PASSWORD));

        // The stolen refresh token no longer mints anything.
        expect(await refreshStatus(world, stolen.refreshToken)).toBe(401);
        if (watermark) {
            // And the access token it already minted is refused — without the
            // watermark nothing can reach an access token before it expires,
            // which is the MongoDB driver's standing limit, not this route's.
            expect(await accessTokenAccepted(world, stolen.accessToken)).toBe(false);
        }

        // The control. Someone else's session survives, so the assertions above
        // cannot be passing because this world refuses everything.
        expect(await refreshStatus(world, bystander.refreshToken)).toBe(200);
        expect(await accessTokenAccepted(world, bystander.accessToken)).toBe(true);
    });
});

describe("admin reset, when minting the reset token fails", () => {
    it("answers 500 and leaves the password alone, rather than issuing a new one", async () => {
        // The mint used to share a `try` with the SMTP send, so a database error
        // took the send-failed branch: a fresh password was written, returned
        // as a "temporary password", and the user's own stopped working — for
        // an operation that had failed.
        const mail = workingMail();
        const world = await buildWorld(true, { emailService: mail as never, emailConfig: EMAIL_CONFIG });
        world.store.failTokenMint = true;

        const res = await world.asAdmin("POST", `/admin/users/${VICTIM}/reset-password`);
        const body = await res.json() as Record<string, unknown>;

        expect(res.status).toBe(500);
        expect(body.temporaryPassword).toBeUndefined();
        expect(world.store.users.get(VICTIM)!.passwordHash).toBe(hash(ORIGINAL_PASSWORD));
        expect(mail.send).not.toHaveBeenCalled();
    });
});

/**
 * The list above holds every route that exists today. These hold the next one.
 *
 * A password reaches the database through one of two repository calls:
 * `updatePassword`, or `updateUser` with a `passwordHash` in it. The first
 * must go through `replaceUserPassword`; the second must not happen on an
 * existing account at all. Both admin-side misses were the second shape —
 * `updates.passwordHash = …` and `updateData.passwordHash = …`, each followed a
 * few lines later by `updateUser(uid, updates)` — so that shape is checked
 * directly, alongside the call itself.
 */
describe("nothing writes a password except replaceUserPassword", () => {
    const SRC = path.resolve(__dirname, "../src");
    const files = (readdirSync(SRC, { recursive: true }) as string[])
        .filter(f => f.endsWith(".ts") && !f.endsWith(".d.ts"))
        .map(f => ({ file: f.split(path.sep).join("/"), source: readFileSync(path.join(SRC, f), "utf8") }));

    /** The argument text of every call to `callee`, by matching parentheses. */
    function argumentsOf(source: string, callee: string): string[] {
        const found: string[] = [];
        let from = 0;
        for (;;) {
            const at = source.indexOf(`${callee}(`, from);
            if (at === -1) return found;
            const open = at + callee.length;
            let depth = 0;
            let i = open;
            for (; i < source.length; i++) {
                if (source[i] === "(") depth++;
                else if (source[i] === ")" && --depth === 0) break;
            }
            found.push(source.slice(open + 1, i));
            from = i;
        }
    }

    it("reads a real source tree", () => {
        // A vacuity floor: a wrong path would make both checks below pass on
        // an empty list.
        expect(files.length).toBeGreaterThan(50);
        expect(files.some(f => f.file === "auth/token-revocation.ts")).toBe(true);
    });

    it("only replaceUserPassword calls updatePassword", () => {
        const callers = files.filter(f => f.source.includes(".updatePassword(")).map(f => f.file);
        expect(callers).toEqual(["auth/token-revocation.ts"]);
    });

    it("no updateUser call carries a password hash", () => {
        const offenders = files
            .filter(f => argumentsOf(f.source, ".updateUser").some(args => args.includes("passwordHash")))
            .map(f => f.file);
        // The one deliberate exception: `/anonymous/link` puts the FIRST
        // credential on a guest account. There is no earlier password for
        // anyone to have stolen, and the route mints the caller a new session
        // in the same request.
        expect(offenders).toEqual(["auth/session-routes.ts"]);
    });

    it("no code adds a password hash to an object after building it", () => {
        const offenders = files.filter(f => /\.passwordHash\s*=(?!=)/.test(f.source)).map(f => f.file);
        // `prepareAdminUserValues`, building the values for a NEW account,
        // which `createUser` inserts. There is no session to end.
        expect(offenders).toEqual(["auth/admin-user-ops.ts"]);
    });
});
