/**
 * Keys already warned about in this process. A deprecated name is usually
 * reached on a hot path — every request, every render — and one line naming
 * the replacement is enough; repeating it buries everything else in the log.
 */
const warnedKeys = new Set<string>();

/**
 * Say once, per process, that a deprecated public name was used.
 *
 * `key` identifies the deprecated name (`"client.ws.setAuthTokenGetter"`):
 * the first call with a key prints `message` with `console.warn`, every later
 * call with the same key prints nothing. `message` should name the
 * replacement, so the warning is the whole migration instruction.
 *
 * Node-free and browser-safe: it touches nothing but `console`.
 *
 * @example
 * ```ts
 * // Declared with `@deprecated Use \`newName\` instead.` in its JSDoc.
 * export function oldName(...args: Parameters<typeof newName>) {
 *     warnDeprecated("oldName", "`oldName` is deprecated; use `newName` instead.");
 *     return newName(...args);
 * }
 * ```
 */
export function warnDeprecated(key: string, message: string): void {
    if (warnedKeys.has(key)) return;
    warnedKeys.add(key);
    console.warn(`[Rebase] Deprecated: ${message}`);
}

/**
 * Give `target` a deprecated property `alias` that reads `target[key]`, the
 * name that replaced it, and warns once per process (via {@link warnDeprecated},
 * under `warnKey`) the first time anyone reads it.
 *
 * For an object Rebase hands to user code — a builder's props, a callback's
 * context — after one of its keys was renamed: untyped code reading the old
 * name keeps getting the value instead of `undefined`. The alias is a
 * non-enumerable getter, so spreading the object, `Object.keys`, JSON and
 * equality checks do not see it, and nothing warns unless the old name is read.
 *
 * Returns `target`, for use inline.
 */
export function withDeprecatedAlias<T extends object>(
    target: T,
    alias: string,
    key: keyof T & string,
    warnKey: string,
    message: string
): T {
    Object.defineProperty(target, alias, {
        configurable: true,
        enumerable: false,
        get: () => {
            warnDeprecated(warnKey, message);
            return target[key];
        }
    });
    return target;
}

/**
 * Forget which keys have been warned about, so a test can assert that a
 * deprecated name warns — once — regardless of what ran before it.
 *
 * @internal For tests only.
 */
export function resetDeprecationWarningsForTests(): void {
    warnedKeys.clear();
}
