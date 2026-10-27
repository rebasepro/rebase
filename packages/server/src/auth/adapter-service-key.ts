/**
 * One backend's view of an auth adapter the caller built.
 *
 * A backend whose adapter has no `serviceKey` mints a per-boot internal key and
 * has to tell the adapter about it, so the adapter and the socket recognise the
 * in-process client's control-plane calls. It used to write the key onto the
 * adapter instance. That instance is the caller's, and a caller who builds two
 * backends from one adapter got one key for both: the second backend's write
 * replaced nothing (the first had already set it) and adopted the first one's
 * key, so the credential that opens one backend opened the other.
 *
 * This answers `serviceKey` with the backend's own key and leaves the instance
 * untouched. Everything else is the instance's.
 *
 * A method's `this` depends on what the adapter is. An object literal — what
 * `createCustomAuthAdapter` returns, and every documented example — cannot hold
 * private fields, so its methods run with `this` as the view and read the key as
 * they read it from the instance before. A class instance may hold `#private`
 * fields, which only the instance itself can read, so its methods run with
 * `this` as the instance; a method of one that reads `this.serviceKey` sees the
 * value the caller configured on it.
 */
import type { AuthAdapter } from "@rebasepro/types";

export function withBackendServiceKey(adapter: AuthAdapter, serviceKey: string): AuthAdapter {
    let key = serviceKey;
    const prototype = Object.getPrototypeOf(adapter);
    const plainObject = prototype === Object.prototype || prototype === null;
    // Bound once per method, so reading one twice gives the same function — a
    // caller comparing or unsubscribing by identity keeps working.
    const bound = new Map<PropertyKey, { original: (...args: unknown[]) => unknown; bound: (...args: unknown[]) => unknown }>();

    return new Proxy(adapter, {
        get(target, property, receiver) {
            if (property === "serviceKey") return key;
            if (plainObject) return Reflect.get(target, property, receiver);
            const value: unknown = Reflect.get(target, property, target);
            if (typeof value !== "function") return value;
            const original = value as (...args: unknown[]) => unknown;
            const cached = bound.get(property);
            if (cached && cached.original === original) return cached.bound;
            const fresh = original.bind(target);
            bound.set(property, { original, bound: fresh });
            return fresh;
        },
        set(target, property, value, receiver) {
            // Still this backend's: a write here must not reach the instance
            // another backend reads.
            if (property === "serviceKey") {
                key = value as string;
                return true;
            }
            return plainObject ? Reflect.set(target, property, value, receiver) : Reflect.set(target, property, value, target);
        },
        has(target, property) {
            return property === "serviceKey" || Reflect.has(target, property);
        }
    });
}
