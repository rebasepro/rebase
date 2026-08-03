import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A prompt is only constructed when a command actually needs to ask something,
 * so a wrong prompt type is invisible to every test that takes the
 * non-interactive path — and invisible to typecheck, because the options are
 * cast on the way into `inquirer.prompt`.
 *
 * `rebase cloud link` shipped with two of them and `cloud databases` with a
 * third. Running link interactively died with
 * `Prompt type "list" is not registered`, so linking a project — the first thing
 * anyone does with the cloud CLI — was broken from a fresh checkout while CI
 * stayed green.
 */
describe("interactive prompts use a type inquirer still registers", () => {
    /** Prompt types inquirer exposes. `list` was renamed to `select` and now throws. */
    const REGISTERED = new Set([
        "checkbox", "confirm", "editor", "expand", "input",
        "number", "password", "rawlist", "search", "select"
    ]);
    /** Removed or never-valid names that read like prompt types. */
    const RETIRED = new Set(["list", "rawList", "choice", "choices"]);

    function sourceFiles(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return sourceFiles(full);
            return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
                ? [full]
                : [];
        });
    }

    /**
     * `type:` appears all over this codebase for unrelated reasons, so a match
     * only counts when the same object literal also carries a prompt's `name:`
     * and `message:` — which every inquirer question has and nothing else does.
     */
    function promptTypesIn(source: string): string[] {
        const found: string[] = [];
        for (const block of source.matchAll(/\{[^{}]*type:\s*["']([A-Za-z]+)["'][^{}]*\}/g)) {
            const [whole, type] = block;
            if (/\bname:\s*["']/.test(whole) && /\bmessage:\s*["'`]/.test(whole)) {
                found.push(type);
            }
        }
        return found;
    }

    it("never uses the removed `list` type", () => {
        const offenders = sourceFiles(SRC)
            .filter(file => promptTypesIn(fs.readFileSync(file, "utf8")).some(t => RETIRED.has(t)))
            .map(file => path.relative(SRC, file));

        expect(offenders).toEqual([]);
    });

    it("only uses prompt types inquirer registers", () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            for (const type of promptTypesIn(fs.readFileSync(file, "utf8"))) {
                if (!REGISTERED.has(type)) {
                    offenders.push(`${path.relative(SRC, file)}: ${type}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("actually detects a bad prompt, so the guard cannot pass vacuously", () => {
        // Without this, a regex that matched nothing would report a clean repo.
        const bad = "inquirer.prompt([{ type: \"list\", name: \"picked\", message: \"Pick:\" }])";
        expect(promptTypesIn(bad)).toEqual(["list"]);
        const good = "inquirer.prompt([{ type: \"select\", name: \"picked\", message: \"Pick:\" }])";
        expect(promptTypesIn(good)).toEqual(["select"]);
        // And it ignores the unrelated `type:` fields this codebase is full of.
        expect(promptTypesIn("{ type: \"string\", columnType: \"text\" }")).toEqual([]);
    });
});
