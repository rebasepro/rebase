import { splitOnTerms, searchTerms, offSlotMatch } from "../../src/components/CollectionViewBinding/SearchHighlight";

/**
 * The browser-side half of "show me why this row matched".
 *
 * The server sends a snippet for fields the list does not display; for fields
 * it *does* display, the value is re-marked here so the cell keeps the record's
 * real text instead of a folded, truncated fragment. That re-matching is where
 * the mistakes live — marking inside words, losing accents, double-marking
 * overlapping terms — so it is pinned rather than eyeballed.
 */
describe("splitOnTerms", () => {
    const marked = (text: string, terms: string[]) =>
        splitOnTerms(text, terms).filter(s => s.hit).map(s => s.text);

    const rendered = (text: string, terms: string[]) =>
        splitOnTerms(text, terms).map(s => s.text).join("");

    it("marks a whole-word hit", () => {
        expect(marked("ISO 14001 Lead Auditor", ["iso"])).toEqual(["ISO"]);
    });

    it("keeps the record's own casing and accents in the marked text", () => {
        // The index is folded and lowercased; the cell must not be.
        expect(marked("Gestión Ambiental", ["gestion"])).toEqual(["Gestión"]);
        expect(marked("Ana Gutiérrez", ["gutierrez"])).toEqual(["Gutiérrez"]);
    });

    it("never loses or reorders the original text", () => {
        const text = "Auditoría de Gestión Ambiental — ISO 14001";
        for (const terms of [["iso"], ["gestion", "auditoria"], ["nomatch"], []]) {
            expect(rendered(text, terms)).toBe(text);
        }
    });

    it("marks at a word start only — not inside another word", () => {
        // "iso" lives inside "revisor"; marking it reads as a bug.
        expect(marked("Revisor de riesgos", ["iso"])).toEqual([]);
        expect(marked("Revisor ISO", ["iso"])).toEqual(["ISO"]);
    });

    it("marks every occurrence, not just the first", () => {
        expect(marked("ISO 9001 e ISO 14001", ["iso"])).toEqual(["ISO", "ISO"]);
    });

    it("merges overlapping terms into one mark rather than nesting them", () => {
        const segments = splitOnTerms("auditoria ambiental", ["auditoria", "auditoria ambiental"]);
        expect(segments.filter(s => s.hit)).toHaveLength(1);
        expect(segments.filter(s => s.hit)[0].text).toBe("auditoria ambiental");
    });

    it("ignores one-character terms, which would mark half the row", () => {
        expect(marked("ISO 14001", ["i"])).toEqual([]);
    });

    it("marks nothing rather than guessing when the stem differs", () => {
        // The server matched `auditores` to `Auditor` by stemming. The browser
        // cannot stem without reimplementing the text search config, so it
        // marks nothing here — an absent highlight, not a wrong one.
        expect(marked("Auditor de sistemas", ["auditores"])).toEqual([]);
    });

    it("returns a single unmarked segment when there is nothing to mark", () => {
        expect(splitOnTerms("Marketing", ["iso"])).toEqual([{ text: "Marketing", hit: false }]);
    });
});

describe("searchTerms", () => {
    it("splits on whitespace", () => {
        expect(searchTerms("auditor iso")).toEqual(["auditor", "iso"]);
    });

    it("keeps a quoted phrase whole, as websearch_to_tsquery does", () => {
        expect(searchTerms('"ISO 14001" auditor')).toEqual(["ISO 14001", "auditor"]);
    });

    it("drops an excluded term — marking what the user excluded would be wrong", () => {
        expect(searchTerms("auditor -junior")).toEqual(["auditor"]);
    });

    it("drops the boolean operators rather than marking them as words", () => {
        expect(searchTerms("iso OR gri")).toEqual(["iso", "gri"]);
    });

    it("is empty for an empty search", () => {
        expect(searchTerms(undefined)).toEqual([]);
        expect(searchTerms("")).toEqual([]);
    });
});

describe("offSlotMatch", () => {
    const matches = [
        { field: "full_name", snippet: "Ana <mark>ISO</mark>" },
        { field: "questionnaire.certifications", snippet: "<mark>ISO</mark> 14001" }
    ];

    it("returns the first match the list is not already showing", () => {
        expect(offSlotMatch(matches, ["full_name"])?.field).toBe("questionnaire.certifications");
    });

    it("returns nothing when every match is already visible", () => {
        expect(offSlotMatch(matches, ["full_name", "questionnaire.certifications"])).toBeUndefined();
    });

    it("respects the declared field order, so the author's priority wins", () => {
        expect(offSlotMatch(matches, [])?.field).toBe("full_name");
    });

    it("tolerates undefined slot keys, which is what an unset slot looks like", () => {
        expect(offSlotMatch(matches, [undefined, "full_name"])?.field).toBe("questionnaire.certifications");
    });

    it("returns nothing when the row did not match anything", () => {
        expect(offSlotMatch(undefined, ["full_name"])).toBeUndefined();
        expect(offSlotMatch([], ["full_name"])).toBeUndefined();
    });
});
