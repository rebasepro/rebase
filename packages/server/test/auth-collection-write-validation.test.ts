import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import { CollectionConfig, AuthAdapter } from "@rebasepro/types";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";

/**
 * A create on an auth collection used to skip unknown-field validation
 * *entirely*: the body carries `password` (which the users table does not
 * declare as a column), so the check was disabled wholesale. The cost was that
 * a genuine typo — `emial` — was silently dropped and the write still answered
 * 201, while the same typo on a normal collection was a 400. The CHANGELOG
 * promised the latter without the carve-out.
 *
 * The fix narrows the exemption to exactly the fields the auth adapter consumes,
 * via `describeUserCreationContract`. These drive real requests through the
 * routes so the wiring is exercised, not just the helper.
 */
describe("auth-collection creates still reject unknown fields", () => {
    const users: CollectionConfig = {
        slug: "users",
        name: "Users",
        table: "users",
        auth: true,
        properties: {
            email: { type: "string" },
            displayName: { type: "string" }
        }
    } as CollectionConfig;

    let mockDriver: Record<string, jest.Mock>;

    // A minimal adapter that behaves like the built-in one: it consumes
    // `password` and nothing else, and maps the rest onto columns as-is.
    const builtinLikeAdapter: Partial<AuthAdapter> = {
        describeUserCreationContract: () => ({ validate: true, extraFields: ["password"] }),
        async prepareUserCreation(values: Record<string, unknown>) {
            const { password, ...rest } = values;
            void password;
            return { values: { ...rest, passwordHash: "hashed" }, hookHandledEmail: false, invitationSent: false };
        },
        async finalizeUserCreation() {
            return { invitationSent: false };
        }
    };

    const createApp = (adapter: Partial<AuthAdapter> = builtinLikeAdapter) => {
        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", mockDriver);
            await next();
        });
        const generator = new RestApiGenerator([users], mockDriver as never, adapter as AuthAdapter);
        app.route("/", generator.generateRoutes());
        return app;
    };

    beforeEach(() => {
        mockDriver = {
            save: jest.fn(async () => ({ id: "u1", email: "a@b.com", displayName: "A" }))
        } as never;
    });

    const post = (app: Hono, body: unknown) =>
        app.fetch(new Request("http://localhost/users", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        }));

    it("400s a signup with a typo'd field, and does not write", async () => {
        const res = await post(createApp(), { emial: "a@b.com", password: "secret12" });

        expect(res.status).toBe(400);
        const body = await res.json() as { error: { message: string; code: string } };
        expect(body.error.code).toBe("VALIDATION_UNKNOWN_FIELDS");
        expect(body.error.message).toContain("'emial'");
        expect(mockDriver.save).not.toHaveBeenCalled();
    });

    it("lets the credential field `password` through even though it is not a column", async () => {
        const res = await post(createApp(), { email: "a@b.com", displayName: "A", password: "secret12" });

        expect(res.status).toBe(201);
        expect(mockDriver.save).toHaveBeenCalled();
        // The adapter consumed `password`; the row carries the hash, not the raw field.
        const saved = (mockDriver.save.mock.calls[0][0] as { values: Record<string, unknown> }).values;
        expect(saved).not.toHaveProperty("password");
        expect(saved).toHaveProperty("passwordHash");
    });

    it("still skips the check when the adapter opts out (custom onCreateUser hook)", async () => {
        const optOut: Partial<AuthAdapter> = {
            ...builtinLikeAdapter,
            describeUserCreationContract: () => ({ validate: false, extraFields: [] })
        };
        const res = await post(createApp(optOut), { anything_goes: true, password: "secret12" });

        expect(res.status).toBe(201);
        expect(mockDriver.save).toHaveBeenCalled();
    });

    it("skips the check when no adapter describes a contract (pre-existing behaviour)", async () => {
        const noContract: Partial<AuthAdapter> = {
            async prepareUserCreation(values: Record<string, unknown>) {
                return { values, hookHandledEmail: false, invitationSent: false };
            },
            async finalizeUserCreation() {
                return { invitationSent: false };
            }
        };
        const res = await post(createApp(noContract), { emial: "a@b.com" });

        expect(res.status).toBe(201);
    });
});
