import fs from "fs";
import path from "path";

/**
 * Every declared component override is resolved somewhere.
 *
 * `AppComponentName` and `CollectionComponentName` are the public override
 * API: each name is a row in the docs' override table. Three of them —
 * `"Shell.AppBar"`, `"HomePage.CollectionCard"`, `"Auth.LoginView"` — were
 * declared, documented, shown in the `<Rebase components>` example, and passed
 * to `useComponentOverride` nowhere, so an app that set one got nothing and no
 * warning. The sibling of `slot-render-sites.test.ts`, for the same bug in the
 * other extension API.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SEARCHED = ["packages/cms/src", "packages/app/src", "packages/studio/src"];
const OVERRIDES_FILE = path.join(ROOT, "packages/cms-types/src/types/component_overrides.ts");

/** The names, read from the two unions rather than restated here. */
function declaredOverrideNames(): string[] {
    const source = fs.readFileSync(OVERRIDES_FILE, "utf8");
    const unions = ["AppComponentName", "CollectionComponentName"].map(name => {
        const start = source.indexOf(`export type ${name} =`);
        return source.slice(start, source.indexOf(";", start));
    });
    return unions.flatMap(union => [...union.matchAll(/\|\s*"([A-Za-z.]+)"/g)].map(m => m[1]));
}

function sourceFiles(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out: string[] = [];
    const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
        }
    };
    walk(abs);
    return out;
}

describe("component overrides", () => {
    it("resolves every override name it declares", () => {
        const corpus = SEARCHED.flatMap(sourceFiles)
            .map(f => fs.readFileSync(f, "utf8"))
            .join("\n");

        const unresolved = declaredOverrideNames().filter(name =>
            !new RegExp(`useComponentOverride(<[^>]*>)?\\(\\s*"${name.replace(/\./g, "\\.")}"`).test(corpus));

        expect(unresolved).toEqual([]);
    });

    it("finds a plausible number of names, so a broken scan cannot pass vacuously", () => {
        expect(declaredOverrideNames().length).toBeGreaterThan(15);
    });
});
