import { describe, expect, it } from "@jest/globals";
import { acceptAuthSecret, acceptEndpoint, acceptLang, acceptP256dh, isValidTopic, subscriptionIdOf } from "./subscription-input";
import { generateVapidKeys } from "./web-push-crypto";

describe("acceptEndpoint", () => {
    it.each([
        "https://fcm.googleapis.com/fcm/send/abc:def",
        "https://android.googleapis.com/gcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
        "https://web.push.apple.com/QGuQyavXutnMH",
        "https://api.push.apple.com/3/device/abc",
        "https://wns2-par02p.notify.windows.com/w/?token=abc"
    ])("takes the browsers' push services: %s", (endpoint) => {
        expect(acceptEndpoint(endpoint)).toBe(endpoint);
    });

    it.each([
        ["plain http", "http://fcm.googleapis.com/fcm/send/abc"],
        ["a look-alike host", "https://fcm.googleapis.com.evil.example/fcm/send/abc"],
        ["a host that only ends with the name", "https://evilfcm.googleapis.com/x"],
        ["cloud metadata", "https://169.254.169.254/latest/meta-data"],
        ["localhost", "https://localhost/push"],
        ["a non-default port", "https://fcm.googleapis.com:8443/fcm/send/abc"],
        ["credentials in the URL", "https://user:pass@fcm.googleapis.com/fcm/send/abc"],
        ["not a URL", "fcm.googleapis.com/abc"],
        ["not a string", 42]
    ])("refuses %s", (_label, endpoint) => {
        expect(acceptEndpoint(endpoint)).toBeNull();
    });

    it("takes an extra host exactly as named, port and all", () => {
        expect(acceptEndpoint("https://127.0.0.1:8443/push/1", ["127.0.0.1:8443"])).toBe("https://127.0.0.1:8443/push/1");
        expect(acceptEndpoint("https://push.internal.example/1", ["push.internal.example"])).toBe("https://push.internal.example/1");
        expect(acceptEndpoint("https://127.0.0.1:9999/push/1", ["127.0.0.1:8443"])).toBeNull();
        expect(acceptEndpoint("http://push.internal.example/1", ["push.internal.example"])).toBeNull();
    });
});

describe("the browser's keys", () => {
    it("takes a P-256 point and a 16-byte secret, base64url or padded base64", () => {
        const point = generateVapidKeys().publicKey;
        expect(acceptP256dh(point)).toBe(point);
        expect(acceptP256dh(`${Buffer.from(point, "base64url").toString("base64")}`)).not.toBeNull();
        expect(acceptAuthSecret(Buffer.alloc(16, 1).toString("base64url"))).not.toBeNull();
        expect(acceptAuthSecret(`${Buffer.alloc(16, 1).toString("base64")}`)).not.toBeNull();
    });

    it("refuses anything else", () => {
        expect(acceptP256dh(Buffer.alloc(65, 5).toString("base64url"))).toBeNull(); // not an uncompressed point
        expect(acceptP256dh("not base64!")).toBeNull();
        expect(acceptAuthSecret(Buffer.alloc(12).toString("base64url"))).toBeNull();
        expect(acceptAuthSecret(undefined)).toBeNull();
    });
});

describe("the rest", () => {
    it("reads a language tag or nothing", () => {
        expect(acceptLang("es")).toBe("es");
        expect(acceptLang("pt-BR")).toBe("pt-BR");
        expect(acceptLang("<script>")).toBeNull();
        expect(acceptLang(7)).toBeNull();
    });

    it("keys a subscription by 24 characters of the endpoint's SHA-256", () => {
        // The same hash SongBuzz keyed its rows by, so its ids carry over.
        expect(subscriptionIdOf("https://fcm.googleapis.com/fcm/send/abc")).toMatch(/^[A-Za-z0-9_-]{24}$/);
        expect(subscriptionIdOf("https://fcm.googleapis.com/fcm/send/abc")).toBe(subscriptionIdOf("https://fcm.googleapis.com/fcm/send/abc"));
        expect(subscriptionIdOf("https://fcm.googleapis.com/fcm/send/abd")).not.toBe(subscriptionIdOf("https://fcm.googleapis.com/fcm/send/abc"));
    });

    it("takes topics the push services take", () => {
        expect(isValidTopic("daily-remind_1")).toBe(true);
        expect(isValidTopic("x".repeat(33))).toBe(false);
        expect(isValidTopic("has space")).toBe(false);
    });
});
