import { afterEach, describe, expect, it } from "@jest/globals";
import { createPushClient } from "./push";
import { createTransport } from "./transport";

/**
 * `client.push` against a fake browser: a service worker registration whose
 * PushManager records what it was asked, and a server that records requests.
 */

const SERVER_KEY = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const keyBytes = () => new Uint8Array(Buffer.from(SERVER_KEY, "base64url"));

class FakeSubscription {
    unsubscribed = false;
    constructor(readonly endpoint: string, readonly options: { applicationServerKey: ArrayBuffer | null }) {}
    toJSON() {
        return { endpoint: this.endpoint, keys: { p256dh: "p", auth: "a" } };
    }
    async unsubscribe() {
        this.unsubscribed = true;
        return true;
    }
}

function fakeBrowser(options: { permission?: NotificationPermission; answer?: NotificationPermission; existing?: FakeSubscription; registered?: boolean } = {}) {
    let current: FakeSubscription | null = options.existing ?? null;
    const subscribeCalls: unknown[] = [];
    const registration = {
        pushManager: {
            getSubscription: async () => current,
            subscribe: async (init: { applicationServerKey: Uint8Array }) => {
                subscribeCalls.push(init);
                current = new FakeSubscription("https://fcm.googleapis.com/fcm/send/new", { applicationServerKey: init.applicationServerKey.slice().buffer });
                return current;
            }
        }
    };
    const notification = {
        permission: options.permission ?? "default",
        requestPermission: async () => options.answer ?? "granted"
    };
    Object.assign(globalThis, {
        navigator: { language: "es-ES", serviceWorker: { getRegistration: async () => (options.registered === false ? undefined : registration) } },
        window: { PushManager: class {}, Notification: notification },
        Notification: notification
    });
    return { subscribeCalls, current: () => current };
}

function recordingServer() {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const fetchFn: typeof fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ method: init?.method ?? "GET", path: url.pathname, body });
        const reply = url.pathname.endsWith("/key") ? { key: SERVER_KEY } : url.pathname.endsWith("/subscriptions") && init?.method === "POST" ? { id: "sub-1" } : { removed: true };
        return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    return { transport: createTransport({ baseUrl: "http://api.test", fetch: fetchFn, anonymous: true }), requests };
}

describe("client.push", () => {
    const saved = { navigator: globalThis.navigator, window: (globalThis as { window?: unknown }).window, Notification: (globalThis as { Notification?: unknown }).Notification };
    afterEach(() => {
        Object.assign(globalThis, saved);
    });

    it("asks permission, subscribes with the server's key and registers the browser with its language", async () => {
        const browser = fakeBrowser();
        const { transport, requests } = recordingServer();
        const { id, subscription } = await createPushClient(transport).subscribe();
        expect(id).toBe("sub-1");
        expect(subscription.endpoint).toBe("https://fcm.googleapis.com/fcm/send/new");
        expect(browser.subscribeCalls).toEqual([{ userVisibleOnly: true, applicationServerKey: keyBytes() }]);
        expect(requests).toEqual([
            { method: "GET", path: "/api/push/key", body: undefined },
            {
                method: "POST",
                path: "/api/push/subscriptions",
                body: { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: { p256dh: "p", auth: "a" } }, lang: "es-ES" }
            }
        ]);
    });

    it("keeps a subscription made with the same key, and replaces one made with another", async () => {
        const same = new FakeSubscription("https://fcm.googleapis.com/fcm/send/same", { applicationServerKey: keyBytes().buffer });
        const kept = fakeBrowser({ permission: "granted", existing: same });
        await createPushClient(recordingServer().transport).subscribe({ lang: "en" });
        expect(kept.subscribeCalls).toHaveLength(0);
        expect(same.unsubscribed).toBe(false);

        const stale = new FakeSubscription("https://fcm.googleapis.com/fcm/send/stale", { applicationServerKey: new Uint8Array(65).buffer });
        const replaced = fakeBrowser({ permission: "granted", existing: stale });
        await createPushClient(recordingServer().transport).subscribe();
        expect(stale.unsubscribed).toBe(true);
        expect(replaced.subscribeCalls).toHaveLength(1);
    });

    it("says why it cannot subscribe: permission, no service worker, no support", async () => {
        fakeBrowser({ answer: "denied" });
        await expect(createPushClient(recordingServer().transport).subscribe()).rejects.toMatchObject({ code: "PUSH_PERMISSION_DENIED" });
        fakeBrowser({ registered: false });
        await expect(createPushClient(recordingServer().transport).subscribe()).rejects.toMatchObject({ code: "PUSH_NO_SERVICE_WORKER" });
        Object.assign(globalThis, { window: {} });
        const client = createPushClient(recordingServer().transport);
        expect(client.isSupported()).toBe(false);
        await expect(client.subscribe()).rejects.toMatchObject({ code: "PUSH_UNSUPPORTED" });
    });

    it("unsubscribes on the server, then in the browser", async () => {
        const existing = new FakeSubscription("https://fcm.googleapis.com/fcm/send/mine", { applicationServerKey: keyBytes().buffer });
        fakeBrowser({ permission: "granted", existing });
        const { transport, requests } = recordingServer();
        expect(await createPushClient(transport).unsubscribe()).toBe(true);
        expect(requests).toEqual([{ method: "DELETE", path: "/api/push/subscriptions", body: { endpoint: "https://fcm.googleapis.com/fcm/send/mine" } }]);
        expect(existing.unsubscribed).toBe(true);

        fakeBrowser({ permission: "granted" });
        expect(await createPushClient(recordingServer().transport).unsubscribe()).toBe(false);
    });
});
