/**
 * Field access through the driver, authored with `defineTable`: every decision
 * is the table descriptor's.
 *
 * - `.private()` — never served, filtered, sorted, searched, aggregated or
 *   named in an error, for anyone (the trusted server plane, with no viewer,
 *   still reads it: the auth adapter verifies a password hash that way);
 * - `.access({ read: ["hr"] })` — the same five things, per viewer (`admin`
 *   satisfies any non-empty list);
 * - `rel.*(…, { access })` / `{ private: true }` — the relation, its `_count`
 *   and the foreign key of a withheld to-one relation;
 * - the auth table's secrets — private in the descriptor because the compiler
 *   marks them, with no driver-side normalisation.
 *
 * A real driver over PGlite, scoped with `withAuth` the way every API door
 * scopes it, so what is asserted is what a caller receives.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { boolean, integer, jsonb, pgTable, serial, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";
import { col, defineAuthTable, defineTable, rel, type DataDriver, type User } from "@rebasepro/types";
import { apiHiddenKeys, compileSchema } from "@rebasepro/common";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { buildTableRegistry } from "../src/model/build-registry";
import { RealtimeService } from "../src/services/realtimeService";
import { assertReadRequestReadable } from "../src/services/read-field-access";
import { ColumnOrigins, withoutUnreadableColumns } from "../src/security/caller-sql-columns";
import { withFieldViewer } from "../src/services/field-viewer";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";
import { testUser } from "./helpers/spg-b-fixtures";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text(),
        displayName: col.text("display_name"),
        // Secrets by name: the compiler marks them private.
        passwordHash: col.text("password_hash")
    },
    rls: "admin-only"
});
const bands = defineTable("bands", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    relations: {
        // Withheld from everyone: its rows, and its `_count`.
        staff: rel.hasMany(() => staff, { foreignKey: "band_id", private: true }),
        // Withheld from callers without `hr`.
        leads: rel.hasMany(() => staff, { foreignKey: "lead_band_id", access: { read: ["hr"] } })
    },
    rls: "admin-only"
});
const staff = defineTable("staff", {
    columns: {
        id: col.serial().primaryKey(),
        name: col.text(),
        notes: col.text().access({ read: ["hr"] }),
        apiKey: col.text("api_key").private(),
        bandId: col.integer("band_id"),
        leadBandId: col.integer("lead_band_id")
    },
    relations: {
        band: rel.belongsTo(() => bands, { localKey: "band_id", access: { read: ["hr"] } })
    },
    rls: "admin-only"
});

const usersPg = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    displayName: text("display_name"),
    passwordHash: text("password_hash")
});
const bandsPg = pgTable("bands", { id: serial("id").primaryKey(), name: text("name") });
const staffPg = pgTable("staff", {
    id: serial("id").primaryKey(),
    name: text("name"),
    notes: text("notes"),
    apiKey: text("api_key"),
    bandId: integer("band_id"),
    leadBandId: integer("lead_band_id")
});

const PLAIN = testUser({ uid: "u1", roles: ["user"] });
const HR = testUser({ uid: "u2", roles: ["hr"] });
const ADMIN = testUser({ uid: "u3", roles: ["admin"] });

let db: PGlite;

function driver(): PostgresBackendDriver {
    const defs = [users, bands, staff];
    const registry = buildTableRegistry({
        compiledTables: compileSchema(defs),
        tables: { users: usersPg, bands: bandsPg, staff: staffPg }
    });
    const orm = pgliteNodePg(db, { schema: { users: usersPg, bands: bandsPg, staff: staffPg } });
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

const as = (user: User): Promise<DataDriver> => driver().withAuth(user);

/**
 * The answer a read naming `name` gets, with `name` spelled `nope` — so it can
 * be compared, byte for byte, with the answer to a name the table does not
 * have: a private name must not be told apart from a typo.
 */
async function asTypo(name: string, read: (field: string) => Promise<unknown>): Promise<void> {
    const hidden = await refusal(() => read(name));
    const typo = await refusal(() => read("nope"));
    expect(hidden.code).toBe(typo.code);
    expect(hidden.message.split(name).join("nope")).toBe(typo.message);
}

