/**
 * PII masking helpers shared by collection `afterRead` callbacks.
 *
 * Masking lives in per-collection {@link EntityCallbacks.afterRead},
 * which runs on **every** read path — REST, realtime/WebSocket, and
 * server-side `rebase.data`. See each collection under
 * `app/config/collections/*` for how these are applied.
 */

/** `john.doe@acme.com` → `j***@acme.com`. */
export function maskEmail(email: string): string {
    const [local, domain] = email.split("@");
    if (local && domain) {
        return `${local[0]}***@${domain}`;
    }
    return email;
}

/** `John Doe` → `J*** D***`. */
export function maskName(name: string): string {
    return name
        .split(/\s+/)
        .map((word) => (word && word[0] ? word[0] + "***" : ""))
        .join(" ");
}

/** Keeps the first 5 chars, masks the remaining digits. */
export function maskPhone(phone: string): string {
    if (phone.length <= 5) return "***";
    return phone.substring(0, 5) + phone.substring(5).replace(/[0-9]/g, "*");
}

/** `@username` → `@u***`; `username` → `u***`. */
export function maskHandle(handle: string): string {
    if (handle.startsWith("@")) {
        return handle[1] ? `@${handle[1]}***` : "@***";
    }
    return handle[0] ? `${handle[0]}***` : "***";
}

/**
 * Apply a set of field transforms to an entity's `values`, returning a new
 * values object of the same shape. String fields are transformed by the
 * matching masker; any field mapped to `null` is cleared to an empty string
 * (used for image/URL fields). Non-string / absent fields are left untouched.
 *
 * Masker keys are constrained to `keyof T`, so a typo or a field that doesn't
 * exist on the collection is a compile error.
 */
export function maskValues<T extends Record<string, unknown>>(
    values: T,
    maskers: Partial<Record<keyof T, ((value: string) => string) | null>>
): T {
    const masked = { ...values } as Record<string, unknown>;
    for (const [field, masker] of Object.entries(maskers) as [string, ((value: string) => string) | null][]) {
        const value = masked[field];
        if (masker === null) {
            if (value) masked[field] = "";
        } else if (masker && typeof value === "string") {
            masked[field] = masker(value);
        }
    }
    return masked as T;
}
