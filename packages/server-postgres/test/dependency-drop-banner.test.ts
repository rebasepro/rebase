/**
 * The DROP TYPE `db push`'s dependency box offers is a command the reader can
 * run.
 *
 * It was `psql "$DATABASE_URL" -c 'DROP TYPE "<name>" CASCADE;'`. On the
 * managed development database `.env` leaves DATABASE_URL commented out, so
 * the shell has none and psql connected to its own default. The NOT NULL box
 * beside it reads the project's connection string from `rebase db url`,
 * spelled the way the project runs `rebase`; this one now does the same.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { stripVTControlCharacters } from "util";

import { diagnoseDbError } from "../src/cli-errors";

const DEPENDENCY_DROP = { code: "2BP01", message: "cannot drop type posts_status because other objects depend on it" };

describe("the dependency box's DROP TYPE command", () => {
    const cwd = process.cwd();
    let project: string;

    beforeEach(() => {
        project = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-drop-type-"));
        fs.mkdirSync(path.join(project, "backend"));
        fs.writeFileSync(path.join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
        process.chdir(path.join(project, "backend"));
    });

    afterEach(() => {
        process.chdir(cwd);
        fs.rmSync(project, { recursive: true, force: true });
    });

    it("reads the connection string from `rebase db url`, spelled from the project's lockfile", () => {
        const banner = stripVTControlCharacters(diagnoseDbError(DEPENDENCY_DROP) ?? "");
        expect(banner).toContain("psql \"$(pnpm exec rebase db url)\" -c 'DROP TYPE \"<name>\" CASCADE;'");
        expect(banner).not.toContain("$DATABASE_URL");
    });
});
