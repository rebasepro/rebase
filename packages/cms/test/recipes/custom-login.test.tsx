/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RebaseAuthGate } from "@rebasepro/cms";
import { authControllerFor, InRebase, userWith } from "./recipe_harness";
import { BrandedLoginView } from "../../recipes/custom-login";

const components = { "Auth.LoginView": { Component: BrandedLoginView as never } };

describe("recipe: custom login screen", () => {

    it("replaces the built-in login screen and signs in with email and password", async () => {
        const emailPasswordLogin = jest.fn(async () => undefined);
        render(<InRebase auth={authControllerFor(null, { emailPasswordLogin })} components={components}>
            <RebaseAuthGate><div>the admin</div></RebaseAuthGate>
        </InRebase>);

        expect(await screen.findByText("Acme back office")).toBeTruthy();
        await act(async () => {
            fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
            fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
        });
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

        await waitFor(() => expect(emailPasswordLogin).toHaveBeenCalledWith("ada@example.com", "hunter2"));
    });

    it("shows why sign-in failed", async () => {
        const emailPasswordLogin = jest.fn(async () => {
            throw new Error("Wrong email or password");
        });
        render(<InRebase auth={authControllerFor(null, { emailPasswordLogin })} components={components}>
            <RebaseAuthGate><div>the admin</div></RebaseAuthGate>
        </InRebase>);

        await act(async () => {
            fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ada@example.com" } });
            fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
        });
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

        expect((await screen.findByRole("alert")).textContent).toBe("Wrong email or password");
    });

    it("gives way to the admin once someone is signed in", async () => {
        render(<InRebase user={userWith("ada")} components={components}>
            <RebaseAuthGate><div>the admin</div></RebaseAuthGate>
        </InRebase>);
        expect(await screen.findByText("the admin")).toBeTruthy();
        expect(screen.queryByText("Acme back office")).toBeNull();
    });
});
