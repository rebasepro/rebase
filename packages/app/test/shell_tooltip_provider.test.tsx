/**
 * `<Rebase>` mounts one tooltip provider for the whole admin.
 *
 * Every kit `Tooltip` used to mount a provider of its own — a page of table
 * rows mounted hundreds — and with one provider per tooltip the skip-delay
 * between neighbouring tooltips never applied. Under the shell's provider,
 * the next tooltip opens at once right after one closes.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "@rebasepro/ui";
import { Rebase } from "../src/core/Rebase";
import { fakeAuthController, fakeClient, fakeStorageSource, fakeUser } from "./helpers/fakes";

const storageSource = fakeStorageSource();

const authController = fakeAuthController({
    user: fakeUser({ uid: "u1" }),
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: () => Promise.resolve("t")
});

const client = fakeClient();

describe("<Rebase> and kit tooltips", () => {

    it("share the shell's provider: the next tooltip opens without the delay", () => {
        jest.useFakeTimers();
        try {
            render(
                <Rebase authController={authController} client={client} storageSource={storageSource}>
                    <Tooltip title={"First"} asChild={true}><button type={"button"}>first</button></Tooltip>
                    <Tooltip title={"Second"} asChild={true}><button type={"button"}>second</button></Tooltip>
                </Rebase>
            );

            act(() => {
                fireEvent.focus(screen.getByText("first"));
            });
            expect(screen.getByRole("tooltip").textContent).toContain("First");

            act(() => {
                fireEvent.blur(screen.getByText("first"));
                fireEvent.pointerMove(screen.getByText("second"), { pointerType: "mouse" });
            });
            expect(screen.getByRole("tooltip").textContent).toContain("Second");
        } finally {
            jest.useRealTimers();
        }
    });
});
