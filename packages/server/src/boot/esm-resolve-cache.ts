import fs from "node:fs";
import { registerHooks, type ResolveFnOutput, type ResolveHookContext } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Resolves relative `.js` imports inside `"type": "module"` packages from a
 * per-process cache of each package's `type`.
 *
 * Node's ESM loader decides the format of every `.js` file it resolves by
 * reading the nearest `package.json` (`getPackageScopeConfig`). It builds the
 * result by spreading the package config, and the spread runs the lazy
 * `exports` getter, so the whole `exports` field is re-read and re-parsed each
 * time — two or three times per module. drizzle-orm's `package.json` is 177 KB,
 * almost all of it `exports`, and a runtime loads about two hundred of its
 * files, so without this most of what a boot allocates is that parse (326 MB
 * of 409 MB). All of it is garbage, but the heap has to grow to hold it: about
 * 280 MB committed to keep 35 MB alive, a peak a pod's memory limit has to
 * allow for at every start.
 *
 * The answer Node computes is a function of the nearest `package.json`'s
 * `type`, which cannot change while the process runs (Node caches the file
 * itself for the life of the process too). So this answers it once per
 * directory and returns the same URL and format Node's own resolver would.
 *
 * Only the case Node would answer `format: "module"` without further thought
 * is taken: a `./` or `../` specifier ending in `.js`, from a `file:` parent,
 * naming an existing regular file whose nearest `package.json` says
 * `"type": "module"`. Everything else — bare specifiers, queries, hashes,
 * percent-escapes, typeless packages, `require` calls, missing files,
 * directories, unreadable or invalid `package.json` files — goes to Node's
 * resolver unchanged, which also means its error messages are the ones a
 * broken import still gets.
 */

/** What a directory's nearest `package.json` says about module format, as far as this cache acts on it. */
type ScopeType = "module" | "other";

let installed = false;

/**
 * Register the resolve hook for this process. Idempotent; returns whether this
 * call installed it.
 *
 * Not installed under `--preserve-symlinks`: Node then resolves to the path
 * as written rather than its real path, and this resolver always answers the
 * real path.
 */
export function installEsmResolveCache(): boolean {
    if (installed || preservesSymlinks(process.execArgv, process.env.NODE_OPTIONS)) return false;
    const scopeTypes = new Map<string, ScopeType>();
    registerHooks({
        resolve(specifier, context, nextResolve) {
            const fast = resolveRelativeModule(specifier, context, scopeTypes);
            return fast ?? nextResolve(specifier, context);
        }
    });
    installed = true;
    return true;
}

/** Whether Node was started with `--preserve-symlinks`, on its command line or in `NODE_OPTIONS`. */
export function preservesSymlinks(execArgv: readonly string[], nodeOptions: string | undefined): boolean {
    const flag = (arg: string) => arg === "--preserve-symlinks" || arg.startsWith("--preserve-symlinks=");
    return execArgv.some(flag) || (nodeOptions ?? "").split(/\s+/).some(flag);
}

/**
 * The resolution Node's default resolver would return for `specifier`, when it
 * is a relative `.js` import of a file in a `"type": "module"` package, or
 * `undefined` to leave the decision to Node.
 */
export function resolveRelativeModule(
    specifier: string,
    context: Pick<ResolveHookContext, "parentURL" | "conditions">,
    scopeTypes: Map<string, ScopeType>
): ResolveFnOutput | undefined {
    const parentURL = context.parentURL;
    if (!parentURL || !parentURL.startsWith("file:")) return undefined;
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
    if (!specifier.endsWith(".js") || /[?#%\\]/.test(specifier)) return undefined;
    if (context.conditions.includes("require")) return undefined;

    let file: string;
    try {
        file = fileURLToPath(new URL(specifier, parentURL));
    } catch {
        return undefined;
    }
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) return undefined;

    let real: string;
    try {
        real = fs.realpathSync(file);
    } catch {
        return undefined;
    }
    if (scopeTypeOf(real, scopeTypes) !== "module") return undefined;
    return { url: pathToFileURL(real).href, format: "module", shortCircuit: true };
}

/**
 * The `type` of the `package.json` that governs `file`: the nearest one above
 * it, never one directly inside a `node_modules` directory, which is where
 * Node's own lookup stops.
 */
export function scopeTypeOf(file: string, scopeTypes: Map<string, ScopeType>): ScopeType {
    const visited: string[] = [];
    let dir = path.dirname(file);
    let result: ScopeType;
    for (;;) {
        const known = scopeTypes.get(dir);
        if (known !== undefined) {
            result = known;
            break;
        }
        visited.push(dir);
        if (path.basename(dir) === "node_modules") {
            result = "other";
            break;
        }
        const declared = readPackageType(path.join(dir, "package.json"));
        if (declared !== undefined) {
            result = declared;
            break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            result = "other";
            break;
        }
        dir = parent;
    }
    for (const d of visited) scopeTypes.set(d, result);
    return result;
}

/** `undefined` when there is no `package.json` at `file`, so the lookup continues upward. */
function readPackageType(file: string): ScopeType | undefined {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (error) {
        return isMissingFile(error) ? undefined : "other";
    }
    try {
        const parsed: unknown = JSON.parse(text);
        const type = typeof parsed === "object" && parsed !== null && "type" in parsed ? parsed.type : undefined;
        return type === "module" ? "module" : "other";
    } catch {
        return "other";
    }
}

/** By `code` rather than `instanceof Error`, which is false for an error from another realm. */
function isMissingFile(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error
        && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
