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
 * What counts as a code, and why these shapes:
 *
 *   1. `new ApiError(<status>, "CODE", …)` — the explicit constructor. The
 *      status may be an expression rather than a literal; what matters is the
 *      second argument.
 *   2. `ApiError.badRequest(msg, "CODE")` and the other factories — the second
 *      argument, defaulted, which is where most codes are written.
 *   3. A **local wrapper** that forwards its own parameter into the
 *      constructor. `query-parser.ts` has one — `invalidParam(message, code)` —
 *      and every code raised through it (`INVALID_PAGE`, `INVALID_OFFSET`,
 *      `INVALID_LOGICAL_GROUP`, `INVALID_ORDER_BY`, `INVALID_WHERE`, the four
 *      aggregate and vector ones) was invisible to this gate, which then
 *      reported a clean sweep over a page missing all of them.
 *   4. The keys of `codeToStatus` in `api/errors.ts` — the map that turns a
 *      code into a status when an error arrives without one.
 *   5. `code: "CODE"` in a hand-built envelope. Several routes answer without
 *      going through `ApiError` at all (`STORAGE_NOT_CONFIGURED`,
 *      `NO_COLLECTIONS`, `RATE_LIMITED`), and a reader cannot tell from the
 *      response which route built it.
 *   6. A **template literal** code — `` `PG_${code}` `` in `PersistService` —
 *      is a whole family rather than one string. The family is recorded, and
 *      the page has to declare it with rows for the SQLSTATEs that actually
 *      reach it (see {@link REQUIRED_FAMILY_ROWS}).
 *
 * ## Why the argument scan is balanced rather than regexed
 *
 * The factory scan used to be `ApiError\.badRequest\(([\s\S]{0,400}?)\)` — non
 * greedy, so it stopped at the first `)` *inside the message*. Any parenthesis
 * in the message expression — `join(", ")`, a `map(…)`, a nested call — hid the
 * code argument that came after it. `UNKNOWN_FILTER_FIELD` is raised with the
 * list of valid fields joined into the message, and it was one of seventeen
 * codes the server emits and the page did not name, while the gate printed
 * "✓ Every code the server can raise is documented".
 *
 * Comment lines are stripped first: a JSDoc paragraph explaining that Jest's
 * `ModuleNotFoundError` carries `code: "MODULE_NOT_FOUND"` is prose, not a
 * response this server sends.
 */
import fs from "node:fs";
import path from "node:path";

/** The page that has to list them. */
const REFERENCE = "website/src/content/docs/docs/backend/errors.md";

/**
 * Where a code can be raised.
 *
 * `packages/common/src` is here because it owns `CALLBACK_REJECTED` — the code
 * a throwing `beforeSave` answers with, which is one of the first errors a
 * developer writing a callback will meet — and the shared codec's rejections
 * (`UNKNOWN_FILTER_OPERATOR` and friends), which the HTTP boundary re-throws
 * verbatim.
 */
