/**
 * Small typed builders shared by the server-postgres tests: a complete `User`,
 * and an empty `TableMetadata`.
 */
import type { TableMetadata, User } from "@rebasepro/types";

/** A complete `User`: the required profile fields filled in, the rest from `overrides`. */
export function testUser(overrides: Partial<User> & { uid: string }): User {
    return {
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "password",
        isAnonymous: false,
        ...overrides
    };
}

/** A `TableMetadata` with nothing in it but the given columns. */
export function tableMetadata(columns: TableMetadata["columns"] = []): TableMetadata {
    return { columns, foreignKeys: [], junctions: [], policies: [] };
}
