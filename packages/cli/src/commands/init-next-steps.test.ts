/**
 * The "Next steps" `rebase init` closes on, for every flavour it scaffolds.
 *
 * `init --headless --database-url` — the documented BaaS path — opened on
 * `pnpm run db:push`. The headless scaffold has no such script (it declares no
 * schema: its tables are the developer's own), so the first thing a new user
 * ran failed with `ERR_PNPM_NO_SCRIPT`, and `rebase db push` after it failed on
 * an Atlas the flavour does not install. The branch for "a database URL was
 * given" was checked before the one for "headless", so the CMS steps were
 * printed for a headless project.
 *
 * Two holds, per flavour: the steps themselves, pinned so a change to them is a
 * reviewed change; and every script and binary they name, checked against the
 * package.json of the scaffold they are printed for.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { stripVTControlCharacters } from "util";
import { initNextSteps, type InitNextStepsInput } from "./init";
import { getPMCommands, type PackageManager } from "../utils/package-manager";

const TEMPLATES = path.resolve(__dirname, "..", "..", "templates");

/** The root package.json a flavour's project ends up with: the overlay replaces the template's. */
function rootManifest(headless: boolean): { scripts: Record<string, string>; devDependencies: Record<string, string> } {
    const file = headless
        ? path.join(TEMPLATES, "overlays", "baas", "package.json")
        : path.join(TEMPLATES, "template", "package.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

type Flavour = Omit<InitNextStepsInput, "pm" | "cdTarget">;

const FLAVOURS: Record<string, Flavour> = {
    "default": { headless: false, ownDatabase: false, introspect: false, introspected: false, installed: false },
    "default, installed": { headless: false, ownDatabase: false, introspect: false, introspected: false, installed: true },
    "--database-url": { headless: false, ownDatabase: true, introspect: false, introspected: false, installed: true },
    "--database-url --introspect": { headless: false, ownDatabase: true, introspect: true, introspected: true, installed: true },
    "--database-url --introspect, not run": { headless: false, ownDatabase: true, introspect: true, introspected: false, installed: false },
    "--headless": { headless: true, ownDatabase: false, introspect: false, introspected: false, installed: false },
    "--headless --database-url": { headless: true, ownDatabase: true, introspect: false, introspected: false, installed: false },
    "--headless --database-url --introspect": { headless: true, ownDatabase: true, introspect: true, introspected: true, installed: true },
    "--headless --database-url --introspect, not run": { headless: true, ownDatabase: true, introspect: true, introspected: false, installed: false }
};

function steps(flavour: Flavour, pm: PackageManager = "pnpm"): string[] {
    return initNextSteps({ ...flavour, cdTarget: "my-app", pm: getPMCommands(pm) })
        .map(line => stripVTControlCharacters(line).trimEnd());
}

/** The commands among the steps: indented lines that are not `#` notes or prose. */
function commands(lines: string[]): string[][] {
    return lines
        .filter(line => line.startsWith("  ") && !line.trimStart().startsWith("#"))
        .map(line => line.trim().split(/\s+/));
}

describe("every command init prints works in the scaffold it is printed for", () => {
    for (const [name, flavour] of Object.entries(FLAVOURS)) {
        for (const pm of ["pnpm", "npm"] as const) {
            it(`${name} (${pm})`, () => {
                const manifest = rootManifest(flavour.headless);
                const printed = commands(steps(flavour, pm));
                expect(printed.length).toBeGreaterThan(0);

                for (const command of printed) {
                    const [bin, verb, ...rest] = command;
                    // SQL, comment included, is run in the database rather than a shell.
                    if (bin === "cd" || bin === "ALTER" || bin === "CREATE" || bin === "--") continue;
                    expect(bin, command.join(" ")).toBe(pm === "pnpm" ? "pnpm" : bin === "npx" ? "npx" : "npm");
                    if (verb === "run") {
                        // `pnpm run db:push` in a project without `db:push` is
                        // ERR_PNPM_NO_SCRIPT on the user's first command.
                        expect(Object.keys(manifest.scripts), `${command.join(" ")} — no such script`).toContain(rest[0]);
                    } else if (verb === "exec" || bin === "npx") {
                        // `pnpm exec rebase …` / `npx rebase …` runs the project's own CLI.
                        expect(bin === "npx" ? verb : rest[0]).toBe("rebase");
                        expect(Object.keys(manifest.devDependencies)).toContain("@rebasepro/cli");
                    } else {
                        expect(verb, command.join(" ")).toBe("install");
                    }
                }
            });
        }
    }

    it("never pushes a schema for a headless project, which declares none", () => {
        for (const [name, flavour] of Object.entries(FLAVOURS)) {
            if (!flavour.headless) continue;
            expect(steps(flavour).join("\n"), name).not.toMatch(/db:push|db push/);
        }
    });

    it("says what to install only when the install did not happen", () => {
        for (const flavour of Object.values(FLAVOURS)) {
            expect(steps(flavour).includes("  pnpm install")).toBe(!flavour.installed);
        }
    });
});

describe("the steps, per flavour", () => {
    it("default", () => {
        expect(steps(FLAVOURS["default"])).toMatchInlineSnapshot(`
          [
            "  cd my-app",
            "  pnpm install",
            "",
            "  # A local database configuration has been generated in .env.",
            "  # Start everything — the database and schema are set up for you,",
            "  # with no Docker and nothing else to install:",
            "  pnpm run dev",
            "",
            "  # To use a Postgres of your own instead, uncomment DATABASE_URL in .env.",
            "",
            "  # Sign in: the first account you register becomes the admin.",
            "  # In production (docker compose) that window is shut and the account named by",
            "  # REBASE_ADMIN_EMAIL in .env is created at boot instead.",
            "",
            "This starts both the backend (Hono + PostgreSQL) and the frontend (Vite + React) concurrently.",
          ]
        `);
    });

    it("--database-url", () => {
        expect(steps(FLAVOURS["--database-url"])).toMatchInlineSnapshot(`
          [
            "  cd my-app",
            "",
            "  # Your custom database is configured in .env.",
            "  # If the database is empty, push the Rebase schema to initialize it:",
            "  pnpm run db:push",
            "",
            "  # Then start the development server:",
            "  pnpm run dev",
            "",
            "  # Sign in: the first account you register becomes the admin.",
            "  # In production (docker compose) that window is shut and the account named by",
            "  # REBASE_ADMIN_EMAIL in .env is created at boot instead.",
            "",
            "This starts both the backend (Hono + PostgreSQL) and the frontend (Vite + React) concurrently.",
          ]
        `);
    });

    it("--database-url --introspect, not run", () => {
        expect(steps(FLAVOURS["--database-url --introspect, not run"])).toMatchInlineSnapshot(`
          [
            "  cd my-app",
            "  pnpm install",
            "",
            "  # Introspection did not run — finish it with:",
            "  pnpm exec rebase schema introspect --force",
            "  pnpm exec rebase schema generate",
            "",
            "  # Then start the development server:",
            "  pnpm run dev",
            "",
            "  # Sign in: the first account you register becomes the admin.",
            "  # In production (docker compose) that window is shut and the account named by",
            "  # REBASE_ADMIN_EMAIL in .env is created at boot instead.",
            "",
            "This starts both the backend (Hono + PostgreSQL) and the frontend (Vite + React) concurrently.",
          ]
        `);
    });

    it("--headless", () => {
        expect(steps(FLAVOURS["--headless"])).toMatchInlineSnapshot(`
          [
            "  cd my-app",
            "  pnpm install",
            "",
            "  # A local database configuration has been generated in .env.",
            "  # 1. Start everything — the database comes up with it:",
            "  pnpm run dev",
            "",
            "  # 2. Create your tables (migrations, SQL, any tool you like).",
            "  #    A table is served once row-level security is enabled on it, and a",
            "  #    policy is what opens its rows:",
            "  ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;",
            "  -- rebase.uid() is text: the cast makes this work for a uuid or integer column too.",
            "  CREATE POLICY your_table_owner ON your_table FOR ALL USING (user_id::text = rebase.uid());",
            "  #    The API logs any table it skips, and why.",
            "",
            "  # Sign in: the first account you register becomes the admin.",
            "  # In production (docker compose) that window is shut and the account named by",
            "  # REBASE_ADMIN_EMAIL in .env is created at boot instead.",
            "",
            "This starts a headless API (Hono + PostgreSQL). There are no collection files: the API is derived from your database schema. Once it serves a table, docs are at /api/swagger.",
          ]
        `);
    });

    it("--headless --database-url", () => {
        expect(steps(FLAVOURS["--headless --database-url"])).toMatchInlineSnapshot(`
          [
            "  cd my-app",
            "  pnpm install",
            "",
            "  # Your database is configured in .env (DATABASE_URL).",
            "  # 1. Start the API over it:",
            "  pnpm run dev",
            "",
            "  # 2. Serve your tables.",
            "  #    A table is served once row-level security is enabled on it, and a",
            "  #    policy is what opens its rows:",
            "  ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;",
            "  -- rebase.uid() is text: the cast makes this work for a uuid or integer column too.",
            "  CREATE POLICY your_table_owner ON your_table FOR ALL USING (user_id::text = rebase.uid());",
            "  #    The API logs any table it skips, and why.",
            "",
            "  # Sign in: the first account you register becomes the admin.",
            "  # In production (docker compose) that window is shut and the account named by",
            "  # REBASE_ADMIN_EMAIL in .env is created at boot instead.",
            "",
            "This starts a headless API (Hono + PostgreSQL). There are no collection files: the API is derived from your database schema. Once it serves a table, docs are at /api/swagger.",
          ]
        `);
    });

    it("--headless --database-url --introspect", () => {
        expect(steps(FLAVOURS["--headless --database-url --introspect"])).toMatchInlineSnapshot(`
          [
            "  cd my-app",
            "",
            "  # Database has been introspected & collections generated!",
            "  # Start the API over it:",
            "  pnpm run dev",
            "",
            "  # Sign in: the first account you register becomes the admin.",
            "  # In production (docker compose) that window is shut and the account named by",
            "  # REBASE_ADMIN_EMAIL in .env is created at boot instead.",
            "",
            "This starts a headless API (Hono + PostgreSQL) over the collections just generated from your database in config/collections. Edit them to change what the API exposes; docs are at /api/swagger.",
          ]
        `);
    });
});
