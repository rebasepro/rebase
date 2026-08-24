/**
 * Generate the @rebasepro/ui component reference into the Starlight docs.
 *
 * Source of truth is the design-sync output, not hand-written prose:
 *   ds-bundle/components/<group>/<Name>/<Name>.d.ts  → the props table
 *   tooling/design-sync/previews/<Name>.tsx                 → the usage example
 *
 * Both are already verified by the sync — the .d.ts is extracted from the
 * shipped types and every preview is confirmed to render in headless chromium.
 * That is the whole point: the previous hand-maintained showcase drifted into
 * an unlinked 14,000px orphan because nothing tied it to the library.
 *
 * Run: node tooling/design-sync/gen-ui-docs.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "ds-bundle/components");
const PREVIEWS = path.join(ROOT, "tooling/design-sync/previews");
const OUT = path.join(ROOT, "website/src/content/docs/docs/ui");

// DS group -> docs section. The DS's own group names are internal.
const SECTION = {
    general: "components",
    views: "data-views",
    collectionview: "collection-view",
    fields: "field-editors",
    icons: "icons",
    common: "components"
};
const SECTION_LABEL = {
    components: "Components",
    "data-views": "Data views",
    "collection-view": "Collection view",
    "field-editors": "Table field editors",
    icons: "Icons"
};

/** Pull the props interface body out of an emitted .d.ts. */
function readProps(dts, name) {
    const re = new RegExp(`export interface ${name}Props(?:<[^>]*>)?\\s*\\{([\\s\\S]*?)\\n\\}`);
    const m = dts.match(re);
    if (!m) return [];
    const rows = [];
    let doc = "";
    for (const raw of m[1].split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        const jsdoc = line.match(/^\/\*\*\s*(.*?)\s*\*\/$/);
        if (jsdoc) { doc = jsdoc[1]; continue; }
        if (line.startsWith("/*") || line.startsWith("*")) continue;
        // name?: Type;   — Type may contain ; inside generics, so take to the last ;
        const p = line.match(/^"?([A-Za-z_$][\w$-]*)"?(\?)?:\s*(.+);$/);
        if (!p) { doc = ""; continue; }
        rows.push({ name: p[1], required: !p[2], type: p[3].trim(), doc });
        doc = "";
    }
    return rows;
}

/** Names a top-level statement introduces into module scope. */
function declaredNames(stmt) {
    const out = [];
    if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) collectBindingNames(d.name, out);
    } else if (stmt.name && ts.isIdentifier(stmt.name)) {
        out.push(stmt.name.text);
    }
    return out;
}

function collectBindingNames(binding, out) {
    if (ts.isIdentifier(binding)) { out.push(binding.text); return; }
    for (const el of binding.elements ?? []) {
        if (ts.isBindingElement(el)) collectBindingNames(el.name, out);
    }
}

/** Local names an import statement binds: default, namespace and named alike. */
function importBindings(stmt) {
    const clause = stmt.importClause;
    if (!clause) return [];
    const out = [];
    if (clause.name) out.push(clause.name.text);
    const b = clause.namedBindings;
    if (b && ts.isNamespaceImport(b)) out.push(b.name.text);
    if (b && ts.isNamedImports(b)) for (const el of b.elements) out.push(el.name.text);
    return out;
}

/**
 * Identifiers a statement *reads*. Declaration and member positions are skipped
 * so `project.name` does not look like a reference to a module-level `name`,
 * and a shorthand `{ container }` still does.
 */
