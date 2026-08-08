import { describe, expect, it } from "@jest/globals";
import type { User } from "@rebasepro/types";
import { resolveRoleRefresh } from "../src/hooks/useFirebaseAuthController";

const user = { uid: "user-1", email: "someone@example.com" } as User;

describe("resolveRoleRefresh", () => {

    it("reports a role change so it can be applied", async () => {
        // The guard this replaced compared the fresh roles to themselves, so it
        // was never true and a `defineRolesFor` result that arrived after the
        // auth-state change never reached the controller.
        await expect(resolveRoleRefresh(() => ["editor"], user, ["admin"]))
            .resolves.toEqual({
                changed: true,
                roles: ["editor"]
            });
    });

    it("reports the first roles resolved for a user", async () => {
        await expect(resolveRoleRefresh(() => ["admin"], user, undefined))
            .resolves.toEqual({
                changed: true,
                roles: ["admin"]
            });
    });

    it("reports no change when the roles are the same", async () => {
        await expect(resolveRoleRefresh(() => ["admin"], user, ["admin"]))
            .resolves.toEqual({
                changed: false,
                roles: ["admin"]
            });
    });

    it("awaits an asynchronous defineRolesFor", async () => {
        await expect(resolveRoleRefresh(async () => ["admin"], user, ["editor"]))
            .resolves.toEqual({
                changed: true,
                roles: ["admin"]
            });
    });

    it("reports roles being revoked", async () => {
        await expect(resolveRoleRefresh(() => undefined, user, ["admin"]))
            .resolves.toEqual({
                changed: true,
                roles: undefined
            });
    });

});
