/**
 * What a runtime loads when it imports the database driver leaves out execa.
 *
 * Every runtime imports `@rebasepro/server-postgres`, and the driver's index
 * re-exports its backup API, so whatever the backup code imports statically is
 * loaded at every boot. execa and its dependencies are about 200 KB of source
 * that V8 then holds for the life of the process, in a runtime that usually
 * never takes a backup. `backup-service.ts` therefore loads it with `import()`
 * on first use. One static `import { execa } from "execa"` anywhere the index
 * reaches puts it back, and nothing else would notice: the driver works either
 * way, only bigger.
 *
 * It follows the static `import`/`export … from` statements from the built
 * index, as Node does at boot, and fails if any file on that path carries
 * execa's code.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIST = path.join(ROOT, "packages", "server-postgres", "dist");
const ENTRY = path.join(DIST, "index.es.js");

/** rolldown's region comment for a file of the execa package. */
const EXECA = /^\/\/#region \S*\/node_modules\/execa\//m;
const STATIC_IMPORT = /^(?:import|export)\b[^;]*?\bfrom\s*["'](\.{1,2}\/[^"']+\.js)["']|^import\s*["'](\.{1,2}\/[^"']+\.js)["']/gm;

function staticClosure(entry) {
    const seen = new Set();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        for (const match of readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) {
            queue.push(path.resolve(path.dirname(file), match[1] ?? match[2]));
        }
    }
    return [...seen];
}

const built = existsSync(ENTRY);

test("server-postgres: execa is in the built dist, so the marker this gate looks for is real", { skip: !built && "not built" }, () => {
    const carriers = readdirSync(DIST).filter(name => name.endsWith(".js") && EXECA.test(readFileSync(path.join(DIST, name), "utf8")));
    assert.ok(carriers.length > 0, "no file in packages/server-postgres/dist carries execa's region comment; update the marker");
});

test("server-postgres: importing the driver does not load execa", { skip: !built && "not built" }, () => {
    const files = staticClosure(ENTRY);
    assert.ok(files.length > 1);
    const offenders = files.filter(file => EXECA.test(readFileSync(file, "utf8")));
    assert.deepEqual(
        offenders.map(file => path.relative(ROOT, file)),
        [],
        "these files load with the driver and carry execa; import it with `import()` where a process is spawned (see loadExeca in packages/server-postgres/src/backup/backup-service.ts)"
    );
});
