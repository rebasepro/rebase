/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, test, jest, beforeEach, afterEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * An administrator resets a user's second factors from the users table. The
 * server had `DELETE /admin/users/:uid/mfa` and no screen reached it. The
 * action is offered as its route is gated: to whoever holds `users:write`.
 */

const snackbar = { open: jest.fn() };
jest.mock("@rebasepro/app", () => ({
    apiBaseOf: () => "https://api.test/api",
    useAuthController: () => ({ getAuthToken: async () => "admin-token" }),
    useRebaseClient: () => ({}),
    useSnackbarController: () => snackbar,
    useTranslation: () => ({ t: (key: string) => key }),
    resolveDefaultSelectedView: () => undefined
}));

import {
    resetMfaAction,
    ResetMfaActionDialog
} from "../../src/components/common/default_entity_actions";

const entity = { id: "u-2", path: "users", values: { email: "member@corp.com" } };
const contextFor = (heldScopes: string[] | undefined, uid = "admin-1") =>
    ({ authController: { user: { uid }, heldScopes } }) as never;

describe("who is offered the user admin actions", () => {
    test("the MFA reset needs users:write, as its route does", () => {
        const enabled = (held: string[] | undefined) => resetMfaAction.isEnabled!({ entity, context: contextFor(held), view: "collection" } as never);
        expect(enabled(["users:read", "users:write"])).toBe(true);
        expect(enabled(["users:read"])).toBe(false);
        expect(enabled(undefined)).toBe(false);
    });
});

describe("the dialogs", () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];

    beforeEach(() => {
        calls.length = 0;
        snackbar.open.mockClear();
        global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
            const method = init?.method ?? "GET";
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            calls.push({ url, method, body });
            const payload = url.endsWith("/mfa")
                ? { success: true, removedFactors: 2 }
                : { user: { uid: "u-2", email: "member@corp.com" } };
            return { ok: true, status: 200, statusText: "OK", json: async () => payload };
        }) as never;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("the MFA reset asks first, then removes the factors", async () => {
        const onClose = jest.fn();
        render(<ResetMfaActionDialog user={{ uid: "u-2", email: "member@corp.com" }} open onClose={onClose}/>);
        expect(calls).toEqual([]);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "reset_mfa_confirm" }));
        });

        expect(calls).toEqual([{ url: "https://api.test/api/admin/users/u-2/mfa", method: "DELETE", body: undefined }]);
        expect(snackbar.open).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
        expect(onClose).toHaveBeenCalled();
    });

    test("says why the server refused", async () => {
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 403,
            statusText: "Forbidden",
            json: async () => ({ error: { message: "This account holds admin, which you do not, so you cannot change it.", code: "ACCOUNT_OUTRANKS_CALLER" } })
        })) as never;
        render(<ResetMfaActionDialog user={{ uid: "u-2", email: "member@corp.com" }} open onClose={jest.fn()}/>);
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "reset_mfa_confirm" }));
        });
        expect(screen.getByText(/which you do not/)).toBeTruthy();
    });
});
