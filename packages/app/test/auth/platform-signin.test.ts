import { platformSignInFromAddress, resetPlatformSignInForTests, takePlatformSignInToken } from "../../src/auth/platform-signin";

/** A real jsdom window, moved to `href` first; `replaceState` is spied on. */
function fakeWindow(href: string): Pick<Window, "location" | "history"> {
    const url = new URL(href);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    jest.spyOn(window.history, "replaceState");
    return window;
}

describe("the platform's sign-in token in the address", () => {
    beforeEach(() => { resetPlatformSignInForTests(); });
    afterEach(() => { jest.restoreAllMocks(); });

    it("is taken out of the address before anything spends it", () => {
        const win = fakeWindow("https://palp.example/admin?x=1#rebase_platform_signin=rpt_abc");
        expect(takePlatformSignInToken(win)).toBe("rpt_abc");
        expect(win.location.hash).toBe("");
        expect(win.location.search).toBe("?x=1");
        expect(win.history.replaceState).toHaveBeenCalledTimes(1);
    });

    it("keeps the rest of the fragment", () => {
        const win = fakeWindow("https://palp.example/admin#tab=users&rebase_platform_signin=rpt_abc");
        expect(takePlatformSignInToken(win)).toBe("rpt_abc");
        expect(win.location.hash).toBe("#tab=users");
    });

    it("leaves an address without one alone", () => {
        const win = fakeWindow("https://palp.example/admin#/collections");
        expect(takePlatformSignInToken(win)).toBeUndefined();
        expect(win.history.replaceState).not.toHaveBeenCalled();
    });

    it("is spent once per page, however many times the controller mounts", async () => {
        const win = fakeWindow("https://palp.example/admin#rebase_platform_signin=rpt_abc");
        const signIn = jest.fn().mockResolvedValue(undefined);
        const first = platformSignInFromAddress(signIn, win);
        const second = platformSignInFromAddress(signIn, win);
        expect(first).toBeDefined();
        expect(second).toBe(first);
        await first;
        expect(signIn).toHaveBeenCalledTimes(1);
        expect(signIn).toHaveBeenCalledWith("rpt_abc");
    });

    it("starts nothing on a page opened without one", () => {
        const signIn = jest.fn();
        expect(platformSignInFromAddress(signIn, fakeWindow("https://palp.example/admin"))).toBeUndefined();
        expect(signIn).not.toHaveBeenCalled();
    });
});
