export function removeClassesFromJson(jsonObj: unknown): unknown {
    // If it's an array, apply the function to each element
    if (Array.isArray(jsonObj)) {
        return jsonObj.map(item => removeClassesFromJson(item));
    } else if (typeof jsonObj === "object" && jsonObj !== null) { // If it's an object, recurse through its properties
        const obj = jsonObj as Record<string, unknown>;
        // If the object has an `attrs` property and `class` field, delete the `class` field
        if (obj.attrs && typeof obj.attrs === "object" && obj.attrs !== null && "class" in (obj.attrs as Record<string, unknown>)) {
            delete (obj.attrs as Record<string, unknown>).class;
        }

        // Apply the function recursively to object properties
        Object.keys(obj).forEach(key => {
            obj[key] = removeClassesFromJson(obj[key]);
        });
    }
    return jsonObj;
}
