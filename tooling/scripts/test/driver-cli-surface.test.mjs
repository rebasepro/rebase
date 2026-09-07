/**
 * Every script the driver's CLI spawns must exist in the published tarball.
 *
 * `@rebasepro/server-postgres` runs four things as child processes, located by
 * path relative to its own CLI: the Drizzle schema generator, the Postgres DDL
 * planner, the introspector and the schema doctor. For years those paths pointed
 * at `<pkg>/schema/<name>.ts` and resolved only because `files` shipped `src`.
 *
 * `dff34e8688` removed `src` from sixteen tarballs to stop shipping the same
 * bytes twice. It was right about the bytes and it deleted this package's entire
 * command surface: no `dist/cli.js` had ever been built, so the published 0.18.0
 * driver contained no CLI at all. `rebase schema generate`, every `rebase db …`
 * and `rebase introspect` failed for every npm consumer, and because the parent
 * CLI reports a missing driver CLI as "Dependencies are not installed", the
 * message accused the user's install. The visible symptom was a scaffolded
 * project answering `GET /api/data/posts` with 500 `Table not found` on its
 * first run, three layers away from the cause.
 *
 * Nothing connected the spawn sites to the build's entry list, so this does:
 * the names are read out of `cli.ts` itself, and each one has to be in `dist`.
 * Adding a fifth spawned script without adding a build entry fails here.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PKG = path.join(ROOT, "packages", "server-postgres");

/** The scripts `cli.ts` asks {@link resolveChildScript} for, by name. */
function spawnedScriptNames() {
    const src = readFileSync(path.join(PKG, "src", "cli.ts"), "utf8");
    const names = [...src.matchAll(/resolveChildScript\(\s*"([^"]+)"\s*\)/g)].map(m => m[1]);
    return [...new Set(names)];
}

test("cli.ts spawns at least the four known scripts", () => {
    // A guard on the guard: if the regex stops matching, every assertion below
    // passes vacuously and the gate quietly stops holding anything.
    const names = spawnedScriptNames();
    assert.ok(
        names.length >= 4,
        `Only found ${names.length} resolveChildScript(...) call(s) in cli.ts. ` +
        "If the call shape changed, update spawnedScriptNames() — otherwise this gate checks nothing."
    );
});

test("the driver's own CLI is built", () => {
    assert.ok(
        existsSync(path.join(PKG, "dist", "cli.js")),
        "packages/server-postgres/dist/cli.js is missing. The parent CLI resolves the driver's " +
        "command surface as dist/cli.js; without it every `rebase db`/`schema` command reports " +
        "\"Dependencies are not installed\". Add it to the `lib.entry` map in vite.config.ts."
    );
});

test("every spawned script is built beside the CLI", () => {
    for (const name of spawnedScriptNames()) {
        const built = path.join(PKG, "dist", "schema", `${name}.js`);
        assert.ok(
            existsSync(built),
            `cli.ts spawns "${name}" but packages/server-postgres/dist/schema/${name}.js does not ` +
            "exist. Add it to the `lib.entry` map in vite.config.ts — a published copy has no `src/`, " +
            "so an unbuilt child script is a command that cannot run."
        );
    }
});

/**
 * The two generators guard their own `main()` with
 * `import.meta.url.endsWith(process.argv[1])`, which is false once the module is
 * a shared chunk rather than the process entry — the script then exits 0 having
 * done nothing, and the caller reports success over an unwritten schema. Their
 * build entries go through `src/schema/bin/*`, which calls `main` outright.
 */
test("a guarded generator is built from its bin entry, not from the module", () => {
    const config = readFileSync(path.join(PKG, "vite.config.ts"), "utf8");
    for (const name of ["generate-drizzle-schema", "generate-postgres-ddl"]) {
        const source = readFileSync(path.join(PKG, "src", "schema", `${name}.ts`), "utf8");
        if (!source.includes("import.meta.url.endsWith")) continue;
        assert.ok(
            config.includes(`src/schema/bin/${name}.ts`),
            `${name}.ts only runs main() when it is the process entry, which a bundled chunk ` +
            `never is. Its build entry must be src/schema/bin/${name}.ts, which calls main() ` +
            "directly — otherwise the built script exits 0 without generating anything."
        );
    }
});

/**
 * The build banner may not bind a plain identifier.
 *
 * The banner is prepended to EVERY output chunk, so any name it declares can
 * collide with a name a bundled module in that same chunk declares — and which
 * modules share a chunk is a decision the bundler remakes on every change.
 * `import process from "process"` in the banner met chalk's
 * `import process from "node:process"` and produced a file that did not parse.
 * It appeared only in the image's build, from source identical to the local
 * one, which is why no host-side gate saw it and `check:runtime-image:boots`
 * did.
 *
 * `process` was never needed — it is a Node global. So the rule is not "do not
 * import process", it is that a banner applied to code it has never seen may
 * only introduce names nothing else could plausibly use: `__`-prefixed, or the
 * `require` shim the CJS interop depends on.
 */
test("the build banner introduces no colliding identifiers", () => {
    const config = readFileSync(path.join(PKG, "vite.config.ts"), "utf8");
    const banner = config.match(/banner:\s*'([^']+)'/);
    assert.ok(banner, "No banner found in vite.config.ts — update this gate if it moved.");

    const bound = [
        // `import x from "y"` / `import x, {…} from "y"`
        ...[...banner[1].matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)].map(m => m[1]),
        // `const x =` / `let x =` / `var x =`
        ...[...banner[1].matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1])
    ];
    const ALLOWED = new Set(["require"]);
    const risky = bound.filter(name => !name.startsWith("__") && !ALLOWED.has(name));

    assert.deepEqual(
        risky,
        [],
        `The banner binds ${risky.join(", ")}, which every chunk then declares. A bundled module ` +
        "in the same chunk that declares the same name makes the file unparseable, and which " +
        "modules share a chunk changes with the entry list. Prefix it with `__`, or drop it — " +
        "Node globals such as `process` need no import."
    );
});
