/**
 * `schema introspect` warns that `DATABASE_URL` still names the database it
 * read only when the project's `.env` really does. A read from
 * `--database-url`, with `.env` naming another database or none, was warned
 * about too.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { projectEnvNames } from "../src/schema/introspect-db-project";

const SOURCE = "postgresql://postgres:pw@localhost:5544/supabase";

function envFile(text: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-introspect-env-"));
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, text);
    return file;
}

describe("projectEnvNames", () => {
    it("is true when .env names the database that was read", () => {
        expect(projectEnvNames(envFile(`DATABASE_URL=${SOURCE}\n`), SOURCE)).toBe(true);
    });

    it("is false for a read from --database-url when .env names another database, or none", () => {
        expect(projectEnvNames(envFile("DATABASE_URL=postgresql://localhost:5432/app\n"), SOURCE)).toBe(false);
        expect(projectEnvNames(envFile("# DATABASE_URL commented out: the managed database\n"), SOURCE)).toBe(false);
        expect(projectEnvNames(undefined, SOURCE)).toBe(false);
    });
});
