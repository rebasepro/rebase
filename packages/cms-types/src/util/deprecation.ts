/**
 * Deprecated aliases on the objects the panel hands to user code.
 *
 * @module
 */
import { warnDeprecated } from "@rebasepro/common";

/**
 * Give `target` a deprecated property `alias` that reads `target[key]`, the
 * name that replaced it, and warns once per process (via `warnDeprecated` from `@rebasepro/common`,
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
