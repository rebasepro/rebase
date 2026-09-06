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
 *   1. {@link MOUNTS} maps a router module to the prefix `init.ts` mounts it
 *      at. It is hand-written — the mounts are conditional on `surfaces` and
 *      spread across three thousand lines — but it is *checked*: a
 *      `*route*.ts` module under `packages/server/src` that this map does not
 *      mention is a finding, so a new router cannot be added in silence.
 *   2. Inside each module, every `x.get("/path", …)` and friend is a route.
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
 * Where `init.ts` mounts each router, with `basePath` at its default `/api`.
 *
 * A `null` prefix means the module registers no routes of its own — it is a
 * factory, a middleware or a proxy — and is deliberately not in the index.
 */
const MOUNTS = new Map([
    ["packages/server/src/auth/routes.ts", "/api/auth"],
    ["packages/server/src/auth/api-keys/api-key-routes.ts", "/api/admin/api-keys"],
    ["packages/server/src/auth/jwks-routes.ts", "/.well-known"],
    ["packages/server/src/storage/routes.ts", "/api/storage"],
    ["packages/server/src/history/history-routes.ts", "/api/data"],
    ["packages/server/src/cron/cron-routes.ts", "/api/admin/cron"],
    ["packages/server/src/backup/backup-routes.ts", "/api/admin/backups"],
    ["packages/server/src/api/schema-editor-routes.ts", "/api/admin/schema-editor"],
    ["packages/server/src/api/live-schema-routes.ts", "/api/admin/schema"],
    ["packages/server/src/api/logs-routes.ts", "/api/admin/logs"],
    ["packages/server/src/api/contract-routes.ts", "/api/meta"],
    // Mounted into the auth router by `createAuthRoutes`, so they share its
    // prefix rather than getting one of their own.
    ["packages/server/src/auth/mfa-routes.ts", "/api/auth"],
    ["packages/server/src/auth/session-routes.ts", "/api/auth"],
    ["packages/server/src/auth/magic-link-routes.ts", "/api/auth"],
    ["packages/server/src/auth/otp-routes.ts", "/api/auth"],
    // The built-in adapter's admin half, mounted by `createAdminRoutes`.
    ["packages/server/src/auth/admin-users-route.ts", "/api/admin"],
    ["packages/server/src/auth/admin-roles-route.ts", "/api/admin"],
    // Named for what it does rather than for being a router, so the glob above
    // does not reach it — but it mounts a real route and belongs in the index.
    ["packages/server/src/auth/reset-password-admin.ts", "/api/admin"],
    // Routes a realtime *message* to a service; nothing HTTP.
    ["packages/server/src/services/routed-realtime-service.ts", null],
    // Every route's path is a collection slug or a function name, so it comes
    // from a project's data rather than from this source. The index carries one
    // row for each family instead; enumerating them would mean enumerating
    // somebody's collections.
    ["packages/server/src/functions/function-routes.ts", null]
]);

/**
 * A route registration: `router.get("/path", …)`.
 *
 * The receiver is captured and filtered, because Hono's *context* has a `get`
 * with the same shape — `c.get("user")` reads a context variable and is not a
 * route. Left in, it produced twenty phantom endpoints with names like
 * `/api/authuser`, which is the sort of finding that gets a gate ignored.
 */
const METHOD = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)["'`]/g;

/** Receivers that are a Hono context, not a router. */
const NOT_A_ROUTER = new Set(["c", "ctx", "context"]);

export function checkEndpointIndex(root = DEFAULT_ROOT) {
    const findings = [];

    // ── the map covers every router module ────────────────────────────────
    const modules = globSync("packages/server/src/**/*route*.ts", { cwd: root })
        .filter(f => !/\.test\.ts$|(^|\/)test\//.test(f))
        .sort();
    for (const file of modules) {
        if (!MOUNTS.has(file)) {
            findings.push({
                kind: "unmapped",
                message:
                    `${file} registers routes and MOUNTS does not say where they are mounted — ` +
                    "add it (or `null` if it mounts nothing), so the index cannot miss a surface."
            });
        }
    }

    // ── the routes each mapped module registers ───────────────────────────
    /** @type {Set<string>} */
    const routes = new Set();
    for (const [file, prefix] of MOUNTS) {
        if (prefix === null) continue;
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
        for (const m of source.matchAll(METHOD)) {
            if (NOT_A_ROUTER.has(m[1])) continue;
            // An interpolated segment is a family — the OAuth provider routes
            // are registered in a loop over the configured providers — so it
            // becomes a parameter, which is how the index writes it.
            const sub = m[3].replace(/\$\{[^}]*\}/g, ":provider");
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

    return { findings, routes: routes.size, modules: modules.length, paramRows, reserved: reserved.size };
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
