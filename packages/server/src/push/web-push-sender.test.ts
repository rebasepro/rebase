import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createWebPushSender } from "./web-push-sender";
import { fromBase64Url, generateVapidKeys } from "./web-push-crypto";
import { decryptAsBrowser, RFC } from "../../test/helpers/web-push-browser";

describe("createWebPushSender", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = realFetch; });

    it("posts the encrypted message with the headers a push service reads, and never follows a redirect", async () => {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        globalThis.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({ url: String(url), init: init ?? {} });
            return new Response("", { status: 201 });
        }) as typeof fetch;

        const keys = generateVapidKeys();
        const sender = createWebPushSender(keys, "mailto:ops@example.com");
        const answer = await sender.send(
            { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: RFC.receiverPublic, auth: RFC.auth },
            JSON.stringify({ title: "Hi" }),
            { ttl: 60, urgency: "high", topic: "greeting" }
        );

        expect(answer).toEqual({ statusCode: 201, body: undefined });
        expect(calls).toHaveLength(1);
        const { url, init } = calls[0];
        expect(url).toBe("https://fcm.googleapis.com/fcm/send/abc");
        expect(init.method).toBe("POST");
        expect(init.redirect).toBe("manual");
        const headers = init.headers as Record<string, string>;
        expect(headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "60", Urgency: "high", Topic: "greeting" });
        expect(headers.Authorization).toMatch(new RegExp(`^vapid t=.+, k=${keys.publicKey}$`));
        const body = Buffer.from(init.body as Uint8Array);
        expect(decryptAsBrowser(body, fromBase64Url(RFC.receiverPrivate), fromBase64Url(RFC.auth)).toString()).toBe('{"title":"Hi"}');
    });

    it("reports what the push service answered, whatever the status", async () => {
        globalThis.fetch = jest.fn(async () => new Response("push subscription has unsubscribed or expired", { status: 410 })) as typeof fetch;
        const sender = createWebPushSender(generateVapidKeys(), "mailto:ops@example.com");
        const answer = await sender.send({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: RFC.receiverPublic, auth: RFC.auth }, "{}", { ttl: 0, urgency: "normal" });
        expect(answer).toEqual({ statusCode: 410, body: "push subscription has unsubscribed or expired" });
    });
});
