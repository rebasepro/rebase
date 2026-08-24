#!/usr/bin/env node
/**
 * Migrate relation declarations to the tagged union.
 *
 *   { cardinality: "one",  direction: "owning",  localKey }           → { kind: "belongsTo" }
 *   { cardinality: "one",  direction: "inverse", foreignKeyOnTarget } → { kind: "hasOne" }
 *   { cardinality: "many", direction: "inverse", foreignKeyOnTarget } → { kind: "hasMany" }
 *   { cardinality: "many", direction: "owning" | through }            → { kind: "manyToMany" }
 *   { joinPath }                                                     → { kind: "via" }
 *
 * and lifts an inline relation on a property into a nested `relation: { … }`.
 *
 * The old shape's whole problem was that it inferred which link you meant. This
 * script will not repeat that: where the fields do not determine a kind it
 * writes a `TODO(relations)` marker and leaves the code alone, so an ambiguous
 * declaration surfaces as a compile error rather than a confident guess.
 *
 *   node tooling/scripts/codemod/relations-tagged-union.mjs <path…> [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const DRY = process.argv.includes("--dry");
const roots = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** Fields that belonged to the old open shape. */
const OLD_KEYS = ["cardinality", "direction", "inverseRelationName", "localKey", "foreignKeyOnTarget", "through", "joinPath"];

