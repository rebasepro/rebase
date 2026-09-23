/**
 * A date property's `defaultValue` is a DEFAULT its column's type accepts.
 *
 * The default was rendered as a full ISO timestamp whatever the column was, so
 * `{ type: "date", columnType: "time", defaultValue }` produced
 * `DEFAULT '2024-03-01T15:30:00.000Z'` on a `TIME` column and the schema failed
 * to apply: "invalid input syntax for type time". The DEFAULT is now written in
 * the column's own shape — a day for `date`, a time of day for `time`, an
 * instant for a timestamp — and applied to a real database to prove it.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";

const events: CollectionConfig = {
    name: "Events",
    slug: "events",
    table: "events",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        day: { name: "Day", type: "date", columnType: "date", defaultValue: new Date("2024-03-01T15:00:00Z") },
        opensAt: { name: "Opens", type: "date", columnType: "time", defaultValue: new Date("2024-03-01T15:30:05.250Z") },
        startsAt: { name: "Starts", type: "date", defaultValue: new Date("2024-03-01T15:30:00Z") }
    }
};

let db: PGlite | undefined;

afterEach(async () => {
    await db?.close();
    db = undefined;
});

async function applied(collection: CollectionConfig): Promise<PGlite> {
    const ddl = renderPostgresDdl(planSchema([collection]), { includePolicies: false });
    db = new PGlite();
    await db.waitReady;
    await db.exec(ddl);
    return db;
}

describe("a date property's DEFAULT", () => {
    it("applies, and each column gets the value in its own shape", async () => {
        const database = await applied(events);
        await database.query("INSERT INTO events DEFAULT VALUES");
        const { rows } = await database.query<{ day: string; opens_at: string; starts_at: string }>(
            "SELECT day::text AS day, opens_at::text AS opens_at, " +
            "to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS starts_at FROM events"
        );
        expect(rows[0]).toEqual({ day: "2024-03-01", opens_at: "15:30:05.25", starts_at: "2024-03-01 15:30:00" });
    });

    it("keeps a default already written in the column's shape", async () => {
        const database = await applied({
            ...events,
            properties: {
                id: { name: "ID", type: "number", isId: "increment" },
                day: { name: "Day", type: "date", columnType: "date", defaultValue: "2024-12-25" as unknown as Date },
                opensAt: { name: "Opens", type: "date", columnType: "time", defaultValue: "09:00" as unknown as Date }
            }
        });
        await database.query("INSERT INTO events DEFAULT VALUES");
        const { rows } = await database.query<{ day: string; opens_at: string }>(
            "SELECT day::text AS day, opens_at::text AS opens_at FROM events"
        );
        expect(rows[0]).toEqual({ day: "2024-12-25", opens_at: "09:00:00" });
    });

    it("gives no DEFAULT for a string that is no date at all, rather than a schema that will not apply", () => {
        const plan = planSchema([{
            ...events,
            properties: {
                id: { name: "ID", type: "number", isId: "increment" },
                opensAt: { name: "Opens", type: "date", columnType: "time", defaultValue: "soon" as unknown as Date }
            }
        }]);
        const ddl = renderPostgresDdl(plan, { includePolicies: false });
        expect(ddl).not.toContain("soon");
    });
});
