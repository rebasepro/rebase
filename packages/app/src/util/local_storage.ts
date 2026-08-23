/**
 * localStorage that tolerates not being there.
 *
 * `typeof window !== "undefined"` was the guard these call sites used, and it
 * answers the wrong question: it says "am I in a browser", not "can I read
 * storage". Three things make that distinction real rather than theoretical:
 *
 * - A browser can have storage **disabled**. Safari in private mode, a blocked
 *   third-party cookie policy, and a sandboxed iframe all give you a `window`
 *   whose `localStorage` property *throws on access* — a SecurityError raised
 *   before any method is called, which no amount of null-checking the result
 *   catches.
 * - A test environment can be **half torn down**. jsdom is disposed at the end
 *   of a file while React is still finishing a concurrent render, so `window`
 *   survives as a husk and `localStorage.getItem` is no longer a function.
 *   That is how this was found: `TypeError: localStorage.getItem is not a
 *   function`, thrown out of a render, failing a suite in which every one of
 *   709 tests passed.
 * - Server rendering has no `window` at all, which is the only case the old
 *   guard actually covered.
 *
 * Reading a UI preference is never worth a crash. Every function here fails to
 * `null` / no-op, so a user with storage switched off gets the default
 * appearance instead of a blank page.
 */

/** The Storage object, or null when it is absent, blocked, or not usable. */
function usableStorage(): Storage | null {
    try {
        if (typeof window === "undefined") return null;
        const candidate = window.localStorage;
        // Not `!= null`: a torn-down jsdom leaves an object behind whose
        // methods are gone, which is exactly the shape that threw.
        return typeof candidate?.getItem === "function" ? candidate : null;
    } catch {
        // Access itself throws when storage is blocked by policy.
        return null;
    }
}

/** The stored string for `key`, or null if it is unset or unreadable. */
export function readStoredString(key: string): string | null {
    try {
        return usableStorage()?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

/** Persist `value` under `key`. A no-op when storage is unavailable. */
export function writeStoredString(key: string, value: string): void {
    try {
        usableStorage()?.setItem(key, value);
    } catch {
        // Also the quota path: a full store throws on write but reads fine.
    }
}

/** Remove `key`. A no-op when storage is unavailable. */
export function removeStoredString(key: string): void {
    try {
        usableStorage()?.removeItem(key);
    } catch {
        /* nothing to undo */
    }
}
