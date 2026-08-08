import { isPrototypePollutingKey, pathTraversesPrototype } from "@rebasepro/utils";

/**
 * Take an object with keys of type `address.street`, `address.city` and
 * convert it to an object with nested objects like `{ address: { street: ..., city: ... } }`
 *
 * Keys here are the **header row of an uploaded file**, so they are attacker
 * data. `res["__proto__"] = …` is the prototype setter rather than an own
 * property, so a column named `__proto__.polluted` walked out of the accumulator
 * and wrote onto `Object.prototype` for the life of the tab — and
 * `constructor.prototype.x` threw a `TypeError` that surfaced as an unreadable
 * file. Such a column is refused, not sanitised, the way `setIn` settled it
 * (`docs/bug-classes.md` class 22).
 *
 * @param flatObj
 */
export function unflattenObject(flatObj: { [key: string]: any }) {
    return Object.keys(flatObj).reduce((nestedObj, key) => {
        // The string form, so `toPath` rewrites `__proto__[0]` to a `__proto__`
        // segment too — the bracket branch below writes through the same setter.
        if (pathTraversesPrototype(key)) {
            console.warn(`Skipping column "${key}": a header may not reach the prototype chain`);
            return nestedObj;
        }
        let currentObj = nestedObj;
        const keyParts = key.split(".");
        keyParts.forEach((keyPart, i) => {

            if (/^[\w]+\[\d+\]$/.test(keyPart)) {
                const mainPropertyName = keyPart.slice(0, keyPart.indexOf("["));
                const index = parseInt(keyPart.slice(keyPart.indexOf("[") + 1, keyPart.indexOf("]")));

                if (!currentObj[mainPropertyName]) {
                    currentObj[mainPropertyName] = []
                }

                if (i !== keyParts.length - 1) {
                    currentObj[mainPropertyName][index] = currentObj[mainPropertyName][index] || {};
                    currentObj = currentObj[mainPropertyName][index];
                } else {
                    currentObj[mainPropertyName][index] = flatObj[key];
                }
            } else if (i !== keyParts.length - 1) {
                currentObj[keyPart] = currentObj[keyPart] || {};
                currentObj = currentObj[keyPart];
            } else {
                currentObj[keyPart] = flatObj[key];
            }

        });
        return nestedObj;
    }, {} as { [key: string]: any });
}

export function mapJsonParse(obj: Record<string, any>) {
    return Object.keys(obj).reduce((acc: Record<string, any>, key) => {
        // Same header row, same setter: `acc["__proto__"] = value` replaces the
        // accumulator's prototype instead of adding a column.
        if (isPrototypePollutingKey(key)) {
            console.warn(`Skipping column "${key}": a header may not reach the prototype chain`);
            return acc;
        }
        try {
            acc[key] = JSON.parse(obj[key]);
        } catch (e) {
            acc[key] = obj[key];
        }
        return acc;
    }, {});
}
