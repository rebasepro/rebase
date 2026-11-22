import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";
import { createPostgresAdapter } from "../src/PostgresAdapter";

/**
 * `backend/sql` on the database `rebase dev` runs by default: PGlite, in
 * process. A file is many statements, which drizzle's `execute` refuses on
 * PGlite as it does on `pg` — so the boot reaches past drizzle to PGlite's
 * `exec`, and this proves it does, through the adapter an application builds
 * (`createPostgresAdapter({ sqlDir })`, the library-mode option).
 */
const open: PGlite[] = [];

afterEach(async () => {
    await Promise.all(open.splice(0).map(db => db.close()));
});

function project(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-sql-pglite-"));
    for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql, "utf8");
    return dir;
}

describe("backend/sql on PGlite", () => {
    it("applies multi-statement files once, through the adapter's sqlDir", async () => {
        const pglite = new PGlite();
        open.push(pglite);
        const sqlDir = project({
            "010_tables.sql": "CREATE TABLE public.notes (id serial PRIMARY KEY, body text NOT NULL); CREATE TABLE public.runs (n int);",
            "020_trigger.sql": `
                CREATE OR REPLACE FUNCTION public.notes_trim() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN NEW.body := btrim(NEW.body); RETURN NEW; END $$;
                DROP TRIGGER IF EXISTS notes_trim ON public.notes;
                CREATE TRIGGER notes_trim BEFORE INSERT ON public.notes FOR EACH ROW EXECUTE FUNCTION public.notes_trim();
                INSERT INTO public.runs VALUES (1);
            `
        });
        const adapter = createPostgresAdapter({ connection: drizzle(pglite), sqlDir });

        const first = await adapter.ensureSqlFiles!(undefined);
        expect(first.applied).toEqual(["010_tables.sql", "020_trigger.sql"]);
        const second = await adapter.ensureSqlFiles!(undefined);
        expect(second).toEqual({ dir: sqlDir, applied: [], unchanged: ["010_tables.sql", "020_trigger.sql"], removed: [] });

        await pglite.query("INSERT INTO public.notes (body) VALUES ('  padded  ')");
        expect((await pglite.query<{ body: string }>("SELECT body FROM public.notes")).rows).toEqual([{ body: "padded" }]);
        expect((await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM public.runs")).rows[0].n).toBe(1);
    });

    it("reports a file removed since it was applied, and undoes nothing", async () => {
        const pglite = new PGlite();
        open.push(pglite);
        const dir = project({ "010_a.sql": "CREATE TABLE public.a (id int);" });
        const bootstrapper = createPostgresBootstrapper({ connection: drizzle(pglite) });
        await bootstrapper.ensureSqlFiles!(dir);
        fs.rmSync(path.join(dir, "010_a.sql"));

        const outcome = await bootstrapper.ensureSqlFiles!(dir);
        expect(outcome.removed).toEqual(["010_a.sql"]);
        expect((await pglite.query<{ t: string | null }>("SELECT to_regclass('public.a')::text AS t")).rows[0].t).toBe("a");
    });
});
