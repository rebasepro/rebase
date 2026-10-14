/**
 * The schema-drift remedy has to name a command the project can run.
 *
 * All three copies of it hard-coded `Run \`pnpm db:push\``, a scaffold script
 * rather than a command. On the managed development database boot applies
 * additive changes, so restarting `rebase dev` is the first fix there, and
 * `rebase db push` — which plans against a throwaway database of its own on
 * the managed database — applies what boot leaves alone. The box said push
 * "does not run here", which stopped being true with 0.25.
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

        it("never names db:push", () => {
            const remedy = schemaDriftRemedy();

            expect([remedy.short, ...remedy.lines].join("\n")).not.toContain("db:push");
        });

        it("says to restart `rebase dev`", () => {
            expect(schemaDriftRemedy().short).toContain("rebase dev");
        });

        it("names `rebase db push` for what boot leaves alone, and never says it does not run there", () => {
            const remedy = schemaDriftRemedy();
            const all = [remedy.short, ...remedy.lines].join("\n");

            expect(remedy.short).toContain("rebase db push");
            expect(remedy.lines.join("\n")).toMatch(/rebase db push\s+applies what boot leaves alone/);
            expect(all).not.toContain("does not run here");
            expect(all).not.toContain("PGlite serves one");
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
