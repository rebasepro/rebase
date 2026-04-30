import { z } from "zod";

function toPath(value: string | string[]) {
    if (Array.isArray(value)) return value; // Already in path array form.
    // Replace brackets with dots, remove leading/trailing dots, then split by dot.
    return value
        .replace(/\[/g, ".")
        .replace(/\]/g, "")
        .replace(/^\./, "")
        .replace(/\.$/, "")
        .split(".");
}

export const isInteger = (obj: unknown): boolean =>
    String(Math.floor(Number(obj))) === obj;
export const isObject = (obj: unknown): obj is Record<string, unknown> =>
    obj !== null && typeof obj === "object";

export function getIn(
    obj: any,
    key: string | string[],
    def?: unknown,
    p = 0
): any {
    const path = toPath(key);
    let current: unknown = obj;
    while (current && p < path.length) {
        current = (current as Record<string, unknown>)[path[p++]];
    }
    if (p !== path.length && !current) {
        return def;
    }
    return current === undefined ? def : current;
}

export function clone(value: unknown): unknown {
    if (Array.isArray(value)) {
        return [...value];
    } else if (typeof value === "object" && value !== null) {
        return { ...(value as Record<string, unknown>) };
    } else {
        return value;
    }
}

export function setIn(obj: any, path: string, value: unknown): any {
    const res = clone(obj) as Record<string, unknown>; // this keeps inheritance when obj is a class
    let resVal: Record<string, unknown> = res;
    let i = 0;
    const pathArray = toPath(path);

    for (; i < pathArray.length - 1; i++) {
        const currentPath: string = pathArray[i];
        const currentObj = getIn(obj, pathArray.slice(0, i + 1));

        if (currentObj && (isObject(currentObj) || Array.isArray(currentObj))) {
            resVal = resVal[currentPath] = clone(currentObj) as Record<string, unknown>;
        } else {
            const nextPath: string = pathArray[i + 1];
            resVal = resVal[currentPath] =
                (isInteger(nextPath) && Number(nextPath) >= 0 ? [] : {}) as Record<string, unknown>;
        }
    }

    if ((i === 0 ? obj : resVal)[pathArray[i]] === value) {
        return obj;
    }
    if (value === undefined) {
        delete resVal[pathArray[i]];
    } else {
        resVal[pathArray[i]] = value;
    }
    if (i === 0 && value === undefined) {
        delete res[pathArray[i]];
    }
    return res;
}

export function zodToFormErrors(zodError: z.ZodError): Record<string, any> {
    let errors: Record<string, any> = {};
    for (const issue of zodError.issues) {
        const path = issue.path.join(".");
        if (path && !getIn(errors, path)) {
            errors = setIn(errors, path, issue.message);
        }
    }
    return errors;
}

const schema = z.object({
    jsonb_prop: z.object({
        child_prop: z.string().min(3)
    }).passthrough()
});

const result = schema.safeParse({ jsonb_prop: { child_prop: "a" } });
if (!result.success) {
    const errors = zodToFormErrors(result.error);
    console.log(JSON.stringify(errors, null, 2));
    console.log("getIn:", getIn(errors, "jsonb_prop.child_prop"));
}
