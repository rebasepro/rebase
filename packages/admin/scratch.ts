import { deepEqual as equal } from "fast-equals";

const isObject = (item) => item && typeof item === "object" && !Array.isArray(item);

export function getChanges<T extends object>(source: Partial<T>, comparison: Partial<T>): Partial<T> {
    const changes: Partial<T> = {};

    if (!source) {
        return {};
    }
    if (!comparison) {
        return source;
    }

    const allKeys = Array.from(new Set([...Object.keys(source), ...Object.keys(comparison)]));

    for (const key of allKeys) {
        const sourceValue = (source as Record<string, unknown>)[key];
        const comparisonValue = (comparison as Record<string, unknown>)[key];

        if (equal(sourceValue, comparisonValue)) {
            continue;
        }

        const sourceHasKey = source && typeof source === "object" && Object.prototype.hasOwnProperty.call(source, key);
        const comparisonHasKey = comparison && typeof comparison === "object" && Object.prototype.hasOwnProperty.call(comparison, key);

        if (comparisonHasKey && !sourceHasKey) {
            (changes as Record<string, unknown>)[key] = undefined;
        } else if (Array.isArray(sourceValue)) {
            const comparisonArray = Array.isArray(comparisonValue) ? comparisonValue : [];
            if (sourceValue.length !== comparisonArray.length) {
                (changes as Record<string, unknown>)[key] = sourceValue;
                continue;
            }
            const hasChanges = sourceValue.some((item, index) => !equal(item, comparisonArray[index]));
            if (hasChanges) {
                (changes as Record<string, unknown>)[key] = sourceValue;
            }
        } else if (isObject(sourceValue) && sourceValue && isObject(comparisonValue) && comparisonValue) {
            const nestedChanges = getChanges(sourceValue, comparisonValue);
            if (Object.keys(nestedChanges).length > 0) {
                (changes as Record<string, unknown>)[key] = nestedChanges;
            }
        } else {
            (changes as Record<string, unknown>)[key] = sourceValue;
        }
    }

    return changes;
}

const source = {
  content: [
    { type: "text",
value: "hello" },
    { type: "image",
value: "test.png" }
  ]
};

const comparison = {
  content: [
    { type: "text",
value: "hello" },
    { type: "image",
value: "old.png" }
  ]
};

console.log(JSON.stringify(getChanges(source, comparison), null, 2));

