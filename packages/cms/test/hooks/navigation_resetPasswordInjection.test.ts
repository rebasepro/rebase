import { resolveCollections } from "../../src/hooks/navigation/useNavigationResolution";
import type { CollectionConfig, RebaseData } from "@rebasepro/types";
import { resolveAdminCollection, type AuthController } from "@rebasepro/cms-types";

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

/**
 * The other half of the same injection: the callback that shows the credentials
 * dialog after a user is created.
 *
 * It was installed on `callbacks` — the server's block. Nothing in the browser
 * runs that block, and the Vite plugin strips its bodies on the way into the
 * bundle, so the dialog never opened and a temporary password the server had
 * just minted, and will not repeat, was never shown to anyone. It goes on
 * `browserCallbacks`, which `saveEntityWithCallbacks` actually runs.
 */
describe("creation-result dialog injection", () => {

    const authController = {
        user: { uid: "admin-1", roles: ["admin"] },
        capabilities: { adminPasswordReset: true }
    } as unknown as AuthController;

    const usersCollection = {
        slug: "users",
        name: "Users",
        auth: { enabled: true },
        properties: {}
    } as unknown as CollectionConfig;

    const data = {} as RebaseData;

    const resolveOne = async (collection = usersCollection) =>
        (await resolveCollections([collection], authController, data, undefined))[0];

    it("lands on browserCallbacks, the block the panel runs", async () => {
        const resolved = await resolveOne();
        expect(resolved.browserCallbacks?.afterSave).toBeInstanceOf(Function);
    });

    it("leaves the server's callbacks block alone", async () => {
        // Injecting here is what broke it. It is also the block whose bodies do
        // not reach the browser, so anything written into it is written into a
        // hole.
        const resolved = await resolveOne();
        expect(resolved.callbacks?.afterSave).toBeUndefined();
    });

    it("still runs an afterSave the collection declared itself", async () => {
        const authorCallback = jest.fn();
        const resolved = await resolveOne({
            ...usersCollection,
            admin: { browserCallbacks: { afterSave: authorCallback } }
        } as unknown as CollectionConfig);

        await resolved.browserCallbacks!.afterSave!({
            collection: resolved,
            path: "users",
            id: "user-1",
            values: { email: "a@b.c" },
            status: "new",
            context: {} as never
        });

        expect(authorCallback).toHaveBeenCalled();
    });

    it("does nothing on an update, or when the response carries no credentials", async () => {
        const resolved = await resolveOne();
        const open = jest.fn();
        const props = (status: string, values: Record<string, unknown>) => ({
            collection: resolved,
            path: "users",
            id: "user-1",
            values,
            status,
            context: { dialogsController: { open } } as never
        });

        await resolved.browserCallbacks!.afterSave!(props("existing", { temporaryPassword: "hunter2" }) as never);
        await resolved.browserCallbacks!.afterSave!(props("new", { email: "a@b.c" }) as never);

        expect(open).not.toHaveBeenCalled();
    });

    it("survives being re-flattened, which the registry does on every lookup", async () => {
        // The injection runs after `resolveAdminCollection` has spread `admin`
        // onto the top level, and that spread wins. Written only to the flat
        // key, the callback would be silently replaced by the authored block —
        // or by nothing — the next time a collection was resolved.
        // Needs a collection whose `admin` block declares `browserCallbacks`:
        // flattening spreads the block over the top level, so only a key the
        // block also has can clobber the injected wrapper. On a collection
        // without one, or without an `admin` block at all, the bug is invisible.
        const authorCallback = jest.fn();
        const resolved = resolveAdminCollection(await resolveOne({
            ...usersCollection,
            admin: { browserCallbacks: { afterSave: authorCallback } }
        } as unknown as CollectionConfig));

        // Not the author's function: the wrapper that calls it and then opens
        // the dialog. Getting the author's back means the injection was undone.
        expect(resolved.browserCallbacks?.afterSave).not.toBe(authorCallback);

        const open = jest.fn().mockReturnValue({ closeDialog: jest.fn() });
        await resolved.browserCallbacks!.afterSave!({
            collection: resolved,
            path: "users",
            id: "user-1",
            values: { email: "a@b.c", temporaryPassword: "hunter2" },
            status: "new",
            context: { dialogsController: { open } } as never
        } as never);

        expect(authorCallback).toHaveBeenCalled();
        expect(open).toHaveBeenCalled();
    });

    it("opens the dialog when a new user comes back with a temporary password", async () => {
        const resolved = await resolveOne();
        const open = jest.fn().mockReturnValue({ closeDialog: jest.fn() });

        await resolved.browserCallbacks!.afterSave!({
            collection: resolved,
            path: "users",
            id: "user-1",
            values: { email: "a@b.c", temporaryPassword: "hunter2", invitationSent: false },
            status: "new",
            context: { dialogsController: { open } } as never
        } as never);

        expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "user_creation_result" }));
    });
});
