import { jest } from "@jest/globals";
import { resolveCollections } from "../../src/hooks/navigation/useNavigationResolution";
import type { EntityStatus } from "@rebasepro/types";
import type { AfterSaveProps } from "@rebasepro/cms-types";
import { resolveAdminCollection, type AdminCollection, type AuthCapabilities, type AuthController } from "@rebasepro/cms-types";
import { fakeAuthController, fakeDialogsController, fakeRebaseContext, fakeSdkData, fakeUser } from "../helpers/fakes";
import { col, defineAuthTable } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { composeCollections } from "../../src/hooks/navigation/compose_collections";
import { customizeTable } from "../../src/tables/customize_table";

const admin = fakeUser("admin-1", { roles: ["admin"] });

/**
 * The "Reset Password" action is injected into `auth: true` collections, but
 * only when the auth adapter actually exposes the admin reset-password route.
 * Custom adapters mount their own admin routes and may not implement it, in
 * which case the button could only ever 404.
 */
describe("resetPasswordAction injection & adminPasswordReset capability", () => {

    function authControllerWith(capabilities?: AuthCapabilities): AuthController {
        return fakeAuthController({ user: admin, capabilities });
    }

    const usersCollection: AdminCollection = {
        slug: "users",
        name: "Users",
        auth: { enabled: true },
        properties: {}
    };

    const data = fakeSdkData();

    async function resolveActions(authController: AuthController, collection = usersCollection) {
        const resolved = await resolveCollections([collection], authController, data, undefined);
        return (resolved[0]?.entityActions ?? []).map((a) => typeof a === "string" ? a : a.key);
    }

    it("injects the action when the adapter reports adminPasswordReset support", async () => {
        const keys = await resolveActions(authControllerWith({ adminPasswordReset: true }));
        expect(keys).toContain("reset_password");
    });

    it("injects the MFA reset and the account switch beside it, on the backend's admin user routes", async () => {
        const keys = await resolveActions(authControllerWith({ adminPasswordReset: true }));
        expect(keys).toEqual(expect.arrayContaining(["reset_mfa", "account_access"]));
        const without = await resolveActions(authControllerWith({ adminPasswordReset: false }));
        expect(without).not.toContain("reset_mfa");
        expect(without).not.toContain("account_access");
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
        const collection: AdminCollection = {
            ...usersCollection,
            auth: { enabled: true, actions: { resetPassword: false } }
        };
        const keys = await resolveActions(authControllerWith({ adminPasswordReset: true }), collection);
        expect(keys).not.toContain("reset_password");
    });

    it("keeps a custom action supplied by the collection even without the capability", async () => {
        // The author supplied their own action, so they own its backend; the
        // built-in adapter capability must not suppress it.
        const customAction = { key: "reset_password", name: "Custom Reset", onClick: async () => undefined };
        const collection: AdminCollection = {
            ...usersCollection,
            auth: { enabled: true, actions: { resetPassword: customAction } }
        };
        const keys = await resolveActions(authControllerWith({ adminPasswordReset: false }), collection);
        expect(keys).toContain("reset_password");
    });

    it("does not touch collections that are not auth collections", async () => {
        const plain: AdminCollection = { slug: "posts", name: "Posts", properties: {} };
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

    const authController = fakeAuthController({ user: admin, capabilities: { adminPasswordReset: true } });

    const usersCollection: AdminCollection = {
        slug: "users",
        name: "Users",
        auth: { enabled: true },
        properties: {}
    };

    const data = fakeSdkData();

    const resolveOne = async (collection = usersCollection) =>
        (await resolveCollections([collection], authController, data, undefined))[0];

    /** What the panel hands `afterSave` once a user row is saved. */
    const afterSaveProps = (
        collection: AdminCollection,
        status: EntityStatus,
        values: Record<string, unknown>,
        rest: Partial<AfterSaveProps> = {}
    ): AfterSaveProps => ({
        collection,
        path: "users",
        id: "user-1",
        values,
        status,
        context: fakeRebaseContext(),
        ...rest
    });

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
        const authorCallback = jest.fn<(props: AfterSaveProps) => void>();
        const resolved = await resolveOne({
            ...usersCollection,
            admin: { browserCallbacks: { afterSave: authorCallback } }
        });

        await resolved.browserCallbacks!.afterSave!(afterSaveProps(resolved, "new", { email: "a@b.c" }));

        expect(authorCallback).toHaveBeenCalled();
    });

    it("does nothing on an update, or when the response carries no credentials", async () => {
        const resolved = await resolveOne();
        const { dialogs, open } = fakeDialogsController();
        const props = (status: EntityStatus, values: Record<string, unknown>) =>
            afterSaveProps(resolved, status, values, { context: fakeRebaseContext({ dialogsController: dialogs }) });

        await resolved.browserCallbacks!.afterSave!(props("existing", { temporaryPassword: "hunter2" }));
        await resolved.browserCallbacks!.afterSave!(props("new", { email: "a@b.c" }));

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
        const authorCallback = jest.fn<(props: AfterSaveProps) => void>();
        const resolved = resolveAdminCollection(await resolveOne({
            ...usersCollection,
            admin: { browserCallbacks: { afterSave: authorCallback } }
        }));

        // Not the author's function: the wrapper that calls it and then opens
        // the dialog. Getting the author's back means the injection was undone.
        expect(resolved.browserCallbacks?.afterSave).not.toBe(authorCallback);

        const { dialogs, open } = fakeDialogsController();
        await resolved.browserCallbacks!.afterSave!(afterSaveProps(resolved, "new",
            { email: "a@b.c", temporaryPassword: "hunter2" },
            { context: fakeRebaseContext({ dialogsController: dialogs }) }));

        expect(authorCallback).toHaveBeenCalled();
        expect(open).toHaveBeenCalled();
    });

    it("opens the dialog when a new user comes back with a temporary password", async () => {
        const resolved = await resolveOne();
        const { dialogs, open } = fakeDialogsController();

        await resolved.browserCallbacks!.afterSave!(afterSaveProps(resolved, "new",
            { email: "a@b.c", temporaryPassword: "hunter2", invitationSent: false },
            { context: fakeRebaseContext({ dialogsController: dialogs }) }));

        expect(open).toHaveBeenCalledWith(expect.objectContaining({ key: "user_creation_result" }));
    });
});

