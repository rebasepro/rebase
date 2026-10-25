/**
 * A collection callback can tell a write made with an API key from the same
 * person's own session.
 *
 * A personal key acts as its owner: the driver is scoped to the owner's uid and
 * roles, so `context.user` reads the same whether the owner pressed Save or a
 * CI job wrote with the owner's key. An audit log built on the hooks recorded
 * every key write as the person. `context.credential` names the key — its id,
 * name and kind — and is absent for a session.
 *
 * A real `PostgresBackendDriver` over PGlite, through `withAuth`, as a request
 * from outside reaches it: the transaction driver the callbacks run on is
 * built per request, so a credential that did not survive that hop would read
 * as absent here.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CallerCredential, CollectionConfig, RebaseCallContext, User } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const notesTable = pgTable("notes", {
    id: serial("id").primaryKey(),
    title: varchar("title")
});

/** What each hook saw, by hook name. */
let seen: Record<string, RebaseCallContext["credential"] | "absent">;

function record(hook: string, context: RebaseCallContext): void {
    seen[hook] = context.credential ?? "absent";
}

function notesCollection(): CollectionConfig {
    const collection: CollectionConfig = {
        name: "Notes",
        slug: "notes",
        table: "notes",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" }
        },
        callbacks: {
            beforeSave: ({ values, context }) => {
                record("beforeSave", context);
                return values;
            },
            afterSave: ({ context }) => {
                record("afterSave", context);
            },
            beforeDelete: ({ context }) => {
                record("beforeDelete", context);
            },
            afterDelete: ({ context }) => {
                record("afterDelete", context);
            }
        }
    };
    return collection;
}

const CI_KEY: CallerCredential = { kind: "personal", id: "key-1", name: "CI deploys" };

function person(credential?: CallerCredential): User {
    return {
        uid: "ada",
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "test",
        isAnonymous: false,
        roles: ["user"],
        ...(credential ? { credential } : {})
    };
}

let db: PGlite;

async function authed(user: User) {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([notesCollection()]);
    registry.registerTable(notesTable, "notes");
    const orm = drizzle(db, { schema: { notes: notesTable } }) as never;
    const base = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    return base.withAuth(user);
}

beforeEach(async () => {
    seen = {};
    db = new PGlite();
    await db.waitReady;
    await db.exec("CREATE TABLE notes (id serial PRIMARY KEY, title varchar);");
});

afterEach(async () => {
    await db.close();
});

describe("context.credential in collection callbacks", () => {
    it("names the API key a write was made with, in every write hook", async () => {
        const driver = await authed(person(CI_KEY));

        const saved = await driver.save({ path: "notes", values: { title: "from CI" }, status: "new" });
        await driver.delete({ row: { path: "notes", id: saved.id } });

        expect(seen).toEqual({
            beforeSave: CI_KEY,
            afterSave: CI_KEY,
            beforeDelete: CI_KEY,
            afterDelete: CI_KEY
        });
    });

    it("is absent for the same person's own session", async () => {
        const driver = await authed(person());

        const saved = await driver.save({ path: "notes", values: { title: "by hand" }, status: "new" });
        await driver.delete({ row: { path: "notes", id: saved.id } });

        expect(seen).toEqual({
            beforeSave: "absent",
            afterSave: "absent",
            beforeDelete: "absent",
            afterDelete: "absent"
        });
    });
});
