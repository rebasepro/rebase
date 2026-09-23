/**
 * Deleting a row that other rows still point at is a conflict, and says which.
 *
 * A required link is `ON DELETE RESTRICT`, so deleting an org that still has
 * projects is refused by Postgres with `23001 restrict_violation`. Nothing
 * mapped that code, and the delete path did not translate database errors at
 * all: the refusal reached the REST handler as an unclassified error and
 * answered `500 INTERNAL_ERROR`, "An unexpected error occurred" — for a request
 * the server had understood perfectly and refused on purpose. A hand-written
 * `NO ACTION` key, which raises `23503` instead, did the same.
 *
 * A real driver over PGlite, deleting a referenced row both ways.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const orgsTable = pgTable("orgs", { id: serial("id").primaryKey(), name: varchar("name") });
const projectsTable = pgTable("projects", { id: serial("id").primaryKey(), orgId: integer("org_id") });
const notesTable = pgTable("notes", { id: serial("id").primaryKey(), orgId: integer("org_id") });

const orgs: CollectionConfig = {
    name: "Orgs",
    slug: "orgs",
    table: "orgs",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" }
    }
};

let db: PGlite;

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([orgs]);
    registry.registerTable(orgsTable, "orgs");
    registry.registerTable(projectsTable, "projects");
    registry.registerTable(notesTable, "notes");
    const orm = drizzle(pglite, { schema: { orgs: orgsTable, projects: projectsTable, notes: notesTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

async function refusal(promise: Promise<unknown>): Promise<ApiError> {
    const error = await promise.then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE orgs (id serial PRIMARY KEY, name varchar);
        CREATE TABLE projects (id serial PRIMARY KEY, org_id integer NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT);
        CREATE TABLE notes (id serial PRIMARY KEY, org_id integer REFERENCES orgs(id));
        INSERT INTO orgs (id, name) VALUES (1, 'acme'), (2, 'globex'), (3, 'initech');
        INSERT INTO projects (org_id) VALUES (1);
        INSERT INTO notes (org_id) VALUES (2);
    `);
});

afterEach(async () => {
    await db.close();
});

describe("deleting a row other rows still reference", () => {
    it("is a 409 naming the referencing table and constraint, under ON DELETE RESTRICT", async () => {
        const error = await refusal(driverOver(db).delete({ row: { id: 1, path: "orgs", values: {} }, collection: orgs }));
        expect(error.statusCode).toBe(409);
        expect(error.code).toBe("PG_23001");
        expect(error.message).toContain('"projects"');
        expect(error.message).toContain("projects_org_id_fkey");

        const left = await db.query<{ id: number }>("SELECT id FROM orgs ORDER BY id");
        expect(left.rows.map(r => r.id)).toEqual([1, 2, 3]);
    });

    it("is a 409 under the default NO ACTION too", async () => {
        const error = await refusal(driverOver(db).delete({ row: { id: 2, path: "orgs", values: {} }, collection: orgs }));
        expect(error.statusCode).toBe(409);
        expect(error.code).toBe("PG_23503");
    });

    it("leaves a row nothing references deletable", async () => {
        await driverOver(db).delete({ row: { id: 3, path: "orgs", values: {} }, collection: orgs });
        const left = await db.query<{ id: number }>("SELECT id FROM orgs ORDER BY id");
        expect(left.rows.map(r => r.id)).toEqual([1, 2]);
    });
});
