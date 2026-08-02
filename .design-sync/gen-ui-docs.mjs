/**
 * Generate the @rebasepro/ui component reference into the Starlight docs.
 *
 * Source of truth is the design-sync output, not hand-written prose:
 *   ds-bundle/components/<group>/<Name>/<Name>.d.ts  → the props table
 *   .design-sync/previews/<Name>.tsx                 → the usage example
 *
 * Both are already verified by the sync — the .d.ts is extracted from the
 * shipped types and every preview is confirmed to render in headless chromium.
 * That is the whole point: the previous hand-maintained showcase drifted into
 * an unlinked 14,000px orphan because nothing tied it to the library.
 *
 * Run: node .design-sync/gen-ui-docs.mjs
 */
import fs from "fs";
import path from "path";

const ROOT = "/Users/francesco/rebase";
const SRC = path.join(ROOT, "ds-bundle/components");
const PREVIEWS = path.join(ROOT, ".design-sync/previews");
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

/** First named export of an authored preview — real, render-verified usage. */
function readExample(name) {
    const f = path.join(PREVIEWS, `${name}.tsx`);
    if (!fs.existsSync(f)) return null;
    const src = fs.readFileSync(f, "utf8");
    const imports = [...src.matchAll(/^import .*?;$/gm)].map(m => m[0])
        .filter(l => l.includes("@rebasepro/ui"));
    // grab the first `export const X = ...` / `export function X`
    const start = src.search(/^export (const|function) [A-Z]/m);
    if (start < 0) return null;
    let body = src.slice(start);
    // cut at the next top-level export
    const next = body.slice(1).search(/^export (const|function) [A-Z]/m);
    if (next > 0) body = body.slice(0, next + 1);
    body = body.replace(/\n{3,}/g, "\n\n").trimEnd();
    return [...imports, "", body].join("\n");
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
