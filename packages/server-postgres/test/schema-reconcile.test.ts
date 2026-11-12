/**
 * The reviewed path for what boot will not do: relax a constraint, drop a
 * column.
 *
 * The case that asked for it: SongBuzz moved its voice recordings out of a
 * `wav` column and into a bucket, made the property optional, and then had no
 * way to stop the database requiring it, or to drop the column once the files
 * had moved. Boot reported "nullable in schema.generated.ts and NOT NULL in the
 * database" on every start, and applied nothing, by design.
 *
 * Against PGlite, because the point is what a real catalogue reports and what
 * Postgres then accepts.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { readReconcileFacts, reconcileDigest } from "../src/schema/reconcile-schema";

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(sql: string) => {
        const result = await db.query<T>(sql);
        return { rows: result.rows };
    }
});

/** The collection after the move: `wav` optional, `legacy_blob` gone from it. */
const voiceCache: CollectionConfig = {
    name: "Voice cache",
    slug: "voice_cache",
    table: "voice_cache",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        text: { name: "Text", type: "string", validation: { required: true } },
        wav: { name: "WAV", type: "string" },
        path: { name: "Path", type: "string" }
    }
};

describe("planning and applying a schema reconcile", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.exec(`
            CREATE TABLE public.voice_cache (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                text varchar NOT NULL,
                wav varchar NOT NULL,
                path varchar,
                legacy_blob text NOT NULL,
                note text
            );
            INSERT INTO public.voice_cache (text, wav, legacy_blob) VALUES ('a', 'x', 'blob-a'), ('b', 'y', 'blob-b');
            INSERT INTO public.voice_cache (text, wav, legacy_blob, note) VALUES ('c', 'z', 'blob-c', 'kept');
        `);
    });

    afterEach(async () => {
        await db.close();
    });

    it("relaxes a column made optional and lists what no property declares, dropping nothing unasked", async () => {
        const plan = await readReconcileFacts(queryable(db), [voiceCache]);

        expect(plan.problems).toEqual([]);
        expect(plan.relaxed).toEqual([
            { collection: "voice_cache", table: "public.voice_cache", column: "wav" },
            { collection: "voice_cache", table: "public.voice_cache", column: "legacy_blob", undeclared: true }
        ]);
        expect(plan.undeclared).toEqual([
            { collection: "voice_cache", table: "public.voice_cache", column: "legacy_blob", blocksInserts: true },
            { collection: "voice_cache", table: "public.voice_cache", column: "note", blocksInserts: false }
        ]);
        expect(plan.dropped).toEqual([]);
        expect(plan.statements).toEqual([
            `ALTER TABLE "public"."voice_cache" ALTER COLUMN "wav" DROP NOT NULL;`,
            `ALTER TABLE "public"."voice_cache" ALTER COLUMN "legacy_blob" DROP NOT NULL;`
        ]);
        // A required property stays required, and nothing is dropped.
        expect(plan.statements.join("\n")).not.toMatch(/"text"|DROP COLUMN/);
    });

    it("keeps an undeclared required column's data and lets inserts through, without a drop", async () => {
        // The state a removed property leaves: no property declares `legacy_blob`,
        // it is NOT NULL with no default, and the API's insert never names it.
        await expect(db.exec(`INSERT INTO public.voice_cache (text, wav) VALUES ('d', 'w')`)).rejects.toThrow(/legacy_blob/);

        const plan = await readReconcileFacts(queryable(db), [voiceCache]);
        for (const statement of plan.statements) await db.exec(statement);

        await db.exec(`INSERT INTO public.voice_cache (text) VALUES ('d')`);
        const { rows } = await db.query<{ legacy_blob: string | null }>(
            `SELECT legacy_blob FROM public.voice_cache ORDER BY text`
        );
        expect(rows.map(r => r.legacy_blob)).toEqual(["blob-a", "blob-b", "blob-c", null]);

        // Once relaxed it no longer blocks inserts, so it is only listed, and
        // dropping it later is still the separate, named step.
        const again = await readReconcileFacts(queryable(db), [voiceCache]);
        expect(again.statements).toEqual([]);
        expect(again.undeclared).toContainEqual(
            { collection: "voice_cache", table: "public.voice_cache", column: "legacy_blob", blocksInserts: false }
        );
        const drop = await readReconcileFacts(queryable(db), [voiceCache], { drop: ["voice_cache.legacy_blob"] });
        expect(drop.statements).toEqual([`ALTER TABLE "public"."voice_cache" DROP COLUMN "legacy_blob";`]);
        expect(drop.dropped[0].rowsWithValue).toBe(3);
    });

    it("drops only the column named, and says how many rows hold data in it", async () => {
        const plan = await readReconcileFacts(queryable(db), [voiceCache], { drop: ["voice_cache.legacy_blob"] });

        expect(plan.problems).toEqual([]);
        expect(plan.dropped).toEqual([
            { collection: "voice_cache", table: "public.voice_cache", column: "legacy_blob", blocksInserts: true, rowsWithValue: 3 }
        ]);
        expect(plan.statements).toEqual([
            `ALTER TABLE "public"."voice_cache" ALTER COLUMN "wav" DROP NOT NULL;`,
            `ALTER TABLE "public"."voice_cache" DROP COLUMN "legacy_blob";`
        ]);
        expect(plan.digest).toBe(reconcileDigest(plan.statements));

        for (const statement of plan.statements) await db.exec(statement);

        const { rows } = await db.query<{ column_name: string; is_nullable: string }>(
            `SELECT column_name, is_nullable FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'voice_cache' ORDER BY column_name`
        );
        expect(rows).toEqual([
            { column_name: "id", is_nullable: "NO" },
            { column_name: "note", is_nullable: "YES" },
            { column_name: "path", is_nullable: "YES" },
            { column_name: "text", is_nullable: "NO" },
            { column_name: "wav", is_nullable: "YES" }
        ]);
        // The insert the API makes now succeeds without the fields it no longer has.
        await db.exec(`INSERT INTO public.voice_cache (text, path) VALUES ('d', 'voice/d.wav')`);

        // And a second plan has nothing left to do.
        const again = await readReconcileFacts(queryable(db), [voiceCache]);
        expect(again.statements).toEqual([]);
    });

    it("refuses to drop a column the collection still declares, or one that is not there", async () => {
        const plan = await readReconcileFacts(queryable(db), [voiceCache], {
            drop: ["voice_cache.wav", "voice_cache.nope", "nobody.legacy_blob", "legacy_blob"]
        });

        expect(plan.dropped).toEqual([]);
        expect(plan.statements.join("\n")).not.toMatch(/DROP COLUMN/);
        expect(plan.problems).toEqual([
            expect.stringContaining(`still declares "wav"`),
            expect.stringContaining(`has no column "nope"`),
            expect.stringContaining(`no table "nobody"`),
            expect.stringContaining("not <table>.<column>")
        ]);
    });

    it("gives a different digest to a different plan, so a stale confirmation cannot apply", async () => {
        const relaxOnly = await readReconcileFacts(queryable(db), [voiceCache]);
        const withDrop = await readReconcileFacts(queryable(db), [voiceCache], { drop: ["voice_cache.note"] });
        expect(relaxOnly.digest).not.toBe(withDrop.digest);
    });
});
