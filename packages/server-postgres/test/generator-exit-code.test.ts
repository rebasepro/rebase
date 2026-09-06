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
const fixture = path.join(packageRoot, "test", "fixtures", "broken-resources");

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

function runGenerator(script: string, outputPath: string) {
    return spawnSync(
        tsxBin(),
        [
            path.join(packageRoot, "src", "schema", script),
            `--collections=${path.join(fixture, "collections")}`,
            `--output=${outputPath}`
        ],
        { cwd: packageRoot, encoding: "utf8", env: { ...process.env, DOTENV_CONFIG_QUIET: "true" } }
    );
}

describe.each([
    ["generate-postgres-ddl.ts", "schema.sql", "Error generating DDL schema"],
    ["generate-drizzle-schema.ts", "schema.generated.ts", "Error generating schema"]
])("%s", (script, outputName, errorPrefix) => {
    let outputDir: string;

    beforeEach(() => {
        outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-generator-"));
    });

    afterEach(() => {
        fs.rmSync(outputDir, { recursive: true, force: true });
    });

    it("exits non-zero when the resources module throws", () => {
        const result = runGenerator(script, path.join(outputDir, outputName));

        expect(result.status).not.toBe(0);
        expect(`${result.stderr}${result.stdout}`).toContain(errorPrefix);
    }, 60_000);

    it("writes nothing when the resources module throws", () => {
        // The push commits `drizzle/schema.sql` and `src/schema.generated.ts`;
        // a half-written pair is worse than no run at all.
        runGenerator(script, path.join(outputDir, outputName));

        expect(fs.existsSync(path.join(outputDir, outputName))).toBe(false);
    }, 60_000);
});

describe("the fixture", () => {
    it("is only broken in `resources.ts`", () => {
        // Guards the test above from passing for the wrong reason: if the
        // collection file itself stopped loading, both generators would fail
        // whatever the resources module did.
        expect(fs.existsSync(path.join(fixture, "collections", "tags.ts"))).toBe(true);
        expect(fs.readFileSync(path.join(fixture, "resources.ts"), "utf8")).toContain("throw new Error");
    });

    it("has a tsx to run", () => {
        expect(() => execFileSync(tsxBin(), ["--version"], { encoding: "utf8" })).not.toThrow();
    }, 60_000);
});
