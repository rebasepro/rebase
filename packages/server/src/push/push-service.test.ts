import { describe, expect, it } from "@jest/globals";
import type { PushDelivery, PushSender, PushTarget } from "@rebasepro/types";
import { createPushService, createUnconfiguredPushService } from "./push-service";
import type { PushStore, StoredPushSubscription } from "./push-store";

function stored(id: string, userId: string, lang: string | null): StoredPushSubscription {
    return {
        endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
        p256dh: `key-${id}`,
        auth: "secret",
        info: { id, userId, endpointHost: "fcm.googleapis.com", lang, createdAt: new Date(0), lastSentAt: null }
    };
}

function fakeStore(rows: StoredPushSubscription[]) {
    const removed: Array<[string, string]> = [];
    const marked: string[] = [];
    const store: PushStore = {
        ensure: async () => {},
        adopt: async () => {},
        upsert: async () => {},
        removeOwn: async () => false,
        removeGone: async (id, p256dh) => { removed.push([id, p256dh]); },
        listForUser: async (userId) => rows.filter(r => r.info.userId === userId),
        listByIds: async (ids) => rows.filter(r => ids.includes(r.info.id)),
        markSent: async (ids) => { marked.push(...ids); }
    };
    return { store, removed, marked };
}

function fakeSender(answer: (target: PushTarget) => PushDelivery | Error) {
    const sent: Array<{ target: PushTarget; payload: unknown; options: unknown }> = [];
    const sender: PushSender = {
        async send(target, payload, options) {
            sent.push({ target, payload: JSON.parse(payload), options });
            const result = answer(target);
            if (result instanceof Error) throw result;
            return result;
        }
    };
    return { sender, sent };
}

describe("createPushService", () => {
    const rows = [stored("a", "ada", "es"), stored("b", "ada", null), stored("c", "bob", "en")];

    it("sends to every browser of the user, a payload per language, with the tag folded in", async () => {
        const { store, marked } = fakeStore(rows);
        const { sender, sent } = fakeSender(() => ({ statusCode: 201 }));
        const push = createPushService({ store, sender, publicKey: "pk" });
        const result = await push.sendToUser("ada", (s) => ({ title: s.lang === "es" ? "Hola" : "Hello" }), { tag: "t", topic: "t1" });
        expect(result).toEqual({ sent: 2, removed: 0, failed: 0 });
        expect(sent.map(s => s.payload)).toEqual([{ title: "Hola", tag: "t" }, { title: "Hello", tag: "t" }]);
        expect(sent[0].options).toEqual({ ttl: 86_400, urgency: "normal", topic: "t1" });
        expect(marked.sort()).toEqual(["a", "b"]);
    });

    it("deletes a subscription the push service says is gone, keeps one that failed otherwise", async () => {
        const { store, removed, marked } = fakeStore(rows);
        const { sender } = fakeSender((t) => t.endpoint.endsWith("/a") ? { statusCode: 410 } : t.endpoint.endsWith("/b") ? new Error("ECONNRESET") : { statusCode: 201 });
        const push = createPushService({ store, sender, publicKey: "pk" });
        expect(await push.sendToUser("ada", { title: "x" })).toEqual({ sent: 0, removed: 1, failed: 1 });
        expect(removed).toEqual([["a", "key-a"]]);
        expect(marked).toEqual([]);

        const { sender: limited } = fakeSender(() => ({ statusCode: 429 }));
        const fresh = fakeStore(rows);
        expect(await createPushService({ store: fresh.store, sender: limited, publicKey: "pk" }).sendToUser("ada", {})).toEqual({ sent: 0, removed: 0, failed: 2 });
        expect(fresh.removed).toEqual([]);
    });

    it("refuses bad options and an oversize payload before anything is sent", async () => {
        const { store } = fakeStore(rows);
        const { sender, sent } = fakeSender(() => ({ statusCode: 201 }));
        const push = createPushService({ store, sender, publicKey: "pk" });
        await expect(push.sendToUser("ada", {}, { ttl: -1 })).rejects.toThrow(/ttl/);
        await expect(push.sendToUser("ada", {}, { ttl: 1.5 })).rejects.toThrow(/ttl/);
        await expect(push.sendToUser("ada", {}, { urgency: "now" as "high" })).rejects.toThrow(/urgency/);
        await expect(push.sendToUser("ada", {}, { topic: "has space" })).rejects.toThrow(/topic/);
        // The second browser's payload is the oversize one: the first must not have gone out.
        await expect(push.sendToUser("ada", (s) => ({ body: s.lang ? "short" : "x".repeat(5000) }))).rejects.toThrow(/at most 3993/);
        expect(sent).toEqual([]);
    });

    it("sends to chosen ids and lists a user's browsers", async () => {
        const { store } = fakeStore(rows);
        const { sender, sent } = fakeSender(() => ({ statusCode: 201 }));
        const push = createPushService({ store, sender, publicKey: "pk" });
        expect(await push.sendToSubscriptions(["c", "nope"], { title: "x" })).toEqual({ sent: 1, removed: 0, failed: 0 });
        expect(sent.map(s => s.target.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/c"]);
        expect((await push.subscriptionsOf("ada")).map(s => s.id)).toEqual(["a", "b"]);
        expect(push.isConfigured()).toBe(true);
        expect(push.publicKey()).toBe("pk");
    });
});

describe("createUnconfiguredPushService", () => {
    it("says why on every send, and has no key", async () => {
        const push = createUnconfiguredPushService("Push is off. Set push: true.");
        expect(push.isConfigured()).toBe(false);
        expect(push.publicKey()).toBeNull();
        await expect(push.sendToUser("ada", {})).rejects.toThrow("Push is off. Set push: true.");
        await expect(push.sendToSubscriptions(["a"], {})).rejects.toThrow("Push is off");
        await expect(push.subscriptionsOf("ada")).rejects.toThrow("Push is off");
    });
});
