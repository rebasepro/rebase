import { describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import type { AuthAdapter, AuthenticatedUser } from "@rebasepro/types";

import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";
import { partialAuthRepository, storedUser } from "./helpers/server-a-g3-auth-repository";

/**
 * `AuthenticatedUser.isAdmin` is informational: every authorization decision
 * reads `roles`, and an adapter that wants an administrator gives the `admin`
 * role. A project's own adapter answered `isAdmin: true` with the roles
 * `super_admin` and `dev` and no `admin`. Its tables were all admin-only, so
 * `GET /schema/tables` described none of them to any staff token, and the
 * panel would have listed nothing — with nothing in the log to say why.
 *
 * The server now says so, once per process, the first time an adapter hands it
 * such a user: the role list it saw (never who the user is), that `isAdmin` is
 * informational, and the two ways out.
 *
 * The warning is said once per process, so each test loads the modules fresh:
 * a registry where it has not been said yet.
 */

interface Fresh {
    middleware: typeof import("../src/auth/adapter-middleware");
    builtin: typeof import("../src/auth/builtin-auth-adapter");
    warn: jest.SpiedFunction<(message: string, data?: Record<string, unknown>) => void>;
}

function fresh(): Fresh {
    let middleware: Fresh["middleware"] | undefined;
    let builtin: Fresh["builtin"] | undefined;
    let logger: typeof import("../src/utils/logger").logger | undefined;
    jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        middleware = require("../src/auth/adapter-middleware");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        builtin = require("../src/auth/builtin-auth-adapter");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        logger = require("../src/utils/logger").logger;
    });
    if (!middleware || !builtin || !logger) throw new Error("isolateModules did not load the modules");
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    return { middleware, builtin, warn };
}

/** An adapter that answers every request carrying a bearer with `user`. */
function adapterAnswering(user: AuthenticatedUser): AuthAdapter {
    return {
        id: "project-adapter",
        getCapabilities() {
            throw new Error("the middleware under test never asks");
        },
        async verifyRequest(request: Request) {
            return request.headers.get("authorization") ? user : null;
        }
    };
}

/** The doors that ask an adapter: the caller resolution `/schema/tables` uses, and the data plane's middleware. */
function doors({ middleware }: Fresh, adapter: AuthAdapter): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>();
    app.use("/schema/*", middleware.createAdapterCallerResolution(adapter).require);
    app.use("/data/*", middleware.createAdapterAuthMiddleware({ adapter, driver: fakeDataDriver() }));
    app.get("/schema/tables", (c) => c.json([]));
    app.get("/data/posts", (c) => c.json({ ok: true }));
    return app;
}

const bearer = (token = "staff-token") => ({ headers: { Authorization: `Bearer ${token}` } });

const staff: AuthenticatedUser = {
    uid: "staff-7f3a",
    email: "ops@clinic.example",
    displayName: "Ops Person",
    roles: ["super_admin", "dev"],
    isAdmin: true
};

describe("an adapter whose isAdmin disagrees with its roles", () => {
    it("is warned about once per process, naming the roles it saw and the fix", async () => {
        const f = fresh();
        const app = doors(f, adapterAnswering(staff));

        for (const path of ["/schema/tables", "/schema/tables", "/data/posts", "/data/posts"]) {
            expect((await app.request(path, bearer())).status).toBe(200);
        }

        expect(f.warn).toHaveBeenCalledTimes(1);
        const [message, data] = f.warn.mock.calls[0];
        expect(message).toContain(`["super_admin","dev"]`);
        expect(message).toContain("isAdmin");
        expect(message).toMatch(/informational/);
        expect(message).toMatch(/every (authorization )?decision reads roles/);
        expect(message).toContain(`"admin" role`);
        expect(message).toContain(`schemaTables: { persons: "all" }`);
        // Nothing that says who the user is.
        const said = JSON.stringify([message, data ?? null]);
        for (const personal of [staff.uid, staff.email, "Ops Person"]) {
            expect(said).not.toContain(personal);
        }
    });

    it("is quiet when isAdmin matches the roles", async () => {
        const f = fresh();
        for (const user of [
            { ...staff, roles: ["admin", "dev"], isAdmin: true },
            { ...staff, roles: ["super_admin", "dev"], isAdmin: false },
            { ...staff, roles: [], isAdmin: false }
        ]) {
            const app = doors(f, adapterAnswering(user));
            expect((await app.request("/schema/tables", bearer())).status).toBe(200);
            expect((await app.request("/data/posts", bearer())).status).toBe(200);
        }

        expect(f.warn).not.toHaveBeenCalled();
    });

    it("is quiet for the built-in adapter, which derives isAdmin from the roles", async () => {
        const f = fresh();
        const serviceKey = "sk_admin_flag_warning_test_0123456789abcdef";
        const adapter = f.builtin.createBuiltinAuthAdapter({
            serviceKey,
            authRepository: partialAuthRepository({
                getUserWithRoles: async (uid: string) => ({ user: storedUser(uid), roles: ["editor"] })
            })
        });

        // The service key verifies as the service identity: roles ["admin"], isAdmin true.
        const app = doors(f, adapter);
        expect((await app.request("/schema/tables", bearer(serviceKey))).status).toBe(200);
        expect((await app.request("/data/posts", bearer(serviceKey))).status).toBe(200);

        expect(f.warn).not.toHaveBeenCalled();
    });
});
