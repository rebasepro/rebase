/**
 * PII masking helpers shared by tables' `afterRead` hooks.
 *
 * Masking lives in a table's `hooks.afterRead`, which runs on **every** read
 * path — REST, realtime/WebSocket, MCP and server-side `rebase.data`. See
 * `backend/schema/users.ts` for how these are applied.
 */
/** `john.doe@acme.com` → `j***@acme.com`. */
export function maskEmail(email) {
    const [local, domain] = email.split("@");
    if (local && domain) {
        return `${local[0]}***@${domain}`;
    }
    return email;
}
/** `John Doe` → `J*** D***`. */
export function maskName(name) {
    return name
        .split(/\s+/)
        .map((word) => (word && word[0] ? word[0] + "***" : ""))
        .join(" ");
}
/** Keeps the first 5 chars, masks the remaining digits. */
export function maskPhone(phone) {
    if (phone.length <= 5)
        return "***";
    return phone.substring(0, 5) + phone.substring(5).replace(/[0-9]/g, "*");
}
/** `@username` → `@u***`; `username` → `u***`. */
export function maskHandle(handle) {
    if (handle.startsWith("@")) {
        return handle[1] ? `@${handle[1]}***` : "@***";
    }
    return handle[0] ? `${handle[0]}***` : "***";
}
/**
 * Apply a set of field transforms to a entity's `values`, returning a new
 * values object of the same shape. String fields are transformed by the
 * matching masker; any field mapped to `null` is cleared to an empty string
 * (used for image/URL fields). Non-string / absent fields are left untouched.
 *
 * Masker keys are constrained to `keyof T`, so a typo or a field that doesn't
 * exist on the collection is a compile error.
 */
export function maskValues(values, maskers) {
    const masked = { ...values };
    for (const [field, masker] of Object.entries(maskers)) {
        const value = masked[field];
        if (masker === null) {
            if (value)
                masked[field] = "";
        }
        else if (masker && typeof value === "string") {
            masked[field] = masker(value);
        }
    }
    return masked;
}
