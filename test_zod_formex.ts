import { z } from "zod";
import { setIn, getIn } from "./packages/formex/src/utils.js";

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
