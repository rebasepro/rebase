import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import type { AuthAdapter, DataDriver } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";
import { tablesFromCollections } from "./helpers/tables";

/** An adapter that is only the user-creation half the routes call; it authenticates nobody. */
function creationAdapter(members: Partial<AuthAdapter>): AuthAdapter {
    return {
        id: "test-adapter",
        verifyRequest: async () => null,
        getCapabilities: () => {
            throw new Error("the data routes never ask");
        },
        ...members
    };
}

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
    const users: LegacyCollectionConfig = {
        slug: "users",
        name: "Users",
        table: "users",
        auth: true,
        properties: {
            email: { type: "string" },
            displayName: { type: "string" }
        }
    };

    let save: jest.Mock<DataDriver["save"]>;
    let mockDriver: DataDriver;

    // A minimal adapter that behaves like the built-in one: it consumes
    // `password` and nothing else, and maps the rest onto columns as-is.
    const builtinLikeAdapter: AuthAdapter = creationAdapter({
        describeUserCreationContract: () => ({ validate: true, extraFields: ["password"] }),
        async prepareUserCreation(values: Record<string, unknown>) {
            const { password, ...rest } = values;
            void password;
            return { values: { ...rest, passwordHash: "hashed" }, hookHandledEmail: false, invitationSent: false };
        },
        async finalizeUserCreation() {
            return { invitationSent: false };
        }
    });

    const createApp = (adapter: AuthAdapter = builtinLikeAdapter) => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", mockDriver);
            await next();
        });
        const generator = new RestApiGenerator(tablesFromCollections([users]), mockDriver, adapter);
        app.route("/", generator.generateRoutes());
        return app;
    };

    beforeEach(() => {
        save = jest.fn<DataDriver["save"]>(async () => ({ id: "u1", email: "a@b.com", displayName: "A" }));
        mockDriver = fakeDataDriver({ save });
    });

    const post = (app: Hono<HonoEnv>, body: unknown) =>
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
        expect(save).not.toHaveBeenCalled();
    });

    it("lets the credential field `password` through even though it is not a column", async () => {
        const res = await post(createApp(), { email: "a@b.com", displayName: "A", password: "secret12" });

        expect(res.status).toBe(201);
        expect(save).toHaveBeenCalled();
        // The adapter consumed `password`; the row carries the hash, not the raw field.
        const saved = save.mock.calls[0][0].values;
        expect(saved).not.toHaveProperty("password");
        expect(saved).toHaveProperty("passwordHash");
    });

    it("still skips the check when the adapter opts out (custom onCreateUser hook)", async () => {
        const optOut: AuthAdapter = {
            ...builtinLikeAdapter,
            describeUserCreationContract: () => ({ validate: false, extraFields: [] })
        };
        const res = await post(createApp(optOut), { anything_goes: true, password: "secret12" });

        expect(res.status).toBe(201);
        expect(save).toHaveBeenCalled();
    });

    it("skips the check when no adapter describes a contract (pre-existing behaviour)", async () => {
        const noContract = creationAdapter({
            async prepareUserCreation(values: Record<string, unknown>) {
                return { values, hookHandledEmail: false, invitationSent: false };
            },
            async finalizeUserCreation() {
                return { invitationSent: false };
            }
        });
        const res = await post(createApp(noContract), { emial: "a@b.com" });

        expect(res.status).toBe(201);
    });
});
