/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The account actions on a row of the auth table, in a Studio running without
 * the admin panel: the requests the panel's users collection sends, through
 * the same hook, and the temporary password shown once.
 */

const request = jest.fn<(path: string, init?: { method: string; body?: unknown }) => Promise<unknown>>();
const snackbarOpen = jest.fn();

jest.mock("@rebasepro/app", () => ({
    useAdminUserRequest: () => request,
    useSnackbarController: () => ({ open: snackbarOpen }),
    useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
    useTableDescriptors: () => ({
        status: "ready",
        tables: [{ name: "Users", slug: "users", table: "users", schema: "rebase", kind: "table", auth: {} }]
    })
}));

import { AuthUserRowActions, useIsAuthTable } from "../src/components/TableEditor/tabs/AuthUserActions";
import type { DbTableInfo } from "../src/components/TableEditor/tableModel";

function IsAuth({ table }: { table: Pick<DbTableInfo, "schema" | "name"> }) {
    return <span>{useIsAuthTable(table as DbTableInfo) ? "auth" : "plain"}</span>;
}

beforeEach(() => {
    request.mockReset();
    snackbarOpen.mockReset();
});

describe("the auth table's row actions", () => {
    it("knows the auth table from the server's descriptor", () => {
        render(<><IsAuth table={{ schema: "rebase", name: "users" }}/><IsAuth table={{ schema: "public", name: "users" }}/></>);
        expect(screen.getAllByText(/auth|plain/).map(e => e.textContent)).toEqual(["auth", "plain"]);
    });

    it("resets a password and shows the temporary password once", async () => {
        request.mockResolvedValue({ temporaryPassword: "Tmp-123456" });
        render(<AuthUserRowActions row={{ id: "u-1", email: "a@b.c", disabled_at: null }} uid="u-1" onChanged={() => undefined}/>);
        fireEvent.click(screen.getByLabelText("reset_password"));
        fireEvent.click(screen.getAllByText("reset_password").filter(e => e.closest("button"))[0]!.closest("button")!);
        await waitFor(() => expect(request).toHaveBeenCalledWith("u-1/reset-password", { method: "POST", body: {} }));
        expect(await screen.findByText("Tmp-123456")).toBeTruthy();
    });

    it("resets two-step verification, and switches an account off and on", async () => {
        request.mockResolvedValue({});
        const onChanged = jest.fn();
        const { rerender } = render(<AuthUserRowActions row={{ id: "u-1", disabled_at: null }} uid="u-1" onChanged={onChanged}/>);
        fireEvent.click(screen.getByLabelText("reset_mfa_title"));
        fireEvent.click(screen.getByText("reset_mfa_confirm"));
        await waitFor(() => expect(request).toHaveBeenCalledWith("u-1/mfa", { method: "DELETE" }));

        fireEvent.click(screen.getByLabelText("account_access_action"));
        await waitFor(() => expect(request).toHaveBeenCalledWith("u-1", { method: "PUT", body: { disabled: true } }));
        expect(onChanged).toHaveBeenCalled();

        rerender(<AuthUserRowActions row={{ id: "u-1", disabled_at: "2026-11-27T00:00:00Z" }} uid="u-1" onChanged={onChanged}/>);
        fireEvent.click(screen.getByLabelText("account_access_action"));
        await waitFor(() => expect(request).toHaveBeenCalledWith("u-1", { method: "PUT", body: { disabled: false } }));
    });
});