function referencedNames(stmt) {
    const out = new Set();
    const visit = (node) => {
        if (ts.isIdentifier(node)) {
            const p = node.parent;
            const isMember =
                (ts.isPropertyAccessExpression(p) && p.name === node) ||
                (ts.isQualifiedName(p) && p.right === node) ||
                (ts.isJsxAttribute(p) && p.name === node) ||
                (ts.isBindingElement(p) && p.propertyName === node) ||
                // A declaration's own name is not a reference — but a shorthand
                // property assignment's "name" is the value it reads.
                (!ts.isShorthandPropertyAssignment(p) && p.name === node);
            if (!isMember) out.add(node.text);
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(stmt, visit);
    return out;
}

/** Re-print an import keeping only the bindings the example actually uses. */
function printImport(stmt, used) {
    const clause = stmt.importClause;
    const spec = stmt.moduleSpecifier.text;
    const typeOnly = clause.isTypeOnly ? "type " : "";
    const head = [];
    if (clause.name && used.has(clause.name.text)) head.push(clause.name.text);
    const b = clause.namedBindings;
    if (b && ts.isNamespaceImport(b) && used.has(b.name.text)) head.push(`* as ${b.name.text}`);
    const named = b && ts.isNamedImports(b)
        ? b.elements.filter(el => used.has(el.name.text)).map(el =>
            `${el.isTypeOnly ? "type " : ""}${el.propertyName ? `${el.propertyName.text} as ` : ""}${el.name.text}`)
        : [];
    if (!head.length && !named.length) return null;

    const oneLine = `import ${typeOnly}${[...head, named.length ? `{ ${named.join(", ")} }` : ""].filter(Boolean).join(", ")} from "${spec}";`;
    if (oneLine.length <= 96 || !named.length) return oneLine;
    // Long member lists read better stacked, which is how the previews write them.
    const lead = [...head, "{"].join(", ");
    return `import ${typeOnly}${lead}\n${named.map(n => `    ${n}`).join(",\n")}\n} from "${spec}";`;
}

/** Source text of a statement, including the comment block written above it. */
function statementText(stmt, src) {
    const ranges = ts.getLeadingCommentRanges(src, stmt.getFullStart()) || [];
    return src.slice(ranges.length ? ranges[0].pos : stmt.getStart(), stmt.end);
}

/**
 * First named export of an authored preview — real, render-verified usage.
 *
 * Everything that export transitively references comes with it: the helper
 * hooks, sample data and card components a preview declares above it, plus the
 * imports that back them, narrowed to the names this example actually uses.
 * Slicing the file textually instead (the first cut of this) shipped examples
 * that called undefined helpers and, because the single-line import regex never
 * matched a multi-line `import {` block, examples with no imports at all — a
 * reader copying one got a ReferenceError.
 */
function readExample(name) {
    const f = path.join(PREVIEWS, `${name}.tsx`);
    if (!fs.existsSync(f)) return null;
    const src = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    /** @type {Map<string, ts.Statement>} */
    const declaredBy = new Map();
    /** @type {Map<string, ts.ImportDeclaration>} */
    const importedBy = new Map();
    for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt)) {
            for (const local of importBindings(stmt)) importedBy.set(local, stmt);
        } else {
            for (const n of declaredNames(stmt)) declaredBy.set(n, stmt);
        }
    }

    const isExported = s => s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    const entry = sf.statements.find(s =>
        !ts.isImportDeclaration(s) && isExported(s) && declaredNames(s).some(n => /^[A-Z]/.test(n)));
    if (!entry) return null;

    const keep = new Set([entry]);
    /** @type {Map<ts.ImportDeclaration, Set<string>>} */
    const usedImports = new Map();
    const queue = [entry];
    while (queue.length) {
        for (const ref of referencedNames(queue.pop())) {
            const imp = importedBy.get(ref);
            if (imp) {
                if (!usedImports.has(imp)) usedImports.set(imp, new Set());
                usedImports.get(imp).add(ref);
                continue;
            }
            const decl = declaredBy.get(ref);
            if (decl && !keep.has(decl)) { keep.add(decl); queue.push(decl); }
        }
    }

    const importLines = sf.statements
        .filter(s => ts.isImportDeclaration(s) && usedImports.has(s))
        // A preview-local path would not resolve for a reader; nothing but bare
        // package specifiers belongs in a copy-pasteable example.
        .filter(s => !s.moduleSpecifier.text.startsWith("."))
        .map(s => printImport(s, usedImports.get(s)))
        .filter(Boolean);

    const body = sf.statements
        .filter(s => keep.has(s))
        .map(s => statementText(s, src).trim())
        .join("\n\n");

    return [...importLines, "", body].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

// Only `|` needs escaping: these land inside inline code spans, which MDX does
// not parse as JSX, and HTML entities are NOT decoded inside a code span — so
// escaping <> would render the entities literally.
const esc = s => String(s).replace(/\|/g, "\\|");

fs.rmSync(OUT, { recursive: true, force: true });

const bySection = {};
let total = 0, withExample = 0, withProps = 0;

for (const group of fs.readdirSync(SRC)) {
    const section = SECTION[group];
    if (!section) { console.warn(`  ! unmapped group "${group}" — skipped`); continue; }
    for (const name of fs.readdirSync(path.join(SRC, group))) {
        const dtsPath = path.join(SRC, group, name, `${name}.d.ts`);
        if (!fs.existsSync(dtsPath)) continue;
        const dts = fs.readFileSync(dtsPath, "utf8");
        const props = readProps(dts, name);
        const example = readExample(name);
        const summary = (dts.match(/\/\*\*\s*\n\s*\*\s*(.+?)\s*\n/) || [])[1] || `${name} from @rebasepro/ui.`;

        let md = `---\ntitle: ${name}\nsidebar_label: ${name}\n`;
        md += `description: ${name} — a component from @rebasepro/ui, the library the Rebase admin panel is built from.\n---\n\n`;
        md += `\`\`\`ts\nimport { ${name} } from "@rebasepro/ui";\n\`\`\`\n\n`;

        if (props.length) {
            withProps++;
            md += `## Props\n\n| Prop | Type | Required | Description |\n| --- | --- | --- | --- |\n`;
            for (const p of props) {
                md += `| \`${p.name}\` | \`${esc(p.type)}\` | ${p.required ? "yes" : "—"} | ${esc(p.doc)} |\n`;
            }
            md += `\n`;
        } else {
            md += `> This component takes no documented props, or its type could not be flattened. See the source.\n\n`;
        }

        if (example) {
            withExample++;
            md += `## Example\n\nThis is the example the design-system sync renders and verifies for this component.\n\n`;
            md += "```tsx\n" + example + "\n```\n";
        }

        const dir = path.join(OUT, section);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${name}.mdx`), md);
        (bySection[section] ||= []).push(name);
        total++;
    }
}

// section index pages so the sidebar has a landing entry per group
for (const [section, names] of Object.entries(bySection)) {
    const label = SECTION_LABEL[section] || section;
    let md = `---\ntitle: ${label}\nsidebar_label: Overview\n`;
    md += `description: ${label} in @rebasepro/ui — the component library the Rebase admin panel is built from.\n---\n\n`;
    md += `${names.length} components.\n\n`;
    md += names.sort().map(n => `- [${n}](/docs/ui/${section}/${n.toLowerCase()})`).join("\n") + "\n";
    fs.writeFileSync(path.join(OUT, section, "index.mdx"), md);
}

console.log(`generated ${total} component pages into website/src/content/docs/docs/ui/`);
console.log(`  with props table: ${withProps}`);
console.log(`  with verified example: ${withExample}`);
Object.entries(bySection).forEach(([s, n]) => console.log(`  ${s}: ${n.length}`));
