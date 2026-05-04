function equal(a: any, b: any) {
    return JSON.stringify(a) === JSON.stringify(b);
}

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
        } else if (sourceValue && typeof sourceValue === "object" && comparisonValue && typeof comparisonValue === "object") {
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

const initialValues = {
    content: [
        { type: "text", value: "Initial text" }
    ]
};

const newValues = {
    content: [
        { type: "text", value: "Initial text" },
        { type: "image", value: "test.jpg" }
    ]
};

console.log("Changes:");
console.log(JSON.stringify(getChanges(newValues, initialValues), null, 2));

const initialValues2 = {
    content: []
};

const newValues2 = {
    content: [
        { type: "text", value: "test" }
    ]
};

console.log("Changes 2:");
console.log(JSON.stringify(getChanges(newValues2, initialValues2), null, 2));
