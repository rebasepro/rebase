import { resolveCollections } from "../../src/hooks/navigation/useNavigationResolution";
import type { CollectionConfig, RebaseData } from "@rebasepro/types";
import type { AuthController } from "@rebasepro/cms-types";

/**
 * The "Reset Password" action is injected into `auth: true` collections, but
 * only when the auth adapter actually exposes the admin reset-password route.
 * Custom adapters mount their own admin routes and may not implement it, in
 * which case the button could only ever 404.
 */
describe("resetPasswordAction injection & adminPasswordReset capability", () => {

    function authControllerWith(capabilities?: Record<string, unknown>): AuthController {
        return {
            user: { uid: "admin-1", roles: ["admin"] },
            capabilities
        } as unknown as AuthController;
    }

    const usersCollection = {
        slug: "users",
        name: "Users",
        auth: { enabled: true },
        properties: {}
    } as unknown as CollectionConfig;

    const data = {} as RebaseData;

    async function resolveActions(authController: AuthController, collection = usersCollection) {
        const resolved = await resolveCollections([collection], authController, data, undefined);
        return (resolved[0]?.entityActions ?? []).map((a) => a.key);
    }

    it("injects the action when the adapter reports adminPasswordReset support", async () => {
        const keys = await resolveActions(authControllerWith({ adminPasswordReset: true }));
        expect(keys).toContain("reset_password");
    });

    it("omits the action when the adapter reports no adminPasswordReset support", async () => {
        const keys = await resolveActions(authControllerWith({ adminPasswordReset: false }));
        expect(keys).not.toContain("reset_password");
    });

    it("injects the action when the capability is absent (older backend)", async () => {
        // Backends predating the field report nothing; preserve prior behaviour
        // rather than silently removing the action.
        const keys = await resolveActions(authControllerWith({}));
        expect(keys).toContain("reset_password");
    });

    it("injects the action when capabilities are entirely absent", async () => {
        const keys = await resolveActions(authControllerWith(undefined));
        expect(keys).toContain("reset_password");
    });

    it("still honours an explicit actions.resetPassword: false opt-out", async () => {
        const collection = {
            ...usersCollection,
            auth: { enabled: true, actions: { resetPassword: false } }
        } as unknown as CollectionConfig;
        const keys = await resolveActions(authControllerWith({ adminPasswordReset: true }), collection);
        expect(keys).not.toContain("reset_password");
    });

    it("keeps a custom action supplied by the collection even without the capability", async () => {
        // The author supplied their own action, so they own its backend; the
        // built-in adapter capability must not suppress it.
        const customAction = { key: "reset_password", name: "Custom Reset", onClick: async () => undefined };
        const collection = {
            ...usersCollection,
            auth: { enabled: true, actions: { resetPassword: customAction } }
        } as unknown as CollectionConfig;
        const keys = await resolveActions(authControllerWith({ adminPasswordReset: false }), collection);
        expect(keys).toContain("reset_password");
    });

    it("does not touch collections that are not auth collections", async () => {
        const plain = { slug: "posts", name: "Posts", properties: {} } as unknown as CollectionConfig;
        const keys = await resolveActions(authControllerWith({ adminPasswordReset: true }), plain);
        expect(keys).not.toContain("reset_password");
    });
});
