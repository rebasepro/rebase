/**
 * The endpoint index names every route the server mounts.
 *
 * `backend/api.md` documents the *data* API — the CRUD routes a collection
 * generates — and the OpenAPI document describes the same set, because it is
 * generated from the collections. Everything else the backend mounts was
 * documented in prose, on the page that happened to be about it, or nowhere:
 * the whole `/api/admin/*` surface (api keys, backups, the RLS audit, the log
 * stream, the schema editor, the captured dev mail) had no index at all. A
 * reader with a token and a question — *what can this key reach* — had the
 * source.
 *
 * So: one table, `backend/endpoints.md`, and this, which compares it to the
 * routes the source actually registers.
 *
 * ## How the inventory is built
 *
 * Statically, in two halves, because Hono's own route list needs a booted app
 * and a database.
 *
 *   1. {@link MOUNTS} maps each `new Hono()` **receiver** to the prefix it is
 *      mounted at. It is hand-written — the mounts are conditional on
 *      `surfaces` and spread across three thousand lines — but it is *checked*:
 *      a `new Hono()` anywhere under `packages/server/src` that this map does
 *      not mention is a finding, so a new router cannot be added in silence.
 *   2. Inside each module, every `x.get("/path", …)` and friend on a mapped
 *      receiver is a route.
 *
 * The key is `<file>#<receiver>`, not the file, because the completeness rule
 * used to glob `**\/*route*.ts` — a filename test. `boot.ts`, `metrics/index.ts`,
 * `api/rest/api-generator.ts`, `functions/proxy.ts` and
 * `auth/reset-password-admin.ts` are all routers that are not called one, so the
 * gate printed "63/63" while `GET /livez` — the value of
 * `RUNTIME_LIVENESS_PATH`, and what five deploy guides tell an operator to probe
 * — was mounted and in no table. `init.ts` alone builds fourteen routers at
 * eleven different prefixes, which a file-keyed map cannot express at all.
 *
 * Route families whose paths come from data rather than from source — a
 * collection's CRUD, a project's custom functions — are one row each, marked as
 * such. Enumerating them would mean enumerating somebody's collections.
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");
const PAGE = "website/src/content/docs/docs/backend/endpoints.md";
const QUERY_PARSER = "packages/server/src/api/rest/query-parser.ts";

/**
 * Every page that could declare a data-API query parameter, all six locales.
 *
 * A stale translation of a parameter table is the same lie in another language,
 * and the table this half of the guard exists for lived in five of them.
 */
const PARAM_DOC_GLOBS = [
    "website/src/content/docs/docs/**/*.md",
    "website/src/content/docs/docs/**/*.mdx",
    "website/src/content/docs/de/docs/**/*.md",
    "website/src/content/docs/es/docs/**/*.md",
    "website/src/content/docs/fr/docs/**/*.md",
    "website/src/content/docs/it/docs/**/*.md",
    "website/src/content/docs/pt/docs/**/*.md",
    "tooling/rebase-agent-skills/**/*.md"
];

/**
 * A table row that *declares* a query parameter: the first cell is a backticked
 * identifier and a later cell writes `?<that same identifier>=`.
 *
 * Narrow on purpose. `GET /api/data/products?price=gt.100` is a **column**
 * filter and correct — the parser falls through to a field filter for any key it
 * does not reserve (`query-parser.ts`), so the operator tables in `backend/api.md`
 * (`| `gt` | Greater than | `?price=gt.100` |`) must not be flagged. What is
 * never correct is a row saying "the parameter is called `filter`" when the
 * parser reserves no such key: `?filter=` was read as a filter on a column named
 * `filter`, matched nothing, and returned 200.
 */
const PARAM_ROW = /^\|\s*`([A-Za-z_$][\w$]*)`\s*\|/;

const GREEN = "[0;32m";
const RED = "[0;31m";
const DIM = "[2m";
const NC = "[0m";

