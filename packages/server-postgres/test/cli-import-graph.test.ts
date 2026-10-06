/**
 * The driver CLI starts without loading the server.
 *
 * `src/cli.ts` imported `logger` from `@rebasepro/server` for one debug line.
 * That import is the whole server bundle (1.2 MB, plus hono, drizzle and zod),
 * and every driver command paid for it before parsing its argv: `db push`,
 * `schema generate`, `doctor`, and the two driver runs in every `rebase dev`
 * start. Under tsx, which is how the CLI always runs the driver, that was
 * ~0.4 s per invocation.
 *
 * Walks the static import graph from `src/cli.ts` — relative imports followed,
 * `import type` and `await import()` skipped, since neither loads anything at
 * startup — and asserts nothing in it imports `@rebasepro/server`.
 */
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "..", "src");

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

/** Every module reached from `entry` through static imports, with what imported it. */
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

describe("the driver CLI's startup import graph", () => {
    const graph = staticGraph(path.join(SRC, "cli.ts"));

    it("reaches the modules it should (the walk itself works)", () => {
        expect(graph.has(path.join(SRC, "cli-helpers.ts"))).toBe(true);
        expect(graph.size).toBeGreaterThan(10);
    });

    it("does not load @rebasepro/server", () => {
        const importers = [...graph]
            .filter(([, specifiers]) => specifiers.includes("@rebasepro/server"))
            .map(([file]) => path.relative(SRC, file));
        expect(importers).toEqual([]);
    });
});