const SOURCE_DIRS = [
    "packages/server/src",
    "packages/server-postgres/src",
    "packages/common/src"
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

/**
 * The rows a template-literal family owes the reference page.
 *
 * `PG_<SQLSTATE>` cannot be enumerated — Postgres has hundreds — so the rule is
 * that the page declares the family in prose and carries a row for each
 * SQLSTATE a caller actually meets: a duplicate key, a foreign key that points
 * at nothing, a NOT NULL violation, and a value the column's type cannot hold.
 */
const REQUIRED_FAMILY_ROWS = new Map([
    ["PG_", ["PG_23505", "PG_23503", "PG_23502", "PG_22P02"]]
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

/**
 * The arguments of the call whose `(` sits at `open`, split at the top level.
 *
 * Depth-counted over `()`, `[]` and `{}`, skipping string and template bodies
 * so a `")"` or a `` `a ${f(1)} b` `` inside one cannot close the call. Returns
 * `null` for an unbalanced call, which only happens on a truncated file.
 */
function callArguments(source, open) {
    const args = [];
    let depth = 0;
    let start = open + 1;
    let i = open;
    while (i < source.length) {
        const ch = source[i];
        if (ch === "\"" || ch === "'") {
            const quote = ch;
            i++;
            while (i < source.length && source[i] !== quote) {
                if (source[i] === "\\") i++;
                i++;
            }
        } else if (ch === "`") {
            // Template literals nest: `${ f(`x`) }`. Counted rather than
            // scanned to the next backtick.
            i++;
            let braces = 0;
            while (i < source.length) {
                if (source[i] === "\\") { i += 2; continue; }
                if (braces === 0 && source[i] === "`") break;
                if (source[i] === "$" && source[i + 1] === "{") { braces++; i += 2; continue; }
                if (braces > 0 && source[i] === "}") braces--;
                i++;
            }
        } else if (ch === "(" || ch === "[" || ch === "{") {
            depth++;
        } else if (ch === ")" || ch === "]" || ch === "}") {
            depth--;
            if (depth === 0) {
                args.push(source.slice(start, i).trim());
                return args.length === 1 && args[0] === "" ? [] : args;
            }
        } else if (ch === "," && depth === 1) {
            args.push(source.slice(start, i).trim());
            start = i + 1;
        }
        i++;
    }
    return null;
}

/** Every occurrence of `pattern` with the arguments of the call it opens. */
function* calls(source, pattern) {
    for (const m of source.matchAll(pattern)) {
        const open = source.indexOf("(", m.index + m[0].length - 1);
        if (open < 0) continue;
        const args = callArguments(source, open);
        if (args) yield { match: m, args };
    }
}

/**
 * Module constants that hold a code.
 *
 * `packages/common` exports `const CALLBACK_REJECTED = "CALLBACK_REJECTED"` and
 * every raise site writes the *identifier*, so a scan for string literals saw
 * none of them — and `CALLBACK_REJECTED` is the first error anyone writing a
 * `beforeSave` will meet.
 */
function codeConstants(source) {
    const constants = new Map();
    const re = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]+)?=\\s*["'](${CODE})["']`, "g");
    for (const m of source.matchAll(re)) constants.set(m[1], m[2]);
    return constants;
}

/** The code an argument expression names: a literal, a constant, or a family. */
function codeFromArgument(arg, constants = new Map()) {
    if (!arg) return null;
    const literal = arg.match(new RegExp(`^["'](${CODE})["']$`));
    if (literal) return { code: literal[1] };
    // `` `PG_${code}` `` — a family, not a string.
    const template = arg.match(/^`([A-Z][A-Z0-9_]*)\$\{/);
    if (template) return { family: template[1] };
    const named = constants.get(arg);
    if (named) return { code: named };
    return null;
}

/**
 * Wrappers in this file that forward one of their parameters into a code.
 *
 * Resolved to a fixed point, because they nest: `query-parser.ts` has
 * `invalidParam(message, code)` over the constructor, and `parseWindowParam(raw,
 * name, minimum, code)` over *that* — which is how `INVALID_PAGE` and
 * `INVALID_OFFSET` came to be two hops from anything a scan could see.
 *
 * The window is deliberately short: a wrapper is a wrapper because it is three
 * lines long. A function that constructs an `ApiError` from one of its own
 * parameters several hundred characters into its body is doing something else,
 * and guessing at it would put codes in the inventory that no call site names.
 */
function findWrappers(source) {
    const declaration =
        /(?:export\s+)?(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\()/g;

    const declarations = [];
    for (const m of source.matchAll(declaration)) {
        const name = m[1] || m[2];
        const open = source.indexOf("(", m.index + m[0].length - 1);
        if (open < 0) continue;
        const params = (callArguments(source, open) ?? [])
            .map(p => p.replace(/[?:=].*$/s, "").trim())
            .filter(p => /^[A-Za-z_$][\w$]*$/.test(p));
        if (params.length === 0) continue;
        declarations.push({ name, params, body: source.slice(open, open + 800) });
    }

    /** @type {Map<string, { index: number, status?: number }>} */
    const wrappers = new Map();
    for (let pass = 0; pass < 5; pass++) {
        let grew = false;
        for (const { name, params, body } of declarations) {
            if (wrappers.has(name)) continue;

            const forwards = [
                ...[...calls(body, /new ApiError\s*\(/g)]
                    .map(({ args }) => ({
                        arg: args[1],
                        status: /^\d{3}$/.test(args[0] ?? "") ? Number(args[0]) : undefined
                    })),
                ...[...wrappers].flatMap(([known, spec]) =>
                    [...calls(body, new RegExp(`\\b${known}\\s*\\(`, "g"))]
                        .map(({ args }) => ({ arg: args[spec.index], status: spec.status })))
            ];

            for (const { arg, status } of forwards) {
                const index = params.indexOf(arg ?? "");
                if (index < 0) continue;
                wrappers.set(name, { index, status });
                grew = true;
                break;
            }
        }
        if (!grew) break;
    }
    return [...wrappers].map(([name, spec]) => ({ name, ...spec }));
}

/** Collect every code one source file can put in a response. */
export function collectFromSource(source, rel, record) {
    const stripped = stripComments(source);
    const constants = codeConstants(stripped);

    for (const { args } of calls(stripped, /new ApiError\s*\(/g)) {
        const found = codeFromArgument(args[1], constants);
        if (!found) continue;
        const status = /^\d{3}$/.test(args[0] ?? "") ? Number(args[0]) : undefined;
        record(found, status, rel);
    }

    for (const [factory, status] of Object.entries(FACTORY_STATUS)) {
        for (const { args } of calls(stripped, new RegExp(`ApiError\\.${factory}\\s*\\(`, "g"))) {
            const found = codeFromArgument(args[1], constants);
            if (found) record(found, status, rel);
        }
    }

    for (const wrapper of findWrappers(stripped)) {
        for (const { args } of calls(stripped, new RegExp(`\\b${wrapper.name}\\s*\\(`, "g"))) {
            const found = codeFromArgument(args[wrapper.index], constants);
            if (found) record(found, wrapper.status, rel);
        }
    }

    // `code:` in a hand-built envelope or a `RebaseApiError` init — as a
    // literal, or as the module constant `packages/common` writes it with.
    const codeField = new RegExp(`\\bcode:\\s*(["'](?:${CODE})["']|[A-Za-z_$][\\w$]*|\`[^\`]*\`)`, "g");
    for (const m of stripped.matchAll(codeField)) {
        const found = codeFromArgument(m[1], constants);
        if (found) record(found, undefined, rel);
    }
}

/** Every code the source can put in a response, with where it was found. */
export function collectErrorCodes(root) {
    /** @type {Map<string, { status?: number, locations: string[] }>} */
    const codes = new Map();
    /** @type {Map<string, string[]>} template-literal prefixes, e.g. `PG_`. */
    const families = new Map();

    const record = (found, status, location) => {
        if (found.family !== undefined) {
            families.set(found.family, [...(families.get(found.family) ?? []), location]);
            return;
        }
        const existing = codes.get(found.code) ?? { status: undefined, locations: [] };
        if (existing.status === undefined && status !== undefined) existing.status = status;
        existing.locations.push(location);
        codes.set(found.code, existing);
    };

    let scanned = 0;
    for (const dir of SOURCE_DIRS) {
        for (const file of walk(path.join(root, dir))) {
            scanned++;
            const rel = path.relative(root, file);
            collectFromSource(fs.readFileSync(file, "utf8"), rel, record);
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
            record({ code: m[1] }, Number(m[2]), "packages/server/src/api/errors.ts");
        }
    }

    return { codes, families, scanned };
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

/**
 * The gate checks itself before it checks the page.
 *
 * Both fixtures are shapes that were live in the source and invisible to the
 * scan: a code forwarded through a one-line wrapper, and a code that follows a
 * message expression containing a `)`. Neither failure was visible from the
 * outside — the gate reported "✓ Every code the server can raise is
 * documented" over a page missing seventeen of them — so the guard needs a
 * guard, and it runs wherever the gate runs rather than in a test suite the
 * docs pipeline does not invoke.
 */
export function selfTest() {
    const fixture = `
        export const NAMED_CONSTANT_CODE = "NAMED_CONSTANT_CODE";

        function invalidParam(message: string, code: string, details?: unknown): ApiError {
            return new ApiError(400, code, message, details, true);
        }
        function parseWindowParam(raw: unknown, name: string, minimum: number, code: string): number {
            throw invalidParam(\`Invalid \\\`\${name}\\\` parameter: got \${JSON.stringify(raw)}.\`, code);
        }
        const refuse = (message: string, code: string) => new ApiError(403, code, message);

        export function parse(q: Record<string, unknown>) {
            if (q.page) throw invalidParam("page must be a positive integer", "WRAPPED_CODE");
            if (q.offset) parseWindowParam(q.offset, "offset", 0, "TWICE_WRAPPED_CODE");
            if (q.user) throw refuse("no", "ARROW_WRAPPED_CODE");
            if (q.field) {
                throw ApiError.badRequest(\`Unknown field. Known: \${known.join(", ")}\`, "AFTER_PARENS_CODE");
            }
            throw new ApiError(status, "COMPUTED_STATUS_CODE", "x");
        }

        export function rejected(stage: string) {
            return new RebaseApiError("refused", { status: 400, code: NAMED_CONSTANT_CODE, details: { stage } });
        }

        const dbCode = (code: string) => new ApiError(409, \`PG_\${code}\`, "constraint");
    `;

    const seen = new Map();
    const seenFamilies = new Set();
    collectFromSource(fixture, "<selftest>", (found) => {
        if (found.family !== undefined) seenFamilies.add(found.family);
        else seen.set(found.code, true);
    });

    const missing = [
        "WRAPPED_CODE",
        "TWICE_WRAPPED_CODE",
        "ARROW_WRAPPED_CODE",
        "AFTER_PARENS_CODE",
        "COMPUTED_STATUS_CODE",
        "NAMED_CONSTANT_CODE"
    ].filter(code => !seen.has(code));
    if (missing.length > 0) {
        throw new Error(
            `The error-code scan cannot see ${missing.join(", ")} in its own fixture — ` +
            "it would report a clean sweep over a page missing them."
        );
    }
    if (!seenFamilies.has("PG_")) {
        throw new Error("The error-code scan cannot see a template-literal code family in its own fixture.");
    }
}

export function checkErrorCodes(root) {
    selfTest();

    const findings = [];
    const { codes, families, scanned } = collectErrorCodes(root);
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
        // A row belonging to a family the source can build is not a fiction.
        if ([...families.keys()].some(prefix => code.startsWith(prefix))) continue;
        findings.push({
            code,
            message: `${REFERENCE}:${where.line} documents it, but nothing in the server can raise it`
        });
    }
    for (const [prefix, locations] of families) {
        for (const required of REQUIRED_FAMILY_ROWS.get(prefix) ?? []) {
            if (documented.has(required)) continue;
            findings.push({
                code: required,
                message:
                    `${[...new Set(locations)][0]} builds \`${prefix}<SQLSTATE>\` codes, and ${REFERENCE} ` +
                    `has no row for ${required} — the family cannot be enumerated, so the page owes a row ` +
                    "for each SQLSTATE a caller actually meets."
            });
        }
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

    return { findings, scanned, total: codes.size, families: families.size };
}
