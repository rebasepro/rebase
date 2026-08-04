import fs from "fs";
import path from "path";
import { UNRENDERED_SLOTS } from "../src/types/slots";

/**
 * Every declared slot is either rendered or admitted to be unrendered.
 *
 * `SlotRegistry` is the public plugin API: each key has a props interface and a
 * row in the docs' slot reference. Seven of the twenty-nine were declared,
 * documented in six locales, and rendered nowhere — so registering for one did
 * nothing at all, silently.
 *
 * This derives the truth by scanning the packages that render slots, and
 * compares it against `UNRENDERED_SLOTS`. Both directions fail:
 *
 *   * a slot that is declared and rendered nowhere, and not admitted, is the
 *     original bug arriving again;
 *   * a slot listed as unrendered that has since been implemented leaves the
 *     list describing a codebase that no longer exists — and, worse, keeps
 *     `Rebase` warning about a slot that now works.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SEARCHED = ["packages/admin/src", "packages/app/src", "packages/studio/src"];
const SLOTS_FILE = path.join(ROOT, "packages/admin-types/src/types/slots.tsx");

/** Slot names, read from the declaration rather than restated here. */
function declaredSlots(): string[] {
    const source = fs.readFileSync(SLOTS_FILE, "utf8");
    const registry = source.slice(
        source.indexOf("export interface SlotRegistry"),
        source.indexOf("export type SlotName")
    );
    return [...registry.matchAll(/^\s+"([a-z][a-z.-]+)":/gm)].map(m => m[1]);
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

describe("plugin slots", () => {
    it("renders every slot it declares, or says which it does not", () => {
        const corpus = SEARCHED.flatMap(sourceFiles)
            .map(f => fs.readFileSync(f, "utf8"))
            .join("\n");

        const unrendered = declaredSlots().filter(slot => !corpus.includes(`"${slot}"`));

        expect([...unrendered].sort()).toEqual([...UNRENDERED_SLOTS].sort());
    });

    it("finds a plausible number of slots, so a broken scan cannot pass vacuously", () => {
        // If the registry parse returned nothing, the assertion above would
        // compare two empty arrays and succeed while checking nothing.
        expect(declaredSlots().length).toBeGreaterThan(20);
    });
});
