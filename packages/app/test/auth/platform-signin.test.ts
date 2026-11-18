import { platformSignInFromAddress, resetPlatformSignInForTests, takePlatformSignInToken } from "../../src/auth/platform-signin";

function fakeWindow(href: string) {
    const url = new URL(href);
    const location = { pathname: url.pathname, search: url.search, hash: url.hash };
    const replaceState = jest.fn((_state: unknown, _title: string, next: string) => {
        const moved = new URL(next, url.origin);
        location.pathname = moved.pathname;
        location.search = moved.search;
        location.hash = moved.hash;
    });
    return { location, history: { state: null, replaceState } } as unknown as Pick<Window, "location" | "history">;
}

describe("the platform's sign-in token in the address", () => {
    beforeEach(() => resetPlatformSignInForTests());

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
