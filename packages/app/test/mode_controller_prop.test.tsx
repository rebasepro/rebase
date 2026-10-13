import React from "react";
import { act, render } from "@testing-library/react";
import { Rebase, useModeController } from "@rebasepro/app";
import type { ModeController } from "@rebasepro/app";

/**
 * `<Rebase>` always built its own theme controller: it put `dark` on `<html>`,
 * listened to `prefers-color-scheme`, wrote localStorage — and left the class
 * behind when it unmounted. A host app with a theme of its own had two writers
 * fighting over one class, and an app that mounted Rebase on one page kept its
 * dark mode on every other page after leaving it.
 *
 * Now the host can hand Rebase its own controller, and Rebase then touches none
 * of those; when Rebase owns the theme, it takes its class away with it.
 */

const client = {
    data: { collection: () => ({}) },
    auth: {},
    fetchStorageSources: async () => []
} as never;

const authController = {
    user: null,
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: async () => "t",
    signOut: async () => undefined,
    extra: null,
    setExtra: () => undefined
};

const seen: { controller?: ModeController } = {};
function Probe() {
    seen.controller = useModeController();
    return null;
}

function renderRebase(modeController?: ModeController) {
    return render(
        <Rebase authController={authController} client={client} storageSource={{} as never}
            modeController={modeController}>
            <Probe/>
        </Rebase>
    );
}

beforeEach(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
    seen.controller = undefined;
});

describe("<Rebase> owning the theme", () => {
    it("puts the dark class on <html>, and removes it on unmount", () => {
        window.localStorage.setItem("prefers-dark-mode", "true");
        const view = renderRebase();
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(seen.controller?.mode).toBe("dark");

        view.unmount();
        expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("leaves a dark class the page already had", () => {
        document.documentElement.classList.add("dark");
        window.localStorage.setItem("prefers-dark-mode", "true");
        const view = renderRebase();
        view.unmount();
        expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
});

describe("<Rebase modeController>", () => {
    it("uses the host's controller and leaves <html>, the media query and storage alone", () => {
        const setMode = jest.fn();
        const hostController: ModeController = { mode: "dark", setMode };
        // A fresh recorder: the setup file's `matchMedia` is a mock shared by
        // every test in the file, and remembers their calls too.
        const originalMatchMedia = window.matchMedia;
        const matchMedia = jest.fn((query: string) => originalMatchMedia(query));
        window.matchMedia = matchMedia;
        const getItem = jest.spyOn(Storage.prototype, "getItem");
        const setItem = jest.spyOn(Storage.prototype, "setItem");
        try {
            const view = renderRebase(hostController);

            expect(seen.controller).toBe(hostController);
            act(() => seen.controller!.setMode("light"));
            expect(setMode).toHaveBeenCalledWith("light");

            expect(document.documentElement.classList.contains("dark")).toBe(false);
            expect(matchMedia.mock.calls.filter(([query]) => query === "(prefers-color-scheme: dark)")).toEqual([]);
            expect(getItem.mock.calls.filter(([key]) => key === "prefers-dark-mode")).toEqual([]);
            expect(setItem.mock.calls.filter(([key]) => key === "prefers-dark-mode")).toEqual([]);
            view.unmount();
        } finally {
            window.matchMedia = originalMatchMedia;
            getItem.mockRestore();
            setItem.mockRestore();
        }
    });
});
