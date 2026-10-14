/**
 * The backfill `db push`'s NOT NULL box offers is a command the reader can run.
 *
 * It was `psql "$DATABASE_URL" -c 'UPDATE …'`. On the managed development
 * database `.env` leaves DATABASE_URL commented out on purpose, so the shell
 * has none and psql connected to its own default instead. `rebase db url`
 * prints the connection string every `rebase` command resolves, the managed
 * database's included, and inside `$(…)` it has to be spelled the way the
 * project runs `rebase`: a scaffold keeps it in `node_modules/.bin`, not on
 * PATH — `pnpm exec rebase`, as `rebase start`'s own hint spells it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { stripVTControlCharacters } from "util";

import { diagnoseAtlasFailure, formatNotNullViolationBanner } from "../src/cli-errors";

const NOT_NULL_EXISTING =
    "Error: executing statement \"ALTER TABLE \\\"public\\\".\\\"authors\\\" ALTER COLUMN \\\"contact_email\\\" SET NOT NULL;\": "
    + "pq: column \"contact_email\" of relation \"authors\" contains null values (23502)";

/** The banner with its colour codes removed, as a terminal shows it. */
const plain = (text: string): string => stripVTControlCharacters(text);

describe("the NOT NULL box's backfill command", () => {
    it("reads the project's connection string from `rebase db url`, never from $DATABASE_URL", () => {
        const banner = plain(formatNotNullViolationBanner({ table: "authors", column: "contact_email" }, 3, false, "pnpm"));
        expect(banner).toContain(
            "psql \"$(pnpm exec rebase db url)\" -c 'UPDATE \"authors\" SET \"contact_email\" = … WHERE \"contact_email\" IS NULL;'"
        );
        expect(banner).not.toContain("$DATABASE_URL");
    });

    it.each([
        ["pnpm", "pnpm exec rebase db url"],
        ["npm", "npx rebase db url"],
        ["yarn", "yarn rebase db url"],
        ["bun", "bunx rebase db url"],
        ["unknown", "rebase db url"]
    ] as const)("spells rebase the way a %s project runs it", (manager, command) => {
        const banner = plain(formatNotNullViolationBanner({ table: "authors", column: "contact_email" }, 3, false, manager));
        expect(banner).toContain(`psql "$(${command})"`);
    });

    describe("from the directory `db push` runs in", () => {
        const cwd = process.cwd();
        let project: string;

        beforeEach(() => {
            project = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-not-null-"));
            fs.mkdirSync(path.join(project, "backend"));
            fs.writeFileSync(path.join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
        });

        afterEach(() => {
            process.chdir(cwd);
            fs.rmSync(project, { recursive: true, force: true });
        });

        it("reads the package manager off the project's lockfile, above backend/", async () => {
            process.chdir(path.join(project, "backend"));
            const hint = await diagnoseAtlasFailure({
                domain: "schema",
                args: ["apply", "--to", "file://.rebase/sql/schema.sql"],
                stderr: NOT_NULL_EXISTING
            });
            expect(plain(hint ?? "")).toContain("psql \"$(pnpm exec rebase db url)\" -c 'UPDATE \"authors\"");
        });
    });
});
