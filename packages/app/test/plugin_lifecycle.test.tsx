import React, { useState } from "react";
import { act, render } from "@testing-library/react";
import type { RebasePlugin } from "@rebasepro/cms-types";
import type { User } from "@rebasepro/types";
import { Rebase } from "../src/core/Rebase";

/**
 * `lifecycle.onAuthStateChange` is documented as called whenever the auth
 * state changes, with `null` on sign-out. It never fired: the lifecycle
 * manager was only mounted while a user was signed in, so a sign-out unmounted
 * it (running `onUnmount`) and the next sign-in mounted a fresh one (running
 * `onMount`), and neither one ever saw the user change.
 */

const client = {
    data: { collection: () => ({}) },
    auth: {},
    fetchStorageSources: async () => []
} as never;

function user(uid: string): User {
    return { uid, email: `${uid}@rebase.pro`, displayName: uid, photoURL: null, providerId: "password", isAnonymous: false };
}

function renderWithProbePlugin() {
    const calls: string[] = [];
    const plugin: RebasePlugin = {
        key: "probe",
        lifecycle: {
            onMount: (context) => {
                calls.push(`onMount ${context.authController.user?.uid ?? "null"}`);
            },
            onUnmount: () => {
                calls.push("onUnmount");
            },
            onAuthStateChange: (next) => {
                calls.push(`onAuthStateChange ${next?.uid ?? "null"}`);
            }
        }
    };
    const plugins = [plugin];
    const controls: {
        setUser?: (next: User | null) => void;
        setAuthLoading?: (loading: boolean) => void;
        rerender?: () => void;
    } = {};

    function Host() {
        const [current, setCurrent] = useState<User | null>(null);
        const [authLoading, setAuthLoading] = useState(false);
        const [, setTick] = useState(0);
        controls.setUser = setCurrent;
        controls.setAuthLoading = setAuthLoading;
        controls.rerender = () => setTick(n => n + 1);
        const authController = {
            user: current,
            initialLoading: false,
            authLoading,
            loginSkipped: false,
            getAuthToken: async () => "t",
            signOut: async () => undefined,
            extra: null,
            setExtra: () => undefined
        };
        return (
            <Rebase authController={authController} client={client} storageSource={{} as never} plugins={plugins}>
                <div/>
            </Rebase>
        );
    }

    const view = render(<Host/>);
    return { calls, controls, unmount: view.unmount };
}

describe("plugin lifecycle across sign-in and sign-out", () => {
    it("tells the plugin about every change of user, and mounts it once", async () => {
        const { calls, controls, unmount } = renderWithProbePlugin();

        await act(async () => controls.setUser!(user("u1")));
        await act(async () => controls.rerender!());
        await act(async () => controls.setUser!(null));
        await act(async () => controls.setUser!(user("u2")));
        unmount();

        expect(calls).toEqual([
            "onMount u1",
            "onAuthStateChange null",
            "onAuthStateChange u2",
            "onUnmount"
        ]);
    });

    it("says nothing about a user who arrives before auth has settled, then mounts with them", async () => {
        const { calls, controls, unmount } = renderWithProbePlugin();

        await act(async () => {
            controls.setAuthLoading!(true);
            controls.setUser!(user("u1"));
        });
        expect(calls).toEqual([]);

        await act(async () => controls.setAuthLoading!(false));
        unmount();

        expect(calls).toEqual(["onMount u1", "onUnmount"]);
    });

    it("does not mount before anyone has signed in", async () => {
        const { calls, unmount } = renderWithProbePlugin();
        unmount();

        expect(calls).toEqual([]);
    });
});
