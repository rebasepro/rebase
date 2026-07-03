export function flatMapSnapshotValues<M extends object>(values: M, path = ""): object {
    if (!values) return {};
    return Object.entries(values).flatMap(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof value === "object") {
            return flatMapSnapshotValues(value, currentPath);
        } else {
            return { [currentPath]: value };
        }
    }).reduce((acc, curr) => ({ ...acc,
...curr }), {})
}
