/**
 * Every key the panel asks for has to exist.
 *
 * i18next answers a key it does not know with *the key*. Not an error, not
 * empty, not the English — the literal string `sort_then_by`, rendered into the
 * interface as if it were a translation. Nothing in the type system stops it
 * either: `t` takes a `string`.
 *
 * So a control can ship with six labels that read as identifiers and no test,
 * typecheck or lint will say a word. That is not hypothetical — it is how this
 * file came to exist. The multi-column sort menu referenced `sort_then_by`,
 * `sort_move_up`, `sort_move_down`, `sort_remove_key`, `sort_ascending` and
 * `sort_descending`, and not one of the seven locale files declared any of
 * them. The popover's section heading said "sort_then_by".
 *
 * `en.ts` is the authority rather than the `RebaseTranslations` interface,
 * because English is also the *runtime* fallback: `RebaseI18nProvider` seeds
 * every other locale from it, so a key missing there is missing everywhere no
 * matter what the type declares.
 *
 * ## Scope
 *
 * Both source trees, because one catalogue serves both: the strings live in
 * `@rebasepro/app` and the admin's components are the largest consumer of them.
 *
 * Only literal keys — `t("save")`, not `t(dynamicKey)` or `` t(`x_${n}`) ``.
 * A dynamic key cannot be checked from here, and pretending otherwise would
 * mean either false failures or a regex nobody trusts.
 */
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const EN = path.join(ROOT, "packages/app/src/locales/en.ts");
const SOURCE_ROOTS = ["packages/app/src", "packages/admin/src"];

/** Top-level keys of the `en` catalogue, which is a flat object literal. */
function declaredKeys(): Set<string> {
    const source = fs.readFileSync(EN, "utf8");
    return new Set([...source.matchAll(/^ {4}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(m => m[1]));
}

function sourceFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
        return [full];
    });
}

/** `t("key")` / `t('key', …)`, and nothing that is not a literal. */
function usedKeys(): Map<string, string[]> {
    const used = new Map<string, string[]>();
    for (const root of SOURCE_ROOTS) {
        for (const file of sourceFiles(path.join(ROOT, root))) {
            const source = fs.readFileSync(file, "utf8");
            for (const match of source.matchAll(/\bt\(\s*["']([a-z0-9_]+)["']/g)) {
                const at = `${path.relative(ROOT, file)}`;
                const seen = used.get(match[1]) ?? [];
                if (!seen.includes(at)) seen.push(at);
                used.set(match[1], seen);
            }
        }
    }
    return used;
}

describe("translation keys", () => {
    const declared = declaredKeys();
    const used = usedKeys();

    it("finds the catalogue and the call sites", () => {
        // Guards the guard: a moved locales directory or a changed `t` spelling
        // would make the assertion below vacuously pass.
        expect(declared.size).toBeGreaterThan(500);
        expect(used.size).toBeGreaterThan(100);
    });

    it("declares every key the panel renders", () => {
        const missing = [...used.entries()]
            .filter(([key]) => !declared.has(key))
            .map(([key, files]) => `${key}  (${files[0]}${files.length > 1 ? ` +${files.length - 1}` : ""})`)
            .sort();

        // The remedy rides along in the expected value, so a failure reads as
        // "add these to en.ts" rather than as a bare diff.
        expect({ addToEnTs: missing }).toEqual({ addToEnTs: [] });
    });

    it("adds no new locale to the untranslated backlog", () => {
        // English is the runtime fallback, so a key present in `en.ts` and
        // absent elsewhere renders in English rather than as an identifier —
        // a milder failure than the one above, and one with 159 instances
        // already in the tree.
        //
        // Hence a baseline rather than a bare zero, for the reason
        // `scripts/check-untranslated.mjs` gives about its own: 159 ambient
        // findings make the 160th invisible, and the 160th arrives every time
        // somebody adds a key to `en.ts` and stops. Translate a line and drop
        // it from the baseline; the file only ever shrinks.
        const localesDir = path.join(ROOT, "packages/app/src/locales");
        const others = fs.readdirSync(localesDir)
            .filter(f => f.endsWith(".ts") && f !== "en.ts" && !f.endsWith(".test.ts"));
        expect(others.length).toBeGreaterThan(0);

        const referenced = [...used.keys()].filter(key => declared.has(key));
        const gaps: string[] = [];
        for (const file of others) {
            const source = fs.readFileSync(path.join(localesDir, file), "utf8");
            const keys = new Set([...source.matchAll(/^ {4}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(m => m[1]));
            for (const key of referenced) {
                if (!keys.has(key)) gaps.push(`${file}: ${key}`);
            }
        }

        const baseline: string[] = JSON.parse(
            fs.readFileSync(path.join(__dirname, "translation-keys-baseline.json"), "utf8")
        );
        const added = gaps.filter(gap => !baseline.includes(gap)).sort();
        const fixed = baseline.filter(gap => !gaps.includes(gap)).sort();

        expect({ addToTheseLocales: added }).toEqual({ addToTheseLocales: [] });
        // Ratchet: a translated line has to leave the baseline, or the file
        // stops describing anything and the next regression hides behind it.
        expect({ removeFromBaseline: fixed }).toEqual({ removeFromBaseline: [] });
    });
});
