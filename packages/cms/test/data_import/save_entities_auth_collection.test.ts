import { describe, expect, test } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import { type CollectionConfig, type Entity } from "@rebasepro/cms-types";
import { saveImportedEntities } from "../../src/data_import/utils/save_entities";
import { entityOf, foundRows, idsAskedFor, importAccessor, importClient, notUsed } from "./import_accessor";

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

const users: CollectionConfig = {
    slug: "users",
    name: "Users",
    auth: true,
    properties: {
        id: { type: "string", isId: "uuid" },
        email: { type: "string", validation: { required: true } },
        roles: { type: "array", of: { type: "string" } }
    }
};

function makeClient(existing: Record<string, Record<string, unknown>>) {
    const stored = new Map(Object.entries(existing));
    const calls: { op: string; rows: number; upsert?: boolean }[] = [];
    const storedEntity = (id: string) => entityOf(id, "users", stored.get(id));
    const accessor = importAccessor({
        async findById(id) {
            return stored.has(String(id)) ? storedEntity(String(id)) : undefined;
        },
        async find(params) {
            return foundRows(idsAskedFor(params).filter(id => stored.has(id)).map(storedEntity));
        },
        async createMany(rows, options) {
            calls.push({ op: "createMany", rows: rows.length, upsert: options?.upsert });
            // As the server does on the auth collection.
            if (options?.upsert === true) {
                throw new RebaseApiError("An upsert is not accepted on \"users\", whose rows are the users.",
                    { status: 400, code: "INVALID_CONFLICT_TARGET" });
            }
            rows.forEach(row => {
                if (row.id !== undefined && stored.has(String(row.id))) {
                    throw new RebaseApiError("duplicate key", { status: 409, code: "CONFLICT" });
                }
            });
            rows.forEach(row => stored.set(String(row.id ?? `new-${stored.size}`), { ...row, passwordHash: "hashed" }));
            return rows.map(row => entityOf(String(row.id), "users", row));
        },
        async updateMany(updates) {
            calls.push({ op: "updateMany", rows: updates.length });
            updates.forEach(({ id, data }) => stored.set(String(id), { ...stored.get(String(id)), ...data }));
            return updates.map(({ id, data }) => entityOf(id, "users", data));
        }
    });
    return { dataClient: importClient(accessor), stored, calls };
}

const row = (id: string | undefined, values: Record<string, unknown>): Partial<Entity> =>
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
        const objectAuthUsers: CollectionConfig = { ...users, auth: { enabled: true } };

        await saveImportedEntities(dataClient, "users", [row("u-1", { email: "ada@example.org" })], { collection: objectAuthUsers });

        expect(calls).toEqual([{ op: "updateMany", rows: 1 }]);
    });

    /**
     * The server holds a chosen password to the password policy, and an
     * administrator may waive it for an import: the accounts in the file had
     * their passwords set under another system's rules. The import says so for
     * the rows that carry a password, and only for those.
     */
    test("asks the server to waive the password policy for the rows that carry a password", async () => {
        const sent: Record<string, unknown>[] = [];
        const accessor = importAccessor({
            async find() {
                return foundRows([]);
            },
            async createMany(rows) {
                sent.push(...rows);
                return rows.map(row => entityOf(String(row.id), "users", row));
            }
        });

        await saveImportedEntities(importClient(accessor), "users", [
            row(undefined, { email: "a@example.com", password: "legacy" }),
            row(undefined, { email: "b@example.com" })
        ], { collection: users });

        expect(sent).toEqual([
            { email: "a@example.com", password: "legacy", skipPasswordPolicy: true },
            { email: "b@example.com" }
        ]);
    });

    test("asks for the waiver one row at a time too, where the data source has no bulk create", async () => {
        const sent: Record<string, unknown>[] = [];
        const accessor = importAccessor({
            async create(values) {
                sent.push(values);
                return entityOf("new", "users", values);
            },
            update: notUsed
        });

        await saveImportedEntities(importClient(accessor), "users", [
            row(undefined, { email: "a@example.com", password: "legacy" })
        ], { collection: users });

        expect(sent).toEqual([{ email: "a@example.com", password: "legacy", skipPasswordPolicy: true }]);
    });

    test("never adds the flag on a collection that is not the users", async () => {
        const sent: Record<string, unknown>[] = [];
        const accessor = importAccessor({
            async createMany(rows) {
                sent.push(...rows);
                return rows.map(row => entityOf(String(row.id), "accounts", row));
            }
        });
        const accounts: CollectionConfig = { ...users, slug: "accounts", auth: undefined };

        await saveImportedEntities(importClient(accessor), "accounts", [row(undefined, { email: "a@example.com", password: "x" })], { collection: accounts });

        expect(sent).toEqual([{ email: "a@example.com", password: "x" }]);
    });
});
