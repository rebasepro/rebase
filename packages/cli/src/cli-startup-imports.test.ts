/**
 * `rebase` starts without loading every command.
 *
 * `cli.ts` imported each command module statically, so every invocation —
 * `rebase --version`, `rebase --help`, `rebase db --help`, and the two times
 * `rebase dev` re-runs the CLI itself — loaded inquirer (every interactive
 * command), execa, the SDK client (cloud), the code generator (generate-sdk)
 * and the server packages (auth): 231 ES modules and 125–144 ms from the built
 * CLI, against a Node floor of 35–42 ms. Each command module is now imported
 * when its command runs.
 *
 * Walks the static import graph from `src/index.ts`, the bundle's entry —
 * relative imports followed, `import type` and `await import()` skipped, since
 * neither loads anything at startup — and asserts none of it imports those
 * packages.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));

/** Packages a command may load when it runs, and nothing may load at startup. */
const COMMAND_ONLY = [
    "inquirer",
    "@inquirer/",
    "execa",
    "@rebasepro/client",
    "@rebasepro/codegen",
    "@rebasepro/server",
    "@rebasepro/server-postgres",
    "drizzle-orm"
];

/** Value imports and re-exports of one module, by specifier. */
function staticImports(source: string): string[] {
    const specifiers: string[] = [];
    const statement = /^\s*(import|export)\s+([\s\S]*?)\s*from\s+["']([^"']+)["']/gm;
    for (const match of source.matchAll(statement)) {
        const clause = match[2];
        if (/^type\b/.test(clause)) continue;
        // `import { type A, type B } from` loads nothing either.
        const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
        if (braces && braces[1].split(",").map(s => s.trim()).filter(Boolean).every(s => s.startsWith("type "))) continue;
        specifiers.push(match[3]);
    }
    for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) specifiers.push(match[1]);
    return specifiers;
}

function resolveRelative(from: string, specifier: string): string | null {
    const base = path.resolve(path.dirname(from), specifier.replace(/\.js$/, ""));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** Every module reached from `entry` through static imports, with its specifiers. */
function staticGraph(entry: string): Map<string, string[]> {
    const seen = new Map<string, string[]>();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        const specifiers = staticImports(fs.readFileSync(file, "utf-8"));
        seen.set(file, specifiers);
        for (const specifier of specifiers) {
            if (!specifier.startsWith(".")) continue;
            const resolved = resolveRelative(file, specifier);
            if (resolved) queue.push(resolved);
        }
    }
    return seen;
}

const isCommandOnly = (specifier: string) =>
    COMMAND_ONLY.some(name => name.endsWith("/") ? specifier.startsWith(name) : specifier === name || specifier.startsWith(`${name}/`));

describe("the CLI's startup import graph", () => {
    const graph = staticGraph(path.join(SRC, "index.ts"));

    it("reaches the modules it should (the walk itself works)", () => {
        expect(graph.has(path.join(SRC, "cli.ts"))).toBe(true);
        expect(graph.has(path.join(SRC, "utils", "args.ts"))).toBe(true);
    });

    it("loads no command's dependencies before the command runs", () => {
        const loaded = [...graph]
            .flatMap(([file, specifiers]) => specifiers.filter(isCommandOnly).map(s => `${path.relative(SRC, file)} -> ${s}`))
            .sort();
        expect(loaded).toEqual([]);
    });

    it("loads no command module", () => {
        const commands = [...graph.keys()]
            .map(file => path.relative(SRC, file))
            .filter(file => file.startsWith(`commands${path.sep}`))
            .sort();
        expect(commands).toEqual([]);
    });
});
