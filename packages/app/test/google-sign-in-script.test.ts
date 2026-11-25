/**
 * Google's sign-in script is fetched by the Google button, not by a tag in
 * every app's index.html: signed-in sessions never download it.
 */
const SRC = "https://accounts.google.com/gsi/client";

function scripts(): HTMLScriptElement[] {
    return Array.from(document.querySelectorAll<HTMLScriptElement>(`script[src^="${SRC}"]`));
}

async function freshModule() {
    jest.resetModules();
    return import("../src/auth/google-sign-in");
}

describe("loadGoogleIdentityServices", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        delete window.google;
    });

    it("adds one script however many buttons ask, and resolves when it loads", async () => {
        const { loadGoogleIdentityServices } = await freshModule();
        const first = loadGoogleIdentityServices();
        const second = loadGoogleIdentityServices();
        expect(scripts()).toHaveLength(1);
        expect(scripts()[0].async).toBe(true);
        scripts()[0].dispatchEvent(new Event("load"));
        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    });

    it("reuses a tag the app's index.html still carries", async () => {
        const tag = document.createElement("script");
        tag.src = SRC;
        document.head.appendChild(tag);
        const { loadGoogleIdentityServices } = await freshModule();
        const loading = loadGoogleIdentityServices();
        expect(scripts()).toHaveLength(1);
        tag.dispatchEvent(new Event("load"));
        await expect(loading).resolves.toBeUndefined();
    });

    it("adds nothing when the SDK is already on the page", async () => {
        window.google = { accounts: { oauth2: { initCodeClient: () => ({ requestCode: () => undefined }) } } };
        const { loadGoogleIdentityServices } = await freshModule();
        await expect(loadGoogleIdentityServices()).resolves.toBeUndefined();
        expect(scripts()).toHaveLength(0);
    });

    it("tries again after a failed load", async () => {
        const { loadGoogleIdentityServices } = await freshModule();
        const failed = loadGoogleIdentityServices();
        scripts()[0].dispatchEvent(new Event("error"));
        await expect(failed).rejects.toThrow(/failed to load/);
        scripts()[0].remove();
        void loadGoogleIdentityServices();
        expect(scripts()).toHaveLength(1);
    });
});
