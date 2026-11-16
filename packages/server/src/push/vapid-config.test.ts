import { describe, expect, it } from "@jest/globals";
import type { DevSecretStore } from "../dev-secrets";
import { resolveVapid } from "./vapid-config";
import { generateVapidKeys } from "./web-push-crypto";

function memoryStore(initial: Record<string, string> = {}): DevSecretStore & { values: Record<string, string> } {
    const values = { ...initial };
    return { values, file: "mem", usable: true, get: (k) => values[k], set: (k, v) => { values[k] = v; } };
}

describe("resolveVapid", () => {
    const keys = generateVapidKeys();

    it("takes the keys from the environment", () => {
        const result = resolveVapid({
            env: { REBASE_VAPID_PUBLIC_KEY: keys.publicKey, REBASE_VAPID_PRIVATE_KEY: keys.privateKey, REBASE_VAPID_SUBJECT: "mailto:ops@example.com" },
            isProduction: true
        });
        expect(result).toEqual({ ok: true, keys, subject: "mailto:ops@example.com", source: "env" });
    });

    it("prefers the options over the environment", () => {
        const other = generateVapidKeys();
        const result = resolveVapid({
            vapid: { ...other, subject: "https://example.com" },
            env: { REBASE_VAPID_PUBLIC_KEY: keys.publicKey, REBASE_VAPID_PRIVATE_KEY: keys.privateKey },
            isProduction: true
        });
        expect(result).toMatchObject({ ok: true, keys: other, subject: "https://example.com", source: "options" });
    });

    it("refuses half a pair, a mismatched pair, and a bad subject", () => {
        expect(resolveVapid({ env: { REBASE_VAPID_PUBLIC_KEY: keys.publicKey }, isProduction: false }))
            .toMatchObject({ ok: false, reason: expect.stringMatching(/only one is set/) });
        expect(resolveVapid({ env: { REBASE_VAPID_PUBLIC_KEY: generateVapidKeys().publicKey, REBASE_VAPID_PRIVATE_KEY: keys.privateKey }, isProduction: false }))
            .toMatchObject({ ok: false, reason: expect.stringMatching(/does not belong/) });
        expect(resolveVapid({ vapid: { ...keys, subject: "ops@example.com" }, env: {}, isProduction: false }))
            .toMatchObject({ ok: false, reason: expect.stringMatching(/mailto: address or an https/) });
    });

    it("generates nothing in production, and names the variables", () => {
        const store = memoryStore();
        const result = resolveVapid({ env: {}, isProduction: true, devStore: store });
        expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/REBASE_VAPID_PUBLIC_KEY and REBASE_VAPID_PRIVATE_KEY/) });
        expect(store.values).toEqual({});
    });

    it("needs a contact in production, and takes the public URL's origin for one", () => {
        const env = { REBASE_VAPID_PUBLIC_KEY: keys.publicKey, REBASE_VAPID_PRIVATE_KEY: keys.privateKey };
        expect(resolveVapid({ env, isProduction: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/REBASE_VAPID_SUBJECT/) });
        expect(resolveVapid({ env: { ...env, REBASE_PUBLIC_URL: "https://app.example.com/api" }, isProduction: true }))
            .toMatchObject({ ok: true, subject: "https://app.example.com" });
    });

    it("outside production, generates a pair once and keeps it across restarts", () => {
        const store = memoryStore();
        const first = resolveVapid({ env: {}, isProduction: false, devStore: store });
        expect(first).toMatchObject({ ok: true, source: "dev" });
        expect(store.values.REBASE_VAPID_PUBLIC_KEY).toBe(first.ok ? first.keys.publicKey : undefined);
        const second = resolveVapid({ env: {}, isProduction: false, devStore: store });
        expect(second.ok && first.ok && second.keys).toEqual(first.ok && first.keys);
    });

    it("replaces a cached pair that is not usable", () => {
        const store = memoryStore({ REBASE_VAPID_PUBLIC_KEY: "junk", REBASE_VAPID_PRIVATE_KEY: keys.privateKey });
        const result = resolveVapid({ env: {}, isProduction: false, devStore: store });
        expect(result.ok).toBe(true);
        expect(store.values.REBASE_VAPID_PUBLIC_KEY).not.toBe("junk");
    });
});