/**
 * Where each `new Hono()` receiver is mounted, with `basePath` at `/api`.
 *
 * Keyed `<file>#<receiver>`: `init.ts` builds fourteen routers at eleven
 * prefixes and `boot.ts` two at the root, so a file-keyed map cannot say where
 * any of them live. A module whose only router is a plain `const router = new
 * Hono()` still reads as one line.
 *
 * A `null` prefix means the receiver mounts nothing this index should carry —
 * a factory, a proxy, a stub whose only route is a catch-all error, or a family
 * whose paths come from a project's own data.
 */
const MOUNTS = new Map([
    ["packages/server/src/auth/routes.ts#router", "/api/auth"],
    ["packages/server/src/auth/api-keys/api-key-routes.ts#router", "/api/admin/api-keys"],
    ["packages/server/src/auth/jwks-routes.ts#router", "/.well-known"],
    ["packages/server/src/storage/routes.ts#router", "/api/storage"],
    ["packages/server/src/history/history-routes.ts#router", "/api/data"],
    ["packages/server/src/cron/cron-routes.ts#router", "/api/admin/cron"],
    ["packages/server/src/backup/backup-routes.ts#router", "/api/admin/backups"],
    ["packages/server/src/api/schema-editor-routes.ts#router", "/api/admin/schema-editor"],
    ["packages/server/src/api/live-schema-routes.ts#router", "/api/admin/schema"],
    ["packages/server/src/api/logs-routes.ts#app", "/api/admin/logs"],
    ["packages/server/src/api/contract-routes.ts#router", "/api/meta"],
    // These four build no router of their own: `createAuthRoutes` passes them
    // its own, so they register on the caller's `router` and share its prefix.
    ["packages/server/src/auth/mfa-routes.ts#router", "/api/auth"],
    ["packages/server/src/auth/session-routes.ts#router", "/api/auth"],
    ["packages/server/src/auth/magic-link-routes.ts#router", "/api/auth"],
    ["packages/server/src/auth/otp-routes.ts#router", "/api/auth"],
    // The built-in adapter's admin half, mounted by `createAdminRoutes`.
    ["packages/server/src/auth/admin-users-route.ts#router", "/api/admin"],
    ["packages/server/src/auth/admin-roles-route.ts#router", "/api/admin"],
    // Named for what it does rather than for being a router. The old glob was
    // `**/*route*.ts`, so this file — which mounts a real admin route — was
    // invisible to the completeness rule that was supposed to catch it.
    ["packages/server/src/auth/reset-password-admin.ts#router", "/api/admin"],

    // ── The root app ──────────────────────────────────────────────────────
    // `boot.ts` builds the runtime's own Hono app twice: once for a backend
    // bundle and once for a static-app bundle. Both mount `/livez` and
    // `/health` at the root, outside `basePath`, because that is where an
    // orchestrator probes. `RUNTIME_LIVENESS_PATH` is `/livez`, and five deploy
    // guides tell operators to use it.
    ["packages/server/src/boot/boot.ts#app", ""],
    ["packages/server/src/metrics/index.ts#router", "/metrics"],

    // ── init.ts, one line per router ──────────────────────────────────────
    ["packages/server/src/init.ts#schemaEditorRouter", "/api/admin/schema-editor"],
    ["packages/server/src/init.ts#liveSchemaRouter", "/api/admin/schema"],
    ["packages/server/src/init.ts#storageRouter", "/api/storage"],
    ["packages/server/src/init.ts#dataRouter", "/api/data"],
    ["packages/server/src/init.ts#functionsRouter", "/api/functions"],
    ["packages/server/src/init.ts#cronRouter", "/api/admin/cron"],
    ["packages/server/src/init.ts#backupRouter", "/api/admin/backups"],
    ["packages/server/src/init.ts#rlsAuditRouter", "/api/admin/rls-audit"],
    ["packages/server/src/init.ts#devMailRouter", "/api/admin/dev/emails"],
    ["packages/server/src/init.ts#logsRouter", "/api/admin/logs"],
    ["packages/server/src/init.ts#contractRouter", "/api/meta"],
    // Stubs: one `all("/*")` that answers with the reason the surface is off.
    // A 501 explaining itself is not an endpoint anyone looks up.
    ["packages/server/src/init.ts#unconfigured", null],
    ["packages/server/src/init.ts#storageStub", null],
    ["packages/server/src/init.ts#emptyDataStub", null],

    // ── Families and machinery ────────────────────────────────────────────
    // Every route's path is a collection slug or a function name, so it comes
    // from a project's data rather than from this source. The index carries one
    // row for each family instead; enumerating them would mean enumerating
    // somebody's collections.
    ["packages/server/src/functions/function-routes.ts#router", null],
    ["packages/server/src/api/rest/api-generator.ts#this.router", null],
    // The router a *project's* own `defineFunction` returns, and the proxy that
    // forwards to a functions process. Neither has a path of its own.
    ["packages/server/src/functions/define-function.ts#app", null],
    ["packages/server/src/functions/proxy.ts#router", null],
    // `mountWithLegacyAlias`'s forwarder, and the adapter's optional extra
    // router: both re-serve routes that are already counted where they are
    // defined.
    ["packages/server/src/api/mount.ts#alias", null],
    ["packages/server/src/auth/builtin-auth-adapter.ts#router", null]
]);

