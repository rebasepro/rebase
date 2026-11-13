/**
 * Step 1 of `rebase db push` failing has to stop the push.
 *
 * Both generators wrapped their whole body in `try { … } catch { print }` and
 * returned normally, so a `resources.ts` that does not evaluate printed
 * `Error generating DDL schema: … does not provide an export named 'queue'`,
 * exited 0, and the push walked on to Atlas — which applied whichever
 * `drizzle/schema.sql` was on disk, in the observed case three minutes old.
 * With no prior file the same run died inside Atlas on `stat
 * drizzle/schema.sql: no such file or directory`, two screens below the cause.
 *
 * The generators run as their own `tsx` subprocesses, so their exit code is the
 * whole contract with the CLI — which is why this spawns them for real rather
 * than importing `runGeneration`.
 */
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const fixtures = path.join(packageRoot, "test", "fixtures");

/** The workspace's tsx, found the way `resolveLocalBin` finds it. */
function tsxBin(): string {
    let dir = packageRoot;
    for (;;) {
        const candidate = path.join(dir, "node_modules", ".bin", "tsx");
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error("tsx not found — the generators cannot run without it");
}

function runGenerator(script: string, fixture: string, outputPath: string) {
    return spawnSync(
        tsxBin(),
        [
            path.join(packageRoot, "src", "schema", script),
            `--schema-dir=${path.join(fixtures, fixture, "schema")}`,
            `--output=${outputPath}`
        ],
        {
            cwd: packageRoot,
            encoding: "utf8",
            env: {
                ...process.env,
                DOTENV_CONFIG_QUIET: "true",
                // Workspace packages from source, as the neighbouring CLI
                // tests run them: a unit test must not need `dist` built.
                TSX_TSCONFIG_PATH: path.join(repoRoot, "tsconfig.typecheck.json")
            }
        }
    );
}

// The DDL generator evaluates the project's `resources.ts` (for the declared
// database extensions) and the Drizzle generator does not — it reads the
// schema and nothing else. So each is handed the module that can fail
// for it: a resources module that throws for the first, a schema module
// that throws for the second. The property under test is the same — step 1
// of `rebase db push` raised, so the generator must not exit 0.
describe.each([
    ["generate-postgres-ddl.ts", "broken-resources", "schema.sql", "Error generating DDL schema"],
    ["generate-drizzle-schema.ts", "broken-collection", "schema.generated.ts", "Error generating schema"]
])("%s", (script, fixture, outputName, errorPrefix) => {
    let outputDir: string;

    beforeEach(() => {
        outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-generator-"));
    });

    afterEach(() => {
        fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it("exits non-zero when the resources module throws", () => {
        const result = runGenerator(script, fixture, path.join(outputDir, outputName));

        expect(result.status).not.toBe(0);
        expect(`${result.stderr}${result.stdout}`).toContain(errorPrefix);
    }, 60_000);

    it("writes nothing when the resources module throws", () => {
        // The push commits `drizzle/schema.sql` and `src/schema.generated.ts`;
        // a half-written pair is worse than no run at all.
        runGenerator(script, fixture, path.join(outputDir, outputName));

        expect(fs.existsSync(path.join(outputDir, outputName))).toBe(false);
    }, 60_000);
});

describe("the fixture", () => {
    it("is only broken in `resources.ts`", () => {
        // Guards the DDL test above from passing for the wrong reason: if the
        // collection file itself stopped loading, the generator would fail
        // whatever the resources module did. The table must load — and load
        // from a package server-postgres declares, or pnpm's isolated layout
        // is what makes it fail.
        const fixture = path.join(fixtures, "broken-resources");
        const table = fs.readFileSync(path.join(fixture, "schema", "tags.ts"), "utf8");
        expect(table).toContain('from "@rebasepro/types"');
        expect(fs.readFileSync(path.join(fixture, "schema", "index.ts"), "utf8")).toContain("export { tags }");
        expect(fs.readFileSync(path.join(fixture, "resources.ts"), "utf8")).toContain("throw new Error");
    });

    it("is only broken in the schema module, for the generator that reads nothing else", () => {
        const fixture = path.join(fixtures, "broken-collection");
        expect(fs.readFileSync(path.join(fixture, "schema", "tags.ts"), "utf8")).toContain("throw new Error");
        expect(fs.existsSync(path.join(fixture, "resources.ts"))).toBe(false);
    });

    it("has a tsx to run", () => {
        expect(() => execFileSync(tsxBin(), ["--version"], { encoding: "utf8" })).not.toThrow();
    }, 60_000);
});
