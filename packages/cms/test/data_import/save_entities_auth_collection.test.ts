import { describe, expect, test } from "@jest/globals";
import { Entity, RebaseApiError, RebaseData } from "@rebasepro/types";
import { saveImportedEntities } from "../../src/data_import/utils/save_entities";

/**
 * Importing into the users collection.
 *
 * The import sent every batch as `POST /bulk` with `upsert: true`, and the
 * server refuses an upsert on the auth collection (`INVALID_CONFLICT_TARGET`):
 * a create there hashes the password and runs `onCreateUser`, an update may
 * not demote the last administrator, and an upsert can follow neither rule.
 * So every users import failed with a 400. The rows whose id is stored are
 * sent as updates, the rest as a plain bulk create.
 */

const users = {
    slug: "users",
    name: "Users",
    auth: true,
    properties: {
        id: { type: "string", isId: "uuid" },
        email: { type: "string", validation: { required: true } },
        roles: { type: "array", of: { type: "string" } }
    }
} as never;

function makeClient(existing: Record<string, Record<string, unknown>>) {
    const stored = new Map(Object.entries(existing));
    const calls: { op: string; rows: number; upsert?: boolean }[] = [];
    const accessor = {
        async create() {
            throw new Error("not used");
        },
        async update() {
            throw new Error("not used");
        },
        async findById(id: string) {
            return stored.has(id) ? { id, path: "users", values: stored.get(id) } : undefined;
        },
        async find({ where }: { where: Record<string, [string, string[]]> }) {
            const ids = where.id[1];
            return { data: ids.filter(id => stored.has(id)).map(id => ({ id, path: "users", values: stored.get(id) })) };
        },
        async createMany(rows: Record<string, unknown>[], options?: { upsert?: boolean }) {
            calls.push({ op: "createMany", rows: rows.length, upsert: options?.upsert });
            // As the server does on the auth collection.
            if (options?.upsert === true) {
                throw new RebaseApiError("An upsert is not accepted on \"users\", whose rows are the users.",
                    { status: 400, code: "INVALID_CONFLICT_TARGET" as never });
            }
            rows.forEach(row => {
                if (row.id !== undefined && stored.has(String(row.id))) {
                    throw new RebaseApiError("duplicate key", { status: 409, code: "CONFLICT" as never });
                }
            });
            rows.forEach(row => stored.set(String(row.id ?? `new-${stored.size}`), { ...row, passwordHash: "hashed" }));
            return rows.map(row => ({ id: row.id, path: "users", values: row }));
        },
        async updateMany(updates: { id: string; data: Record<string, unknown> }[]) {
            calls.push({ op: "updateMany", rows: updates.length });
            updates.forEach(({ id, data }) => stored.set(id, { ...stored.get(id), ...data }));
            return updates.map(({ id, data }) => ({ id, path: "users", values: data }));
        }
    };
    const dataClient = { collection: () => accessor } as unknown as RebaseData;
    return { dataClient, stored, calls };
}

const row = (id: string | undefined, values: Record<string, unknown>): Partial<Entity<any>> =>
    ({ ...(id ? { id } : {}), path: "users", values });

describe("an import into the auth collection", () => {
    test("updates the stored users and creates the rest, never asking for an upsert", async () => {
        const { dataClient, stored, calls } = makeClient({
            "u-1": { id: "u-1", email: "ada@example.com", roles: ["admin"], passwordHash: "ada-hash" }
        });

        await saveImportedEntities(dataClient, "users", [
            row("u-1", { roles: ["admin", "editor"] }),
            row("u-2", { email: "bob@example.com" }),
            row(undefined, { email: "cy@example.com" })
        ], { collection: users });

        expect(calls.some(call => call.upsert === true)).toBe(false);
        expect(calls).toEqual([
            { op: "updateMany", rows: 1 },
            { op: "createMany", rows: 2, upsert: undefined }
        ]);
        // The stored user keeps its password hash: it was updated, not re-created.
        expect(stored.get("u-1")).toEqual({ id: "u-1", email: "ada@example.com", roles: ["admin", "editor"], passwordHash: "ada-hash" });
        expect(stored.get("u-2")).toMatchObject({ email: "bob@example.com" });
    });

    test("a file of new users is one bulk create", async () => {
        const { dataClient, calls } = makeClient({});

        await saveImportedEntities(dataClient, "users", [
            row(undefined, { email: "a@example.com" }),
            row(undefined, { email: "b@example.com" })
        ], { collection: users });

        expect(calls).toEqual([{ op: "createMany", rows: 2, upsert: undefined }]);
    });

    test("an auth collection declared as an object is detected too", async () => {
        const { dataClient, calls } = makeClient({ "u-1": { id: "u-1", email: "ada@example.com" } });
        const objectAuthUsers = { ...(users as object), auth: { enabled: true } } as never;

        await saveImportedEntities(dataClient, "users", [row("u-1", { email: "ada@example.org" })], { collection: objectAuthUsers });

        expect(calls).toEqual([{ op: "updateMany", rows: 1 }]);
    });
});
