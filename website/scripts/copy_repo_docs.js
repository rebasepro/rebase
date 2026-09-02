/**
 * Mirror repository-root documents into the docs site.
 *
 * These files are authored at the repo root because that is where they are
 * referenced from — `CONTRIBUTING.md` links `docs/compatibility.md`,
 * `contracts/derived-names.txt` cites "contract 6" in it, and several audits
 * cite it by line number. Copying rather than moving keeps those references
 * working while still publishing the content, and `pnpm run check:generated`
 * diffs the copies so the two cannot drift.
 *
 * Adding a document here means adding its destination to `check:generated` in
 * the root `package.json`, or the mirror is generated but never gated.
 *
 * A document with `englishOnlyLocales` is mirrored into the other five locales
 * too, behind a note saying the translation is pending. That exists because the
 * sidebar entry is the same in every language: without the file, five of six
 * readers follow a link to a 404. They were first written by hand, which meant
 * that from the next entry onwards a German reader was served a changelog
 * missing it — the copies had no generator and nothing compared them. Generated
 * and gated here instead, so "translated later" cannot quietly become "frozen in
 * September".
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The pending-translation banner, per locale.
 *
 * Wording is each locale's own rather than a machine translation of one string:
 * these are the exact notes the hand-written mirrors carried, kept so this
 * change alters no rendered page.
 */
const ENGLISH_ONLY_NOTE = {
    de: {
        heading: "Diese Seite ist nur auf Englisch verfügbar",
        body: "Die Übersetzung steht noch aus. Der Inhalt unten ist auf Englisch."
    },
    es: {
        heading: "Esta página solo está disponible en inglés",
        body: "La traducción está pendiente. El contenido siguiente está en inglés."
    },
    fr: {
        heading: "Cette page n'est disponible qu'en anglais",
        body: "La traduction est à venir. Le contenu ci-dessous est en anglais."
    },
    it: {
        heading: "Questa pagina è disponibile solo in inglese",
        body: "La traduzione è in arrivo. Il contenuto qui sotto è in inglese."
    },
    pt: {
        heading: "Esta página está disponível apenas em inglês",
        body: "A tradução está pendente. O conteúdo abaixo está em inglês."
    }
};

const DOCUMENTS = [
    {
        source: "../../CHANGELOG.md",
        dest: "../src/content/docs/docs/CHANGELOG.md",
        // Starlight renders the frontmatter title as the page heading. The
        // changelog keeps its own `# Changelog` for historical reasons; a new
        // mirror should drop the H1 rather than render two.
        stripH1: false,
        // Starlight resolves the locale from the directory, so all six pages
        // share this slug and still build to distinct URLs.
        englishOnlyLocales: "../src/content/docs/{locale}/docs/CHANGELOG.md",
        frontmatter: `---
slug: docs/changelog
title: Changelog
description: Every released change to Rebase — new features, fixes, and the breaking changes each version asks you to migrate.
---
`
    },
    {
        source: "../../docs/compatibility.md",
        dest: "../src/content/docs/docs/compatibility.md",
        stripH1: true,
        frontmatter: `---
slug: docs/compatibility
title: Compatibility
description: What Rebase promises across versions and what it does not — the six versioned contracts, how each one fails, and what may still change in a minor.
---

`
    }
];

let failed = false;

for (const doc of DOCUMENTS) {
    const sourceFile = path.resolve(__dirname, doc.source);
    const destFile = path.resolve(__dirname, doc.dest);

    if (!fs.existsSync(sourceFile)) {
        console.error(`Source file not found: ${sourceFile}`);
        failed = true;
        continue;
    }

    let content = fs.readFileSync(sourceFile, "utf-8");
    if (doc.stripH1 && content.startsWith("# ")) {
        content = content.slice(content.indexOf("\n") + 1).replace(/^\n+/, "");
    }

    fs.writeFileSync(destFile, doc.frontmatter + content, "utf-8");
    console.log(`✓ Mirrored ${path.basename(sourceFile)} → ${path.relative(process.cwd(), destFile)}`);

    if (!doc.englishOnlyLocales) continue;

    for (const [locale, note] of Object.entries(ENGLISH_ONLY_NOTE)) {
        const localeFile = path.resolve(__dirname, doc.englishOnlyLocales.replace("{locale}", locale));
        const banner = `\n:::note[${note.heading}]\n${note.body}\n:::\n`;

        fs.mkdirSync(path.dirname(localeFile), { recursive: true });
        fs.writeFileSync(localeFile, doc.frontmatter + banner + content, "utf-8");
        console.log(`✓ Mirrored ${path.basename(sourceFile)} → ${path.relative(process.cwd(), localeFile)}`);
    }
}

if (failed) process.exit(1);