/** Walk a `{ … }` from the index of its opening brace, respecting nesting and strings. */
function matchBrace(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            i++;
            while (i < src.length && src[i] !== quote) {
                if (src[i] === "\\") i++;
                i++;
            }
            continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Read a top-level `key: value` out of an object literal body. */
function readField(body, key) {
    const re = new RegExp(`(^|[\\s{,])${key}\\s*:`, "m");
    const m = re.exec(body);
    if (!m) return undefined;
    let i = m.index + m[0].length;
    while (i < body.length && /\s/.test(body[i])) i++;

    if (body[i] === "{") {
        const end = matchBrace(body, i);
        return { raw: body.slice(i, end + 1), start: m.index + (m[1] ? 1 : 0), end: end + 1 };
    }
    let depth = 0;
    const start = i;
    for (; i < body.length; i++) {
        const c = body[i];
        if (c === "[" || c === "(") depth++;
        else if (c === "]" || c === ")") depth--;
        else if (c === "," && depth === 0) break;
        else if (c === "}" && depth === 0) break;
    }
    return { raw: body.slice(start, i).trim(), start: m.index + (m[1] ? 1 : 0), end: i };
}

function literal(raw) {
    if (raw === undefined) return undefined;
    const m = /^["'`](.*)["'`]$/.exec(raw.trim());
    return m ? m[1] : undefined;
}

/**
 * Decide the kind. Returns null when the fields do not determine one — the
 * caller then leaves a marker instead of guessing.
 */
function decideKind({ cardinality, direction, hasThrough, hasJoinPath, hasLocalKey, hasFkOnTarget }) {
    if (hasJoinPath) return "via";
    if (hasThrough) return "manyToMany";

    if (cardinality === "many") {
        // `many` + owning meant "junction, table name derived".
        if (direction === "owning") return "manyToMany";
        if (direction === "inverse" || direction === undefined) {
            // inverse many is one-to-many *unless* it was the far side of a
            // junction, which the old shape expressed with inverseRelationName
            // and no foreign key — genuinely ambiguous, so say so.
            return hasFkOnTarget ? "hasMany" : null;
        }
        return null;
    }

    if (cardinality === "one") {
        if (direction === "inverse") return hasFkOnTarget ? "hasOne" : null;
        // one + owning (or unspecified) is a foreign key on this table.
        return "belongsTo";
    }

    return null;
}

function migrateObject(src, openBrace) {
    const close = matchBrace(src, openBrace);
    if (close < 0) return null;
    const body = src.slice(openBrace + 1, close);

    const cardinality = literal(readField(body, "cardinality")?.raw);
    const direction = literal(readField(body, "direction")?.raw);
    const through = readField(body, "through");
    const joinPath = readField(body, "joinPath");
    const localKey = readField(body, "localKey");
    const fkOnTarget = readField(body, "foreignKeyOnTarget");

    // A relation literal always names its target. Without one this is some
    // other object that merely happens to contain a `through:` or a
    // `cardinality:` — a middleware config, a chart spec — and rewriting it
    // injects a stray property into unrelated code.
    if (!/\btarget\s*:/.test(body)) return null;
    if (!cardinality && !through && !joinPath) return null; // not a relation literal

    const kind = decideKind({
        cardinality,
        direction,
        hasThrough: Boolean(through),
        hasJoinPath: Boolean(joinPath),
        hasLocalKey: Boolean(localKey),
        hasFkOnTarget: Boolean(fkOnTarget)
    });

    // Drop the fields the kind subsumes; `via` keeps its cardinality.
    const drop = new Set(["cardinality", "direction", "inverseRelationName"]);
    if (kind === "via") drop.delete("cardinality");

    let out = body;
    for (const key of OLD_KEYS) {
        if (!drop.has(key)) continue;
        const f = readField(out, key);
        if (!f) continue;
        let end = f.end;
        while (end < out.length && /[\s,]/.test(out[end])) end++;
        out = out.slice(0, f.start) + out.slice(end);
    }

    const indentMatch = /\n(\s+)\S/.exec(body);
    const indent = indentMatch ? indentMatch[1] : "    ";

    const kindLine = kind
        ? `kind: "${kind}",`
        : `// TODO(relations): ambiguous under the tagged union — declare the kind explicitly.\n${indent}// Was: cardinality=${cardinality ?? "?"} direction=${direction ?? "?"}\n${indent}kind: "AMBIGUOUS",`;

    // A relation *property* keeps its presentation fields and nests the link
    // under `relation:`. A bare entry in `relations` is already the link.
    const isProperty = /\btype\s*:\s*["'`]relation["'`]/.test(body);
    if (!isProperty) {
        return {
            close,
            replacement: `{\n${indent}${kindLine}` + out.replace(/^\s*\n/, "\n") + "}",
            ambiguous: !kind
        };
    }

    // Lift the link's own fields out of the property.
    const RELATION_KEYS = ["target", "relationName", "localKey", "foreignKeyOnTarget", "through", "joinPath", "onUpdate", "onDelete", "overrides"];
    if (kind === "via") RELATION_KEYS.push("cardinality");

    const lifted = [];
    let rest = out;
    for (const key of RELATION_KEYS) {
        const f = readField(rest, key);
        if (!f) continue;
        lifted.push(`${key}: ${f.raw.trim()}`);
        let end = f.end;
        while (end < rest.length && /[\s,]/.test(rest[end])) end++;
        rest = rest.slice(0, f.start) + rest.slice(end);
    }

    const inner = indent + "    ";
    const nested = [kindLine, ...lifted.map((l) => `${l},`)]
        .map((l) => inner + l)
        .join("\n");

    const restBody = rest.replace(/^\s*\n/, "").replace(/[\s,]*$/, "");
    return {
        close,
        replacement: `{\n${restBody ? restBody + ",\n" : ""}${indent}relation: {\n${nested}\n${indent}}\n${indent.slice(0, -4)}}`,
        ambiguous: !kind
    };
}

function migrateFile(file) {
    const original = readFileSync(file, "utf8");
    let src = original;
    let changed = 0;
    let ambiguous = 0;

    // Every object literal that mentions a relation-only field, right to left so
    // indices stay valid.
    const anchors = [];
    const re = /\b(cardinality|through|joinPath)\s*:/g;
    let m;
    while ((m = re.exec(src))) anchors.push(m.index);

    for (const anchor of anchors.reverse()) {
        // Walk back to the enclosing `{`.
        let depth = 0;
        let open = -1;
        for (let i = anchor; i >= 0; i--) {
            if (src[i] === "}") depth++;
            else if (src[i] === "{") {
                if (depth === 0) { open = i; break; }
                depth--;
            }
        }
        if (open < 0) continue;
        if (/\bkind\s*:/.test(src.slice(open, matchBrace(src, open) + 1))) continue; // already migrated

        const res = migrateObject(src, open);
        if (!res) continue;
        src = src.slice(0, open) + res.replacement + src.slice(res.close + 1);
        changed++;
        if (res.ambiguous) ambiguous++;
    }

    if (src !== original && !DRY) writeFileSync(file, src);
    return { changed, ambiguous };
}

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) yield* walk(full);
        else if ([".ts", ".tsx"].includes(extname(full))) yield full;
    }
}

let files = 0;
let total = 0;
let ambiguousTotal = 0;
for (const root of roots) {
    const targets = statSync(root).isDirectory() ? [...walk(root)] : [root];
    for (const file of targets) {
        const { changed, ambiguous } = migrateFile(file);
        if (changed) {
            files++;
            total += changed;
            ambiguousTotal += ambiguous;
            console.log(`${changed.toString().padStart(3)} ${ambiguous ? `(${ambiguous} ambiguous) ` : ""}${file}`);
        }
    }
}
console.log(`\n${total} relation(s) across ${files} file(s)${DRY ? " (dry run)" : ""}.`);
if (ambiguousTotal) {
    console.log(`${ambiguousTotal} could not be determined and are marked kind: "AMBIGUOUS" — these will not compile until resolved by hand.`);
}
