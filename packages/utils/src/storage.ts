/**
 * Reading and writing the small amounts of JSON a UI keeps between sessions —
 * open tabs, column widths, collapsed groups, recent searches.
 *
 * Every one of those reads is a read of *aged* state: it was written by whatever
 * version of the app the user last ran, and it is parsed by this one. The same
 * class the database upgrade path is careful about, in a place nothing migrates.
 *
 * A hand-rolled `JSON.parse(localStorage.getItem(key)!)` has four ways to throw
 * and no way to recover from any of them:
 *
 *  - `localStorage` itself throws on access when storage is disabled (Safari
 *    private browsing, blocked third-party cookies) or absent (SSR, Node).
 *  - the stored text is not JSON, because a write was interrupted or a user
 *    edited it.
 *  - the stored text is valid JSON of the *wrong shape*, because an older
 *    release wrote an object where this one expects an array. `parsed.map` is
 *    then not a function.
 *  - `setItem` throws `QuotaExceededError` once the origin's few megabytes are
 *    full, which a view that persists query text on every edit will reach.
 *
 * When any of those happens inside a `useState` initializer it throws during
 * render, and the bad value is still there on reload, so the view is bricked
 * until someone opens devtools. These helpers turn all four into the fallback.
 */

export interface WebStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/**
 * The ambient `localStorage`, or `null` where there is not one. Access itself
 * is what throws when storage is disabled, so even reaching for it is guarded.
 */
export function getWebStorage(): WebStorageLike | null {
    try {
        const storage = (globalThis as { localStorage?: WebStorageLike }).localStorage;
        return storage ?? null;
    } catch {
        return null;
    }
}

export type ReadStoredJsonOptions<T> = {
    /** Returned whenever the stored value is missing, unreadable or rejected. */
    fallback: T;
    /**
     * Whether the parsed value is the shape this caller expects. Pass it
     * whenever the fallback is an array or a keyed object: valid JSON of the
     * wrong shape is the failure an upgrade actually produces, and it survives
     * `JSON.parse` untouched to fail later at the first `.map` or `.find`.
     */
    accept?: (value: unknown) => boolean;
    /** Defaults to the ambient `localStorage`. */
    storage?: WebStorageLike | null;
};

/**
 * Reads and parses a JSON value a previous session stored, falling back rather
 * than throwing. See the module comment for what it is falling back from.
 *
 * A rejected value is deliberately left in place rather than cleared: this
 * version not understanding it is not evidence that nothing does.
 */
export function readStoredJson<T>(key: string, options: ReadStoredJsonOptions<T>): T {
    const storage = options.storage === undefined ? getWebStorage() : options.storage;
    if (!storage) return options.fallback;

    let raw: string | null;
    try {
        raw = storage.getItem(key);
    } catch {
        return options.fallback;
    }
    if (raw === null || raw === "") return options.fallback;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return options.fallback;
    }

    if (options.accept && !options.accept(parsed)) return options.fallback;
    return parsed as T;
}

/**
 * Persists a value as JSON. Returns whether it was stored, so a caller that
 * cares can say so — most do not, and for them the point is simply that a full
 * quota does not throw out of the effect doing the writing.
 */
export function writeStoredJson(
    key: string,
    value: unknown,
    options: { storage?: WebStorageLike | null } = {}
): boolean {
    const storage = options.storage === undefined ? getWebStorage() : options.storage;
    if (!storage) return false;
    try {
        storage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/**
 * Persists an already-serialised string, for the values kept as plain text
 * rather than JSON — a selected id, a pane size.
 */
export function writeStoredString(
    key: string,
    value: string,
    options: { storage?: WebStorageLike | null } = {}
): boolean {
    const storage = options.storage === undefined ? getWebStorage() : options.storage;
    if (!storage) return false;
    try {
        storage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

/** Reads a plain string, absent rather than throwing where there is no storage. */
export function readStoredString(
    key: string,
    options: { storage?: WebStorageLike | null } = {}
): string | null {
    const storage = options.storage === undefined ? getWebStorage() : options.storage;
    if (!storage) return null;
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

/** `accept` for a caller whose fallback is an array. */
export const isArrayValue = (value: unknown): boolean => Array.isArray(value);

/** `accept` for a caller whose fallback is a keyed object — and not an array. */
export const isRecordValue = (value: unknown): boolean =>
    typeof value === "object" && value !== null && !Array.isArray(value);
