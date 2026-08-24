/**
 * Class 21 sweep: a declared extension point that nothing reads.
 *
 * Recipe: for every optional property declared on an exported `*Config` /
 * `*Options` interface, ask whether that property name is ever *read* anywhere
 * in the workspace outside its own declaration. A field that appears only in
 * the interface (and, at most, in docs) is a promise the code does not keep —
 * `closeOnSave` and `disableSelfRegistration` were both this shape.
 *
 * Deliberately crude: it reports candidates, not defects. The judgement call —
 * "is this read through a spread, a generic, a string key?" — stays human.
 * Its value is that it turns "which of our options are lies?" from a hunch
 * into a list of forty.
 */
import { execSync } from "child_process";
import fs from "fs";

const files = execSync(
    "git ls-files 'packages/**/src/**/*.ts' 'packages/**/src/**/*.tsx'",
    { cwd: process.cwd(), maxBuffer: 1 << 28 }
).toString().trim().split("\n").filter(Boolean);

// Every declared optional field on an exported Config/Options/Props interface.
const declared = []; // { field, iface, file, line }
const ifaceRe = /export\s+interface\s+(\w*(?:Config|Options|Props|Settings))\b[^{]*\{/g;

for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    let m;
    while ((m = ifaceRe.exec(src))) {
        const iface = m[1];
        // Walk braces to find the interface body.
        let depth = 0, i = m.index + m[0].length - 1, start = i;
        for (; i < src.length; i++) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") { depth--; if (depth === 0) break; }
        }
        const body = src.slice(start + 1, i);
        const lineOf = (off) => src.slice(0, start + 1 + off).split("\n").length;
        // Optional fields only: a required one is enforced by the compiler.
        const fieldRe = /^\s{0,8}(\w+)\?\s*:/gm;
        let f;
        while ((f = fieldRe.exec(body))) {
            declared.push({ field: f[1], iface, file, line: lineOf(f.index) });
        }
    }
}

// Index every identifier occurrence in the workspace, so "is it read?" is one
// pass rather than one grep per field.
const uses = new Map(); // field -> [{file, line, text}]
const wordRe = /\b(\w+)\b/g;
for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let n = 0; n < lines.length; n++) {
        const text = lines[n];
        let w;
        wordRe.lastIndex = 0;
        while ((w = wordRe.exec(text))) {
            const key = w[1];
            if (!uses.has(key)) uses.set(key, []);
            const arr = uses.get(key);
            if (arr.length < 400) arr.push({ file, line: n + 1, text });
        }
    }
}

const declaredAt = new Set(declared.map(d => `${d.file}:${d.line}`));
const byField = new Map();
for (const d of declared) {
    if (!byField.has(d.field)) byField.set(d.field, []);
    byField.get(d.field).push(d);
}

const suspects = [];
for (const [field, decls] of byField) {
    const all = uses.get(field) ?? [];
    // A "read" is any occurrence that is not one of this field's own
    // declaration lines, and not a doc comment mentioning it.
    const reads = all.filter(u =>
        !declaredAt.has(`${u.file}:${u.line}`) &&
        !/^\s*(\*|\/\/)/.test(u.text)
    );
    if (reads.length === 0) {
        suspects.push({ field, decls, reads: 0 });
    }
}

suspects.sort((a, b) => a.field.localeCompare(b.field));
console.log(`Optional fields declared on exported *Config/Options/Props: ${byField.size}`);
console.log(`Never read anywhere outside their own declaration: ${suspects.length}\n`);
for (const s of suspects) {
    for (const d of s.decls) {
        console.log(`  ${s.field.padEnd(32)} ${d.iface.padEnd(34)} ${d.file}:${d.line}`);
    }
}
