/**
 * A record's own entry, never one inherited from `Object.prototype`.
 *
 * The codemod looks keys up by names it read from user code, and a name can be
 * `toString` or `constructor`: `RECORD[name]` would hand back a function.
 *
 * @param record a plain record
 * @param key the key, as read
 */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
    return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
