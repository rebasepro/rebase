import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { AuthControllerContext } from "../../src/contexts/AuthControllerContext";
import { UserSettingsView } from "../../src/components/UserSettingsView";
import "@testing-library/jest-dom";

/**
 * A password change signs the user out once.
 *
 * The server ends every session on a password change, so the Rebase auth
 * controller signs out as part of `changePassword`. The settings view then
 * signed out again two seconds later, on a timer it never cancelled — so
 * SIGNED_OUT and the app's `onSignOut` fired twice for one password change.
 */

jest.mock("../../src/hooks", () => {
    const original = jest.requireActual("../../src/hooks");
    return {
        ...original,
        useTranslation: () => ({ t: (key: string) => key })
    };
});

type Harness = { signOuts: number };

/**
 * A controller that behaves like `useRebaseAuthController`: `changePassword`
 * resolves and has already signed the user out.
 */
function Host({ harness, unmountOnSignOut }: { harness: Harness; unmountOnSignOut: boolean }) {
    const [user, setUser] = useState<{ uid: string; email: string } | null>({ uid: "u1", email: "u1@rebase.pro" });
    const signOut = async () => {
        harness.signOuts++;
        setUser(null);
    };
    const authController = {
        user,
        initialLoading: false,
        authLoading: false,
        loginSkipped: false,
        extra: null,
        setExtra: () => undefined,
        getAuthToken: async () => "t",
        signOut,
        changePassword: async () => {
            await signOut();
        }
    };
    return (
        <AuthControllerContext.Provider value={authController as never}>
            {(!unmountOnSignOut || user) && <UserSettingsView/>}
        </AuthControllerContext.Provider>
    );
}

async function changePassword() {
    fireEvent.mouseDown(screen.getByRole("tab", { name: "security" }));
    fireEvent.change(screen.getByLabelText("current_password"), { target: { value: "0ldPassword!" } });
    fireEvent.change(screen.getByLabelText("new_password"), { target: { value: "N3wPassword!" } });
    fireEvent.change(screen.getByLabelText("confirm_password"), { target: { value: "N3wPassword!" } });
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "change_password" }));
    });
}

describe("UserSettingsView password change", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it.each([
        ["stays mounted", false],
        ["is unmounted by the sign-out", true]
    ])("signs out once when the view %s", async (_label, unmountOnSignOut) => {
        const harness: Harness = { signOuts: 0 };
        render(<Host harness={harness} unmountOnSignOut={unmountOnSignOut}/>);

        await changePassword();
        await act(async () => {
            jest.advanceTimersByTime(5000);
        });

        expect(harness.signOuts).toBe(1);
    });
});

describe("UserSettingsView email change", () => {
    function EmailHost({ changeEmail, pendingEmail }: { changeEmail: (email: string) => Promise<{ pendingEmail: string; expiresAt: string }>; pendingEmail?: string }) {
        const authController = {
            user: { uid: "u1", email: "me@corp.com", displayName: "Me", pendingEmail: pendingEmail ?? null },
            initialLoading: false,
            authLoading: false,
            loginSkipped: false,
            extra: null,
            setExtra: () => undefined,
            getAuthToken: async () => "t",
            signOut: async () => undefined,
            changeEmail
        };
        return (
            <AuthControllerContext.Provider value={authController as never}>
                <UserSettingsView/>
            </AuthControllerContext.Provider>
        );
    }

    it("asks for the new address and says a link is on its way", async () => {
        const changeEmail = jest.fn(async (email: string) => ({ pendingEmail: email, expiresAt: "2026-10-03T10:00:00.000Z" }));
        render(<EmailHost changeEmail={changeEmail}/>);

        const field = screen.getByLabelText("email_address");
        expect((field as HTMLInputElement).value).toBe("me@corp.com");
        expect(screen.getByRole("button", { name: "email_change_button" })).toBeDisabled();
        fireEvent.change(field, { target: { value: "new@corp.com" } });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "email_change_button" }));
        });

        expect(changeEmail).toHaveBeenCalledWith("new@corp.com");
        expect(screen.getByText("email_change_pending")).toBeInTheDocument();
    });

    it("says what a refusal means rather than the server's words", async () => {
        const changeEmail = jest.fn(async () => {
            throw Object.assign(new Error("Email already registered"), { code: "EMAIL_EXISTS" });
        });
        render(<EmailHost changeEmail={changeEmail}/>);

        fireEvent.change(screen.getByLabelText("email_address"), { target: { value: "taken@corp.com" } });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "email_change_button" }));
        });

        expect(screen.getByText("email_change_taken")).toBeInTheDocument();
    });

    it("shows a change that is already waiting", () => {
        render(<EmailHost changeEmail={jest.fn(async () => ({ pendingEmail: "", expiresAt: "" }))} pendingEmail="waiting@corp.com"/>);
        expect(screen.getByText("email_change_pending")).toBeInTheDocument();
    });

    it("is not offered by a controller that cannot change an address", () => {
        const authController = {
            user: { uid: "u1", email: "me@corp.com" },
            initialLoading: false, authLoading: false, loginSkipped: false, extra: null,
            setExtra: () => undefined, getAuthToken: async () => "t", signOut: async () => undefined
        };
        render(
            <AuthControllerContext.Provider value={authController as never}>
                <UserSettingsView/>
            </AuthControllerContext.Provider>
        );
        expect(screen.queryByRole("button", { name: "email_change_button" })).toBeNull();
    });
});
