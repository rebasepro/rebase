/**
 * The schema-drift remedy has to name a command the project can run.
 *
 * All three copies of it hard-coded `Run \`pnpm db:push\``. On a stock
 * scaffold the managed PGlite database is the default, and there that command
 * answers `✗ rebase db push does not work on the managed development database.`
 * and exits 1 — so the one instruction the server gave a developer whose schema
 * had drifted was a command their own project refuses.
 *
 * Atlas plans a push by diffing against a second, empty database and PGlite
 * serves exactly one, which is why it cannot run there. Boot applies additive
 * changes, so restarting `rebase dev` is the fix on that database and nowhere
 * else. `packages/cli/src/commands/dev.ts` had already been made kind-aware for
 * its own messages; these three had not.
 */
import { schemaDriftRemedy } from "../src/api/errors";

const KIND = "REBASE_DEV_DATABASE_KIND";

describe("schemaDriftRemedy", () => {
    const original = process.env[KIND];

    afterEach(() => {
        if (original === undefined) delete process.env[KIND];
        else process.env[KIND] = original;
    });

    describe("on the managed development database", () => {
        beforeEach(() => {
            process.env[KIND] = "managed";
        });

        it("never names db:push — the command is refused there", () => {
            const remedy = schemaDriftRemedy();
            const all = [remedy.short, ...remedy.lines].join("\n");

            expect(all).not.toContain("db:push");
            expect(remedy.short).not.toContain("rebase db push");
        });

        it("says to restart `rebase dev`", () => {
            expect(schemaDriftRemedy().short).toContain("rebase dev");
        });

        it("says why the push cannot run, and names the two databases where it can", () => {
            const lines = schemaDriftRemedy().lines.join("\n");

            expect(lines).toContain("PGlite serves one");
            expect(lines).toContain("DATABASE_URL");
            expect(lines).toContain("rebase dev --docker");
        });
    });

    describe("on a database of the developer's own", () => {
        it.each(["external", "docker", ""])("names `rebase db push` for kind %p", kind => {
            if (kind) process.env[KIND] = kind;
            else delete process.env[KIND];

            expect(schemaDriftRemedy().short).toContain("rebase db push");
        });

        it("still names the migration path and the cloud one", () => {
            delete process.env[KIND];
            const lines = schemaDriftRemedy().lines.join("\n");

            expect(lines).toContain("rebase db migrate");
            expect(lines).toContain("REBASE_MIGRATE_ON_BOOT");
        });

        it("has dropped the `pnpm db:push` spelling entirely", () => {
            // `pnpm db:push` is a scaffold script, not a command — it names one
            // package manager and one project layout. The CLI's own vocabulary
            // is what every other message here uses.
            delete process.env[KIND];
            const remedy = schemaDriftRemedy();

            expect([remedy.short, ...remedy.lines].join("\n")).not.toContain("db:push");
        });
    });

    it("returns box rows short enough to fit the hint box", () => {
        // The rows are padded to 62 columns and truncated at it; a line that
        // outgrew the box would be silently cut mid-word.
        for (const kind of ["managed", "external"]) {
            process.env[KIND] = kind;
            for (const line of schemaDriftRemedy().lines) {
                expect(line.length).toBeLessThanOrEqual(62);
            }
        }
    });
});
