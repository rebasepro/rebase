/**
 * Every error code the API can return is in the error-code reference.
 *
 * The reference page promises to list them all. That promise is the kind that
 * decays quietly: a route grows a new `code`, the client sees a string that
 * appears nowhere in the documentation, and nothing anywhere fails. The
 * failure mode is a support conversation, months later, that starts with "what
 * does SCHEMA_EDITOR_BAAS_MODE mean".
 *
 * So the table is checked against the source both ways. A code the server can
 * emit and the page does not list is a gap; a code the page lists and no route
 * can emit is a fiction, which is worse — a reader writes a handler for an
 * error that will never arrive.
 *
 * What counts as a code, and why these four shapes:
 *
 *   1. `new ApiError(<status>, "CODE", …)` — the explicit constructor.
 *   2. `ApiError.badRequest(msg, "CODE")` and the other factories — the second
 *      argument, defaulted, which is where most codes are written.
 *   3. The keys of `codeToStatus` in `api/errors.ts` — the map that turns a
 *      code into a status when an error arrives without one.
 *   4. `code: "CODE"` in a hand-built envelope. Several routes answer without
 *      going through `ApiError` at all (`STORAGE_NOT_CONFIGURED`,
 *      `NO_COLLECTIONS`, `RATE_LIMITED`), and a reader cannot tell from the
 *      response which route built it.
 *
 * Comment lines are stripped first: a JSDoc paragraph explaining that Jest's
 * `ModuleNotFoundError` carries `code: "MODULE_NOT_FOUND"` is prose, not a
 * response this server sends.
 */
import fs from "node:fs";
import path from "node:path";

/** The page that has to list them. */
const REFERENCE = "website/src/content/docs/docs/backend/errors.md";

/** Where a code can be raised. */
const SOURCE_DIRS = [
    "packages/server/src",
    "packages/server-postgres/src"
];

/**
 * Codes that are deliberately not in the table, with the reason.
 *
 * Keep this empty if you can. Every entry is a code a caller can receive and
 * cannot look up.
 */
const NOT_DOCUMENTED = new Map([
    // The generic fallbacks are described in the page's prose rather than as
    // rows, because they are the shape of every other row's `status` column.
]);

const FACTORY_STATUS = {
    badRequest: 400,
    unauthorized: 401,
    unauthenticated: 401,
    forbidden: 403,
    notFound: 404,
    conflict: 409,
    internal: 500,
    serviceUnavailable: 503
};

const CODE = "[A-Z][A-Z0-9_]{2,}";

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file, out);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(file);
    }
    return out;
}

/**
 * Drop comment-only lines, and nothing else.
 *
 * Deliberately not a block-comment stripper. `app.use("/*", cors())` opens what
 * a `/\*[\s\S]*?\*\//` regex reads as a comment, and the first attempt at this
 * swallowed several hundred lines of `init.ts` — six real error codes vanished
 * from the inventory and the gate reported a clean sweep. A line-shaped rule
 * cannot do that: JSDoc bodies start with `*`, openers with `/**`, and a code
 * line starts with neither.
 */
function stripComments(source) {
    return source
        .split("\n")
        .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
}

/** Every code the source can put in a response, with where it was found. */
export function collectErrorCodes(root) {
    /** @type {Map<string, { status?: number, locations: string[] }>} */
    const codes = new Map();
    const record = (code, status, location) => {
        const existing = codes.get(code) ?? { status: undefined, locations: [] };
        if (existing.status === undefined && status !== undefined) existing.status = status;
        existing.locations.push(location);
        codes.set(code, existing);
    };

    let scanned = 0;
    for (const dir of SOURCE_DIRS) {
        for (const file of walk(path.join(root, dir))) {
            scanned++;
            const rel = path.relative(root, file);
            const source = stripComments(fs.readFileSync(file, "utf8"));

            for (const m of source.matchAll(new RegExp(`new ApiError\\(\\s*(\\d{3})\\s*,\\s*"(${CODE})"`, "g"))) {
                record(m[2], Number(m[1]), rel);
            }
            for (const [factory, status] of Object.entries(FACTORY_STATUS)) {
                const re = new RegExp(`ApiError\\.${factory}\\(([\\s\\S]{0,400}?)\\)`, "g");
                for (const m of source.matchAll(re)) {
                    const code = m[1].match(new RegExp(`"(${CODE})"`));
                    if (code) record(code[1], status, rel);
                }
            }
            for (const m of source.matchAll(new RegExp(`\\bcode:\\s*"(${CODE})"`, "g"))) {
                record(m[1], undefined, rel);
            }
        }
    }

    // The map that decides a status when the thrown error carries none. Every
    // key is a code the server treats as real, whether or not a call site was
    // matched above.
    const errorsFile = path.join(root, "packages/server/src/api/errors.ts");
    if (fs.existsSync(errorsFile)) {
        const source = fs.readFileSync(errorsFile, "utf8");
        const map = source.slice(source.indexOf("const map: Record<string, number>"));
        const block = map.slice(0, map.indexOf("};"));
        for (const m of block.matchAll(new RegExp(`(${CODE}):\\s*(\\d{3})`, "g"))) {
            record(m[1], Number(m[2]), "packages/server/src/api/errors.ts");
        }
    }

    return { codes, scanned };
}

/** The codes the reference page lists, from the first column of its tables. */
export function documentedErrorCodes(root) {
    const file = path.join(root, REFERENCE);
    if (!fs.existsSync(file)) return null;
    const documented = new Map();
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
        const row = line.match(new RegExp(`^\\|\\s*\`(${CODE})\`\\s*\\|\\s*(\\d{3})?`));
        if (row) documented.set(row[1], { status: row[2] ? Number(row[2]) : undefined, line: index + 1 });
    });
    return documented;
}

export function checkErrorCodes(root) {
    const findings = [];
    const { codes, scanned } = collectErrorCodes(root);
    const documented = documentedErrorCodes(root);

    if (documented === null) {
        return {
            findings: [{ code: "-", message: `${REFERENCE} is missing — the error-code reference is the page this stage checks.` }],
            scanned,
            total: codes.size
        };
    }

    for (const [code, info] of [...codes].sort()) {
        if (documented.has(code) || NOT_DOCUMENTED.has(code)) continue;
        findings.push({
            code,
            message: `raised in ${[...new Set(info.locations)].slice(0, 3).join(", ")} but not listed in ${REFERENCE}`
        });
    }
    for (const [code, where] of [...documented].sort()) {
        if (codes.has(code)) continue;
        findings.push({
            code,
            message: `${REFERENCE}:${where.line} documents it, but nothing in the server can raise it`
        });
    }
    for (const [code, info] of codes) {
        const row = documented.get(code);
        if (!row || row.status === undefined || info.status === undefined) continue;
        if (row.status !== info.status) {
            findings.push({
                code,
                message: `${REFERENCE} says ${row.status}, the source raises ${info.status}`
            });
        }
    }

    return { findings, scanned, total: codes.size };
}
