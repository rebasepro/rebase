import { describe, it, expect } from "@jest/globals";
import { col, defineAuthTable, defineTable, rel, type TableDescriptor } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";
import { ColumnOrigins, withoutUnreadableColumns, type ResultField } from "../src/security/caller-sql-columns";

/**
 * SQL run as the caller returns rows the SDK never walked, so the columns the
 * caller may not read are taken out of them here — read from the served
 * tables' descriptors: `.private()`, `.access({ read })`, a relation's
 * `access` / `private` (which takes its foreign key with it), and the auth
 * table's secrets, which the compiler marks private.
 */
const bands = defineTable("bands", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    rls: "admin-only"
});
const staff = defineTable("staff", {
    columns: {
        id: col.serial().primaryKey(),
        name: col.text(),
        salary: col.integer().access({ read: ["hr"] }),
        apiKey: col.text().private(),
        bandId: col.integer()
    },
    relations: { band: rel.belongsTo(() => bands, { localKey: "band_id", access: { read: ["hr"] } }) },
    rls: "admin-only"
});
const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey(),
        email: col.text(),
        passwordHash: col.text(),
        emailVerificationToken: col.text()
    },
    rls: "admin-only"
});

const tables: TableDescriptor[] = compileSchema([bands, staff, users]).map(table => table.descriptor);
const noCatalogue = async (): Promise<Record<string, unknown>[]> => [];

/** A driver that reports no origins (PGlite): result columns are matched by name. */
const byName = (names: string[]): ResultField[] => names.map(name => ({ name }));

describe("withoutUnreadableColumns, from the descriptors", () => {
    it("drops a private column for everyone, the admin included", async () => {
        const rows = [{ id: 1, name: "Ann", api_key: "k" }];
        await withoutUnreadableColumns(rows, byName(["id", "name", "api_key"]), { roles: ["admin"] }, tables, new ColumnOrigins(), noCatalogue);
        expect(rows).toEqual([{ id: 1, name: "Ann" }]);
    });

    it("drops a role-restricted column, and the foreign key of a role-restricted relation, for other roles", async () => {
        const rows = [{ id: 1, salary: 100, band_id: 7 }];
        await withoutUnreadableColumns(rows, byName(["id", "salary", "band_id"]), { roles: ["staff"] }, tables, new ColumnOrigins(), noCatalogue);
        expect(rows).toEqual([{ id: 1 }]);
    });

    it("keeps them for a role the rule names", async () => {
        const rows = [{ id: 1, salary: 100, band_id: 7, api_key: "k" }];
        await withoutUnreadableColumns(rows, byName(["id", "salary", "band_id", "api_key"]), { roles: ["hr"] }, tables, new ColumnOrigins(), noCatalogue);
        expect(rows).toEqual([{ id: 1, salary: 100, band_id: 7 }]);
    });

    it("drops the auth table's secrets: the compiler marks them private", async () => {
        const rows = [{ id: "u", email: "a@b.c", password_hash: "$2b$", email_verification_token: "t" }];
        const fields = byName(["id", "email", "password_hash", "email_verification_token"]);
        await withoutUnreadableColumns(rows, fields, { roles: ["admin"] }, tables, new ColumnOrigins(), noCatalogue);
        expect(rows).toEqual([{ id: "u", email: "a@b.c" }]);
    });

    it("judges by origin when the driver reports one: an alias does not hide a column, a same-named column of another table is kept", async () => {
        const catalogue = async (): Promise<Record<string, unknown>[]> => [
            { oid: 10, schema: "public", name: "staff", attnum: 3, column: "salary" },
            { oid: 20, schema: "public", name: "bands", attnum: 2, column: "name" }
        ];
        const rows = [{ pay: 100, name: "Band" }];
        const fields: ResultField[] = [{ name: "pay", tableID: 10, columnID: 3 }, { name: "name", tableID: 20, columnID: 2 }];
        await withoutUnreadableColumns(rows, fields, { roles: ["staff"] }, tables, new ColumnOrigins(), catalogue);
        expect(rows).toEqual([{ name: "Band" }]);
    });

    it("costs nothing when no served table has a rule", async () => {
        const plain = compileSchema([bands]).map(table => table.descriptor);
        const rows = [{ id: 1, name: "x" }];
        await withoutUnreadableColumns(rows, byName(["id", "name"]), { roles: [] }, plain, new ColumnOrigins(), async () => {
            throw new Error("the catalogue is not read");
        });
        expect(rows).toEqual([{ id: 1, name: "x" }]);
    });
});