/** The error a read is refused with: its code and message. */
async function refusal(read: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
    try {
        await read();
    } catch (error) {
        const { code, message } = error as { code?: string; message: string };
        return { code, message };
    }
    throw new Error("the read was not refused");
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, display_name text, password_hash text);
        CREATE TABLE bands (id serial PRIMARY KEY, name text);
        CREATE TABLE staff (id serial PRIMARY KEY, name text, notes text, api_key text, band_id integer, lead_band_id integer);
        INSERT INTO users (email, display_name, password_hash) VALUES ('ann@x.io', 'Ann', '$2b$10$secret');
        INSERT INTO bands (name) VALUES ('north');
        INSERT INTO staff (name, notes, api_key, band_id, lead_band_id) VALUES
            ('ann', 'promote', 'key-a', 1, 1), ('bob', 'watch', 'key-b', 1, NULL);
    `);
});

afterEach(async () => {
    await db.close();
});

describe("the auth table's secret columns, through the driver", () => {
    it("are private in the descriptor: the compiler marks them", () => {
        const descriptor = compileSchema([users])[0].descriptor;
        expect(descriptor.columns.find(column => column.key === "passwordHash")?.private).toBe(true);
    });

    it("are never read, for the admin either", async () => {
        for (const user of [PLAIN, ADMIN]) {
            const [row] = await (await as(user)).fetchCollection({ path: "users" });
            expect(row.email).toBe("ann@x.io");
            expect(row).not.toHaveProperty("passwordHash");
            expect(row).not.toHaveProperty("password_hash");
        }
    });

    it("cannot be filtered, sorted, counted on or probed, and the answer is the typo's", async () => {
        const scoped = await as(ADMIN);
        for (const name of ["passwordHash", "password_hash"]) {
            await asTypo(name, field => scoped.fetchCollection({ path: "users", filter: { [field]: ["==", "$2b$10$secret"] } }));
            await asTypo(name, field => scoped.fetchCollection({ path: "users", orderBy: field }));
            await asTypo(name, field => scoped.count!({ path: "users", filter: { [field]: ["==", "$2b$10$secret"] } }));
            // "Is this value taken?" about a column the table does not have
            // answers "no" — and so it does about a private one.
            expect(await scoped.checkUniqueField("users", name, "$2b$10$secret")).toBe(true);
            expect(await scoped.checkUniqueField("users", "nope", "$2b$10$secret")).toBe(true);
        }
    });

    it("cannot be searched", async () => {
        const rows = await (await as(ADMIN)).fetchCollection({ path: "users", searchString: "secret" });
        expect(rows).toEqual([]);
    });

    it("may be looked up by on the trusted server plane, which still serves no value of them", async () => {
        const [row] = await driver().fetchCollection({ path: "users", filter: { passwordHash: ["==", "$2b$10$secret"] } });
        expect(row.email).toBe("ann@x.io");
        expect(row).not.toHaveProperty("passwordHash");
    });
});

describe("a private column", () => {
    it("is never served", async () => {
        for (const user of [PLAIN, HR, ADMIN]) {
            const rows = await (await as(user)).fetchCollection({ path: "staff" });
            for (const row of rows) {
                expect(row).not.toHaveProperty("apiKey");
                expect(row).not.toHaveProperty("api_key");
            }
        }
    });

    it("is refused as a filter, a sort, a projection and an aggregate exactly as a typo is", async () => {
        const scoped = await as(ADMIN);
        await asTypo("apiKey", field => scoped.fetchCollection({ path: "staff", filter: { [field]: ["==", "key-a"] } }));
        await asTypo("api_key", field => scoped.fetchCollection({ path: "staff", filter: { [field]: ["==", "key-a"] } }));
        await asTypo("apiKey", field => scoped.fetchCollection({ path: "staff", orderBy: field }));
        await asTypo("apiKey", field => scoped.fetchCollection({ path: "staff", fields: ["name", field] }));
        await asTypo("apiKey", field => scoped.restFetchService!.aggregate!("staff", { aggregates: [{ fn: "count", field, alias: "n" }] }));
        await asTypo("apiKey", field => scoped.restFetchService!.aggregate!("staff", { aggregates: [{ fn: "count", alias: "n" }], groupBy: [field] }));
    });

    it("is listed in no answer: a typo's list of valid names leaves it out", async () => {
        const { message } = await refusal(async () => (await as(ADMIN)).fetchCollection({ path: "staff", filter: { nope: ["==", 1] } }));
        expect(message).toContain("name");
        expect(message).not.toContain("apiKey");
        expect(message).not.toContain("api_key");
    });

    it("is never searched", async () => {
        expect(await (await as(ADMIN)).fetchCollection({ path: "staff", searchString: "key-a" })).toEqual([]);
    });
});

describe("a column readable by role", () => {
    it("is withheld from a caller without the role and served to one holding it, or to the admin", async () => {
        const plain = await (await as(PLAIN)).fetchCollection({ path: "staff" });
        for (const row of plain) expect(row).not.toHaveProperty("notes");
        for (const user of [HR, ADMIN]) {
            const rows = await (await as(user)).fetchCollection({ path: "staff", orderBy: "name" });
            expect(rows.map(row => row.notes)).toEqual(["promote", "watch"]);
        }
    });

    it("is refused as a filter, a sort, a count filter, a uniqueness probe and an aggregate without the role", async () => {
        const scoped = await as(PLAIN);
        for (const read of [
            () => scoped.fetchCollection({ path: "staff", filter: { notes: ["==", "promote"] } }),
            () => scoped.fetchCollection({ path: "staff", orderBy: "notes" }),
            () => scoped.count!({ path: "staff", filter: { notes: ["==", "promote"] } }),
            () => scoped.checkUniqueField("staff", "notes", "promote"),
            () => scoped.restFetchService!.aggregate!("staff", { aggregates: [{ fn: "count", field: "notes", alias: "n" }] })
        ]) {
            expect((await refusal(read)).code).toBe("FIELD_NOT_READABLE");
        }
    });

    it("is filtered and sorted for a caller holding the role", async () => {
        const rows = await (await as(HR)).fetchCollection({ path: "staff", filter: { notes: ["==", "promote"] }, orderBy: "notes" });
        expect(rows.map(row => row.name)).toEqual(["ann"]);
    });

    it("is searched only for a caller holding the role", async () => {
        expect(await (await as(PLAIN)).fetchCollection({ path: "staff", searchString: "promote" })).toEqual([]);
        const found = await (await as(HR)).fetchCollection({ path: "staff", searchString: "promote" });
        expect(found.map(row => row.name)).toEqual(["ann"]);
    });
});

describe("a relation with access rules", () => {
    it("takes the foreign key of a withheld to-one relation with it", async () => {
        const plain = await (await as(PLAIN)).fetchCollection({ path: "staff" });
        for (const row of plain) {
            expect(row).not.toHaveProperty("band");
            expect(row).not.toHaveProperty("bandId");
            expect(row).not.toHaveProperty("band_id");
        }
        const hr = await (await as(HR)).fetchCollection({ path: "staff", orderBy: "name" });
        expect(hr.map(row => row.bandId)).toEqual([1, 1]);
    });

    it("refuses a filter on that foreign key without the role", async () => {
        const { code } = await refusal(async () => (await as(PLAIN)).fetchCollection({ path: "staff", filter: { bandId: ["==", 1] } }));
        expect(code).toBe("FIELD_NOT_READABLE");
    });

    it("is never included or counted when private: the include is answered as a typo", async () => {
        const scoped = await as(ADMIN);
        await asTypo("staff", relation => scoped.restFetchService!.fetchCollectionForRest("bands", {}, { [relation]: { count: true } }));
    });

    it("is included and counted by role, and omitted with its total for a caller without the role", async () => {
        const [withheld] = await (await as(PLAIN)).restFetchService!.fetchCollectionForRest("bands", {}, { leads: { count: true } });
        expect(withheld.name).toBe("north");
        expect(withheld).not.toHaveProperty("leads");
        expect(withheld).not.toHaveProperty("_count");
        const [band] = await (await as(HR)).restFetchService!.fetchCollectionForRest("bands", {}, { leads: { count: true } });
        expect(band.leads).toEqual([expect.objectContaining({ name: "ann" })]);
        expect(band._count).toEqual({ leads: 1 });
    });
});

describe("the socket's read check (`assertReadRequestReadable`)", () => {
    const registry = () => buildTableRegistry({
        compiledTables: compileSchema([users, bands, staff]),
        tables: { users: usersPg, bands: bandsPg, staff: staffPg }
    });

    it("answers a private column as a name the table does not have, and a role-restricted one as not readable", () => {
        const tables = registry();
        // A typo is left to the driver, which answers it with the same function.
        expect(() => assertReadRequestReadable({ filter: { nope: ["==", "x"] } }, { slug: "staff" }, { roles: ["admin"] }, tables)).not.toThrow();
        expect(() => assertReadRequestReadable({ filter: { apiKey: ["==", "x"] } }, { slug: "staff" }, { roles: ["admin"] }, tables))
            .toThrow(expect.objectContaining({ code: "UNKNOWN_FILTER_FIELD" }));
        expect(() => assertReadRequestReadable({ orderBy: "notes" }, { slug: "staff" }, { roles: ["user"] }, tables))
            .toThrow(expect.objectContaining({ code: "FIELD_NOT_READABLE" }));
        expect(() => assertReadRequestReadable({ orderBy: "notes" }, { slug: "staff" }, { roles: ["hr"] }, tables)).not.toThrow();
    });

    it("refuses a table the registry does not serve, rather than reading it unchecked", () => {
        expect(() => assertReadRequestReadable({}, { slug: "nowhere" }, { roles: ["admin"] }, registry())).toThrow(/nowhere/);
    });
});

describe("a private vector column", () => {
    const docs = defineTable("docs", {
        columns: {
            id: col.serial().primaryKey(),
            embedding: col.vector({ dimensions: 3 }),
            fingerprint: col.vector({ dimensions: 3 }).private()
        },
        rls: "admin-only"
    });
    const docsPg = pgTable("docs", {
        id: serial("id").primaryKey(),
        embedding: vector("embedding", { dimensions: 3 }),
        fingerprint: vector("fingerprint", { dimensions: 3 })
    });
    const table = compileSchema([docs])[0].descriptor;
    const search = (property: string) => () =>
        DrizzleConditionBuilder.buildVectorSearchConditions(docsPg, { property, vector: [1, 2, 3] }, table);

    it("is answered to an API caller as a column the table does not have, and listed nowhere", () => {
        const hidden = refusalOf(() => withFieldViewer({ roles: ["admin"] }, search("fingerprint")));
        const typo = refusalOf(() => withFieldViewer({ roles: ["admin"] }, search("nope")));
        expect(hidden.code).toBe("UNKNOWN_VECTOR_PROPERTY");
        expect(hidden.message.split("fingerprint").join("nope")).toBe(typo.message);
        expect(typo.message).toContain("embedding");
        expect(typo.message).not.toContain("fingerprint");
    });

    it("is ranked by on the trusted server plane", () => {
        expect(search("fingerprint")().distanceSelect).toBeDefined();
    });
});

function refusalOf(read: () => unknown): { code?: string; message: string } {
    try {
        read();
    } catch (error) {
        const { code, message } = error as { code?: string; message: string };
        return { code, message };
    }
    throw new Error("not refused");
}

/**
 * Every column auth owns on the user table, through every door that serves a
 * row, for the user themself, another signed-in user the read policy admits,
 * and an admin.
 *
 * The runtime's drizzle table is the catalogue — every physical column — while
 * the row strip reads the descriptor, so a column auth creates and the table
 * does not declare (the scaffold declares none of the email-change columns)
 * reached every caller the read policy admitted: `emailChangeToken`, the hash
 * of a pending email-change link, was served to the account itself. The auth
 * table's secrets are refused by name, declared or not; bookkeeping columns
 * (`tokensValidAfter`, `pendingEmail`, …) are served as before.
 *
 * The side tables (refresh, reset and magic-link tokens, MFA factors and
 * challenges, recovery codes, identities) are `rebase-internal` and no door
 * serves them.
 */
describe("every column auth owns, through every door", () => {
    /** The scaffold's users table (`templates/template/backend/schema/users.ts`), with the rules left out. */
    const accounts = defineAuthTable("users", {
        columns: {
            id: col.uuid().primaryKey().defaultRandom(),
            email: col.text().notNull().unique(),
            displayName: col.text(),
            photoURL: col.text(),
            roles: col.text().array(),
            passwordHash: col.text().private(),
            emailVerified: col.boolean().default(false),
            emailVerificationToken: col.text().private(),
            emailVerificationSentAt: col.timestamp({ withTimezone: true }),
            metadata: col.jsonb(),
            createdAt: col.timestamp({ withTimezone: true }),
            updatedAt: col.timestamp({ withTimezone: true })
        },
        rls: "admin-only"
    });
    const notes = defineTable("notes", {
        columns: { id: col.serial().primaryKey(), body: col.text(), ownerId: col.uuid("owner_id") },
        relations: { owner: rel.belongsTo(() => accounts, { localKey: "owner_id" }) },
        rls: "admin-only"
    });

    /** The table as the catalogue reads it: every column `ensureAuthTablesExist` creates, undeclared ones camelCased. */
    const accountsPg = pgTable("users", {
        id: uuid("id").primaryKey().defaultRandom(),
        email: text("email"),
        displayName: text("display_name"),
        photoURL: text("photo_url"),
        roles: text("roles").array(),
        passwordHash: text("password_hash"),
        emailVerified: boolean("email_verified"),
        emailVerificationToken: text("email_verification_token"),
        emailVerificationSentAt: timestamp("email_verification_sent_at", { withTimezone: true }),
        isAnonymous: boolean("is_anonymous"),
        metadata: jsonb("metadata"),
        tokensValidAfter: timestamp("tokens_valid_after", { withTimezone: true }),
        disabledAt: timestamp("disabled_at", { withTimezone: true }),
        pendingEmail: text("pending_email"),
        emailChangeToken: text("email_change_token"),
        emailChangeSentAt: timestamp("email_change_sent_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }),
        updatedAt: timestamp("updated_at", { withTimezone: true })
    });
    const notesPg = pgTable("notes", { id: serial("id").primaryKey(), body: text("body"), ownerId: uuid("owner_id") });

    /** Each auth-owned column on the user table: its key in a served row, and whether it is a secret. */
    const COLUMNS: ReadonlyArray<[key: string, column: string, secret: boolean]> = [
        ["email", "email", false],
        ["displayName", "display_name", false],
        ["photoURL", "photo_url", false],
        ["roles", "roles", false],
        ["passwordHash", "password_hash", true],
        ["emailVerified", "email_verified", false],
        ["emailVerificationToken", "email_verification_token", true],
        ["emailVerificationSentAt", "email_verification_sent_at", false],
        ["isAnonymous", "is_anonymous", false],
        ["metadata", "metadata", false],
        ["tokensValidAfter", "tokens_valid_after", false],
        ["disabledAt", "disabled_at", false],
        ["pendingEmail", "pending_email", false],
        ["emailChangeToken", "email_change_token", true],
        ["emailChangeSentAt", "email_change_sent_at", false],
        ["createdAt", "created_at", false],
        ["updatedAt", "updated_at", false]
    ];

    const ANN = "00000000-0000-4000-8000-00000000000a";
    const SELF = testUser({ uid: ANN, roles: ["user"] });
    const OTHER = testUser({ uid: "00000000-0000-4000-8000-00000000000b", roles: ["user"] });

    function registry() {
        return buildTableRegistry({
            compiledTables: compileSchema([accounts, notes]),
            tables: { users: accountsPg, notes: notesPg }
        });
    }

    function accountsDriver(): PostgresBackendDriver {
        const tables = registry();
        const orm = pgliteNodePg(db, { schema: { users: accountsPg, notes: notesPg } });
        return new PostgresBackendDriver(orm, new RealtimeService(orm, tables), tables);
    }

    beforeEach(async () => {
        await db.exec(`
            DROP TABLE users;
            CREATE TABLE users (
                id uuid PRIMARY KEY, email text, display_name text, photo_url text, roles text[],
                password_hash text, email_verified boolean, email_verification_token text,
                email_verification_sent_at timestamptz, is_anonymous boolean, metadata jsonb,
                tokens_valid_after timestamptz, disabled_at timestamptz, pending_email text,
                email_change_token text, email_change_sent_at timestamptz,
                created_at timestamptz, updated_at timestamptz
            );
            INSERT INTO users VALUES (
                '${ANN}', 'ann@x.io', 'Ann', 'https://x.io/a.png', '{user}',
                'scrypt$secret', true, 'verify-secret', now(), false, '{}',
                now(), NULL, 'new@x.io', 'change-secret', now(), now(), now()
            );
            CREATE TABLE notes (id serial PRIMARY KEY, body text, owner_id uuid);
            INSERT INTO notes (body, owner_id) VALUES ('hello', '${ANN}');
        `);
    });

    /** Each door, as the caller `user` reaches it: the row it hands back for Ann. */
    const doors: ReadonlyArray<[door: string, read: (user: User) => Promise<Record<string, unknown>>]> = [
        ["SDK / MCP list", async user => (await (await accountsDriver().withAuth(user)).fetchCollection({ path: "users" }))[0]],
        ["SDK / MCP get", async user => (await (await accountsDriver().withAuth(user)).fetchOne({ path: "users", id: ANN }))!],
        ["REST list", async user => (await (await accountsDriver().withAuth(user)).restFetchService!.fetchCollectionForRest("users", {}))[0]],
        ["REST get", async user => (await (await accountsDriver().withAuth(user)).restFetchService!.fetchOneForRest("users", ANN))!],
        ["REST include", async user => {
            const [note] = await (await accountsDriver().withAuth(user)).restFetchService!.fetchCollectionForRest("notes", {}, ["owner"]);
            return note.owner as Record<string, unknown>;
        }],
        ["caller SQL", async user => {
            const result = await db.query<Record<string, unknown>>("SELECT * FROM users");
            const rows = result.rows.map(row => ({ ...row }));
            const fields = result.fields.map(field => ({ name: field.name }));
            const descriptors = registry().tables().map(table => table.descriptor);
            const [row] = await withoutUnreadableColumns(rows, fields, { roles: user.roles }, descriptors, new ColumnOrigins(), async () => []);
            return row;
        }]
    ];

    for (const [door, read] of doors) {
        for (const [who, user] of [["the user themself", SELF], ["another signed-in user", OTHER], ["an admin", ADMIN]] as const) {
            it(`${door}, as ${who}: no secret, every bookkeeping column`, async () => {
                const row = await read(user);
                const sqlNamed = door === "caller SQL";
                expect(row).toBeDefined();
                for (const [key, column, secret] of COLUMNS) {
                    const name = sqlNamed ? column : key;
                    if (secret) {
                        expect({ name, served: name in row }).toEqual({ name, served: false });
                        expect(row).not.toHaveProperty(key);
                        expect(row).not.toHaveProperty(column);
                    } else {
                        expect({ name, served: name in row }).toEqual({ name, served: true });
                    }
                }
            });
        }
    }

    it("the schema the API describes names no secret", () => {
        const descriptor = compileSchema([accounts, notes])[0].descriptor;
        const hidden = apiHiddenKeys(descriptor);
        for (const [key, column, secret] of COLUMNS) {
            if (!secret) continue;
            expect(hidden.has(key) && hidden.has(column)).toBe(true);
        }
        expect(descriptor.columns.filter(column => column.private !== true).map(column => column.key))
            .not.toEqual(expect.arrayContaining(["passwordHash"]));
    });
});
