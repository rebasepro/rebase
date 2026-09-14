import { describe, it, expect, beforeAll } from "@jest/globals";
import { Hono } from "hono";
import type { AuthCollectionConfig, CollectionConfig, DataDriver, EmailSendOptions, EmailService } from "@rebasepro/types";
import { createBuiltinAuthAdapter } from "../src/auth/builtin-auth-adapter";
import type { AuthHooks } from "../src/auth/auth-hooks";
import type { AuthRepository, UserData } from "../src/auth/interfaces";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const SECRET = "test-secret-for-admin-create-hook-delivery-0123456789";

/**
 * A create hook that delivers the new user's credentials is the only thing
 * that does, whichever door the user was created through.
 *
 * `prepareAdminUserValues` runs the collection's `auth.onCreateUser` or the
 * backend's `AuthHooks.onAdminCreateUser`, and reports three things: that the
 * hook owns delivery (`hookHandledEmail`), whether it sent an invitation, and
 * the temporary password it chose, if any. The collection REST path read all
 * three. `POST /admin/users` read none of them and called
 * `finalizeAdminUserCreation` with the hook's password as if the framework had
 * generated it. With email configured that minted a reset token and sent the
 * framework's own invitation — a second email after the hook's, carrying a
 * link that competes with the password the hook chose — and answered
 * `invitationSent: true` with no `temporaryPassword`, so the admin who has to
 * hand that password over never saw it. A hook that sent its own invitation
 * and returned no password was reported as `invitationSent: false`.
 *
 * Every case runs through both doors from one built-in adapter, the way a
 * backend wires them, and asserts on what leaves the mail service.
 */

const TEMP_PASSWORD = "Hook-Chosen-Pa55";
const HOOK_SUBJECT = "Welcome, from the hook";

/** What the hook does, and what the route must answer because of it. */
interface Scenario {
    name: string;
    hookSendsEmail: boolean;
    hookReturns: { temporaryPassword?: string; invitationSent?: boolean };
    expected: { invitationSent: boolean; temporaryPassword?: string };
}

const SCENARIOS: Scenario[] = [
    {
        name: "sends its own invitation",
        hookSendsEmail: true,
        hookReturns: { invitationSent: true },
        expected: { invitationSent: true }
    },
    {
        name: "sends its own invitation and returns the temporary password it put in it",
        hookSendsEmail: true,
        hookReturns: { invitationSent: true, temporaryPassword: TEMP_PASSWORD },
        expected: { invitationSent: true, temporaryPassword: TEMP_PASSWORD }
    },
    {
        name: "returns a temporary password and sends nothing",
        hookSendsEmail: false,
        hookReturns: { temporaryPassword: TEMP_PASSWORD },
        expected: { invitationSent: false, temporaryPassword: TEMP_PASSWORD }
    }
];

type HookKind = "collection auth.onCreateUser" | "backend AuthHooks.onAdminCreateUser";
const HOOK_KINDS: HookKind[] = ["collection auth.onCreateUser", "backend AuthHooks.onAdminCreateUser"];

function hookEmail(to: unknown): { to: string; subject: string; html: string } {
    return { to: String(to), subject: HOOK_SUBJECT, html: "<p>Your account is ready.</p>" };
}

async function harness(kind: HookKind, scenario: Scenario) {
    const sent: EmailSendOptions[] = [];
    const emailService: EmailService = {
        isConfigured: () => true,
        send: async (options) => {
            sent.push(options);
            return { messageId: `m-${sent.length}` };
        }
    };

    // A reset token is what the framework's invitation links to. Minting one
    // for a user whose hook chose a password leaves a second, live credential.
    const resetTokensMinted: string[] = [];
    const admin = (id: string): UserData =>
        ({ id, email: `${id}@test.com`, createdAt: new Date(), updatedAt: new Date() }) as UserData;
    const repo = {
        getUserByEmail: async () => null,
        getUserById: async (id: string) => admin(id),
        getUserRoleIds: async () => ["admin"],
        setUserRoles: async () => undefined,
        createUser: async (data: { email: string }) => ({ ...admin("admin-door-user"), ...data }),
        createPasswordResetToken: async (userId: string) => { resetTokensMinted.push(userId); }
    } as unknown as AuthRepository;

    const values = (body: Record<string, unknown>) => ({ email: body.email, passwordHash: "hash-set-by-hook" });

    let collectionAuthConfig: AuthCollectionConfig | undefined;
    let authHooks: AuthHooks | undefined;
    if (kind === "collection auth.onCreateUser") {
        collectionAuthConfig = {
            enabled: true,
            onCreateUser: async (body, ctx) => {
                if (scenario.hookSendsEmail) await ctx.sendEmail!(hookEmail(body.email));
                return { values: values(body), ...scenario.hookReturns };
            }
        };
    } else {
        authHooks = {
            onAdminCreateUser: async (body, ctx) => {
                if (scenario.hookSendsEmail) await ctx.emailService!.send(hookEmail(body.email));
                return { values: values(body), ...scenario.hookReturns };
            }
        };
    }

    const adapter = createBuiltinAuthAdapter({
        authRepository: repo,
        emailService,
        emailConfig: { from: "noreply@example.com", resetPasswordUrl: "https://app.example.com", appName: "Acme" },
        authHooks,
        collectionAuthConfig
    });

    const driver = {
        save: async ({ values: row }: { values: Record<string, unknown> }) => ({ id: "rest-door-user", ...row })
    } as unknown as DataDriver;
    const usersCollection = {
        slug: "users",
        name: "Users",
        singularName: "User",
        auth: collectionAuthConfig ?? true,
        properties: {}
    } as CollectionConfig;

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    const adminRoutes = adapter.createAdminRoutes?.();
    if (!adminRoutes) throw new Error("the built-in adapter mounts admin routes");
    app.mount("/api/admin", request => adminRoutes.fetch(request));
    app.use("/api/data/*", async (c, next) => {
        c.set("driver", driver);
        await next();
    });
    app.route("/api/data", new RestApiGenerator([usersCollection], driver, adapter).generateRoutes());

    const token = await generateAccessToken("admin-1", ["admin"]);
    const post = (path: string) => app.request(path, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "invitee@example.com", displayName: "Ada" })
    });

    return { post, sent, resetTokensMinted };
}

const DOORS = [
    { name: "POST /api/admin/users", path: "/api/admin/users" },
    { name: "POST /api/data/users (the collection REST path)", path: "/api/data/users" }
];

describe("a create hook that delivers credentials is the only thing that does", () => {
    beforeAll(() => configureJwt({ secret: SECRET, accessExpiresIn: "1h" }));

    describe.each(DOORS)("$name", ({ path }) => {
        describe.each(HOOK_KINDS)("%s", (kind) => {
            it.each(SCENARIOS)("when the hook $name", async (scenario) => {
                const { post, sent, resetTokensMinted } = await harness(kind, scenario);

                const res = await post(path);
                expect(res.status).toBe(201);
                const body = await res.json() as Record<string, unknown>;

                // What the hook reported, and nothing the framework made up
                // after it: no invitation of its own, and no reset token for
                // one to link to.
                expect(sent.map(email => email.subject))
                    .toEqual(scenario.hookSendsEmail ? [HOOK_SUBJECT] : []);
                expect(resetTokensMinted).toEqual([]);

                expect(body.invitationSent).toBe(scenario.expected.invitationSent);
                // The password the hook chose is the one the user will be
                // told, so it is the one the admin has to see.
                expect(body.temporaryPassword).toBe(scenario.expected.temporaryPassword);
                expect(body.emailDeliveryFailed).toBeUndefined();
            });
        });
    });
});