/**
 * A `new Hono()` and the name it is assigned to.
 *
 * `const router = new Hono<HonoEnv>()`, `this.router = new Hono()`. An
 * unassigned `new Hono()` — `root-error-handler.ts` builds one only to read its
 * default error handler off it — has no receiver and registers nothing.
 */
const ROUTER = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new Hono|(this\.[A-Za-z_$][\w$]*)\s*=\s*new Hono/g;

/**
 * A route registration: `router.get("/path", …)`.
 *
 * The receiver is captured and filtered, because Hono's *context* has a `get`
 * with the same shape — `c.get("user")` reads a context variable and is not a
 * route. Left in, it produced twenty phantom endpoints with names like
 * `/api/authuser`, which is the sort of finding that gets a gate ignored.
 */
const METHOD = /\b((?:this\.)?[A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)["'`]/g;

/** Receivers that are a Hono context, not a router. */
const NOT_A_ROUTER = new Set(["c", "ctx", "context"]);

export function checkEndpointIndex(root = DEFAULT_ROOT) {
    const findings = [];

    // ── the map covers every router in the server ─────────────────────────
    // Every `.ts`, not `**/*route*.ts`: the old glob was a filename test, and
    // `boot.ts`, `metrics/index.ts` and `api-generator.ts` are routers that are
    // not called one.
    const modules = globSync("packages/server/src/**/*.ts", { cwd: root })
        .filter(f => !/\.test\.ts$|(^|\/)test\//.test(f))
        .sort();
    /** @type {Map<string, string[]>} receivers declared per file */
    const receivers = new Map();
    for (const file of modules) {
        const source = readFileSync(path.join(root, file), "utf8");
        if (!source.includes("new Hono")) continue;
        const names = [...new Set(
            [...source.matchAll(ROUTER)].map(m => m[1] || m[2])
        )];
        if (names.length === 0) continue;   // an unassigned `new Hono()`
        receivers.set(file, names);
        for (const name of names) {
            if (MOUNTS.has(`${file}#${name}`)) continue;
            findings.push({
                kind: "unmapped",
                message:
                    `${file} builds a router \`${name}\` and MOUNTS does not say where it is ` +
                    "mounted — add `" + `${file}#${name}` + "` (or `null` if it mounts nothing), " +
                    "so the index cannot miss a surface."
            });
        }
    }

    // ── the routes each mapped receiver registers ─────────────────────────
    /** @type {Set<string>} */
    const routes = new Set();
    for (const [key, prefix] of MOUNTS) {
        const [file, receiver] = key.split("#");
        let source;
        try {
            source = readFileSync(path.join(root, file), "utf8");
        } catch {
            findings.push({
                kind: "gone",
                message: `MOUNTS names ${file}, which does not exist — delete the entry or fix the path.`
            });
            continue;
        }
        // A receiver is either built here or handed in: `createAuthRoutes`
        // passes its own router to `mfa-routes.ts` and friends, which register
        // on it and return nothing. Both are real; a name that is neither is a
        // stale entry.
        const built = (receivers.get(file) || []).includes(receiver);
        const escaped = receiver.replace(/\./g, "\\.");
        const registersOn = new RegExp(
            `\\b${escaped}\\.(get|post|put|patch|delete|all|use|route)\\(`
        ).test(source);
        if (!built && !registersOn) {
            findings.push({
                kind: "gone",
                message:
                    `MOUNTS names ${key}, and ${file} neither builds a router by that name nor ` +
                    "registers anything on one — delete the entry or fix the receiver."
            });
            continue;
        }
        if (prefix === null) continue;
        for (const m of source.matchAll(METHOD)) {
            if (NOT_A_ROUTER.has(m[1])) continue;
            if (m[1] !== receiver) continue;
            // An interpolated segment is a family — the OAuth provider routes
            // are registered in a loop over the configured providers — so it
            // becomes a parameter, which is how the index writes it.
            const sub = m[3].replace(/\$\{[^}]*\}/g, ":provider");
            // `all("/*")` is a fallback, not an endpoint: every admin surface
            // that can be switched off mounts one so a disabled feature answers
            // 501 with its reason instead of a 404 that reads as a broken
            // deploy. There is nothing for a reader to look up.
            if (m[2] === "all" && sub === "/*") continue;
            routes.add((prefix + (sub === "/" ? "" : sub)) || "/");
        }
    }

    if (routes.size === 0) {
        throw new Error("Extracted no routes at all — the guard is checking nothing.");
    }

    // ── every one of them is in the table ─────────────────────────────────
    const page = readFileSync(path.join(root, PAGE), "utf8");
    // A path in a table cell, as `/api/...` inside backticks.
    const documented = new Set(
        [...page.matchAll(/`(\/[A-Za-z0-9_\-./:*{}]*)`/g)].map(m => m[1])
    );

    for (const route of [...routes].sort()) {
        if (documented.has(route)) continue;
        findings.push({ kind: "missing", message: `${route} is mounted and not in the index` });
    }

    // ── every declared query parameter is one the parser reserves ─────────
    const parser = readFileSync(path.join(root, QUERY_PARSER), "utf8");
    const reservedLine = parser.match(/const reservedQueryKeys = \[([^\]]*)\]/);
    if (!reservedLine) {
        throw new Error(`Could not read reservedQueryKeys out of ${QUERY_PARSER} — the guard is checking nothing.`);
    }
    const reserved = new Set([...reservedLine[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
    if (reserved.size === 0) {
        throw new Error(`reservedQueryKeys parsed empty in ${QUERY_PARSER} — the guard is checking nothing.`);
    }

    let paramRows = 0;
    const paramFiles = [...new Set(PARAM_DOC_GLOBS.flatMap(g => globSync(g, { cwd: root })))].sort();
    for (const file of paramFiles) {
        if (/CHANGELOG\.md$/.test(file)) continue;
        const lines = readFileSync(path.join(root, file), "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            const row = lines[i].match(PARAM_ROW);
            if (!row) continue;
            const name = row[1];
            if (!lines[i].includes(`?${name}=`)) continue;
            paramRows += 1;
            if (reserved.has(name)) continue;
            findings.push({
                kind: "param",
                message:
                    `${file}:${i + 1} declares a query parameter \`${name}\`, which ` +
                    `reservedQueryKeys does not contain. The parser reads an unreserved key as a ` +
                    `filter on the column of that name, so \`?${name}=\` returns 200 and matches ` +
                    "nothing. Reserved: " + [...reserved].join(", ") + "."
            });
        }
    }

    return { findings, routes: routes.size, modules: receivers.size, paramRows, reserved: reserved.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let result;
    try {
        result = checkEndpointIndex();
    } catch (error) {
        console.error(`${RED}✗ ${error.message}${NC}`);
        process.exit(2);
    }
    if (!result.findings.length) {
        console.log(
            `${GREEN}\u2713 All ${result.routes} mounted route(s) are in the endpoint index, and all ` +
            `${result.paramRows} declared query parameter(s) are among the ${result.reserved} the parser reserves.${NC}`
        );
        process.exit(0);
    }
    console.error(`${RED}✗ ${result.findings.length} finding(s):${NC}`);
    for (const f of result.findings) console.error(`  ${RED}${f.kind}${NC} ${DIM}${f.message}${NC}`);
    process.exit(1);
}