/**
 * `auth.actions.resetPassword` of a collection, now `customizeTable`'s
 * `resetPasswordAction` on the auth table: what the codemod writes for a
 * project that had either form.
 */
describe("customizeTable(\"users\", { resetPasswordAction }) on a defineAuthTable table", () => {
    const users = defineAuthTable("users", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), email: col.text().notNull() },
        rls: "admin-only"
    });
    const authController = fakeAuthController({ user: admin, capabilities: { adminPasswordReset: true } });

    async function actionsOf(customization?: ReturnType<typeof customizeTable>) {
        const [collection] = composeCollections({
            tables: compileTables([users]),
            tableCustomizations: customization ? [customization] : [],
            externalCollections: []
        });
        const resolved = await resolveCollections([collection], authController, fakeSdkData(), undefined);
        return resolved[0]?.entityActions ?? [];
    }

    it("offers the built-in reset by default", async () => {
        expect((await actionsOf()).map(a => typeof a === "string" ? a : a.key)).toContain("reset_password");
    });

    it("a migrated `resetPassword: false` still has no reset button", async () => {
        const keys = (await actionsOf(customizeTable("users", { resetPasswordAction: false }))).map(a => typeof a === "string" ? a : a.key);
        expect(keys).not.toContain("reset_password");
    });

    it("a custom replacement is carried in place of the built-in one", async () => {
        const onClick = jest.fn(async () => undefined);
        const actions = await actionsOf(customizeTable("users", { resetPasswordAction: { key: "reset_password", name: "Send reset link", onClick } }));
        const resets = actions.filter(a => typeof a !== "string" && a.key === "reset_password");
        expect(resets).toHaveLength(1);
        expect(typeof resets[0] !== "string" && resets[0].name).toBe("Send reset link");
    });
});
