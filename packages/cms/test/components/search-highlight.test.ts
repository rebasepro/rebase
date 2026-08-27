import { splitOnTerms, searchTerms, offSlotMatch, localRowMatch, snippetAround, trimSnippetLead } from "../../src/components/CollectionViewBinding/SearchHighlight";
import { withListState } from "../../src/util/view_mode";
import { fieldLabel } from "../../src/components/CollectionViewBinding/SearchExplanation";

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

describe("localRowMatch — explaining a hit the server did not annotate", () => {
    const properties = {
        title: { type: "string", name: "Title" },
        excerpt: { type: "string", name: "Excerpt" },
        status: { type: "string", enum: [{ id: "published", label: "Published" }] },
        tags: { type: "array", of: { type: "string" } },
        meta: { type: "map", properties: { notes: { type: "string" } } }
    };

    it("finds the term in a field the list is not showing", () => {
        const m = localRowMatch(
            { title: "Nothing here", excerpt: "A note about latency budgets" },
            properties, ["latency"], ["title"]
        );
        expect(m?.field).toBe("excerpt");
        expect(m?.snippet).toContain("<mark>latency</mark>");
    });

    it("skips fields the row already displays", () => {
        const m = localRowMatch(
            { title: "All about latency", excerpt: "unrelated" },
            properties, ["latency"], ["title"]
        );
        expect(m).toBeUndefined();
    });

    it("reaches into arrays", () => {
        const m = localRowMatch(
            { tags: ["perf", "latency budget"] }, properties, ["latency"], []
        );
        expect(m?.field).toBe("tags");
    });

    it("reaches into nested maps and reports the dotted path", () => {
        const m = localRowMatch(
            { meta: { notes: "watch the latency" } }, properties, ["latency"], []
        );
        expect(m?.field).toBe("meta.notes");
    });

    it("ignores enums — a chip from a fixed vocabulary is not an explanation", () => {
        const m = localRowMatch({ status: "published" }, properties, ["published"], []);
        expect(m).toBeUndefined();
    });

    it("returns the first field in declared order, so authored priority wins", () => {
        const m = localRowMatch(
            { title: "x", excerpt: "latency here", tags: ["latency there"] },
            properties, ["latency"], ["title"]
        );
        expect(m?.field).toBe("excerpt");
    });

    it("returns nothing when the row does not contain the term", () => {
        expect(localRowMatch({ excerpt: "nothing" }, properties, ["latency"], [])).toBeUndefined();
    });
});

describe("snippetAround", () => {
    const long = "The planner ignoring your index is usually correct, and the reason it does is that tail latency does not show up in a modest average at all, which is the whole point of this section.";

    it("trims a long field to a readable window around the hit", () => {
        const s = snippetAround(long, ["latency"])!;
        expect(s).toContain("<mark>latency</mark>");
        expect(s.length).toBeLessThan(long.length);
        expect(s.startsWith("…")).toBe(true);
    });

    it("opens at a word boundary, not mid-word", () => {
        const s = snippetAround(long, ["latency"])!;
        // The first word after the ellipsis must be a whole word of the source,
        // not the tail of one the trim cut through.
        const firstWord = s.replace(/^…/, "").split(/\s/)[0];
        expect(new RegExp(`(^|\\s)${firstWord}(\\s|$)`).test(long)).toBe(true);
    });

    it("keeps a short field whole rather than trimming it", () => {
        expect(snippetAround("ISO 14001 auditor", ["iso"])).toBe("<mark>ISO</mark> 14001 auditor");
    });

    it("returns nothing when there is no hit", () => {
        expect(snippetAround(long, ["nomatch"])).toBeUndefined();
    });
});

describe("fieldLabel", () => {
    const properties = {
        title: { name: "Title", type: "string" },
        content: { name: "Content", type: "array" },
        questionnaire: { name: "Questionnaire", type: "map",
            properties: { certifications: { name: "Certifications", type: "array" } } },
        untitled_field: { type: "string" }
    };

    it("uses the declared name", () => {
        expect(fieldLabel(properties, "title")).toBe("Title");
    });

    it("uses the nested property's name for a dotted path", () => {
        expect(fieldLabel(properties, "questionnaire.certifications")).toBe("Certifications");
    });

    it("keeps the last declared name when the path runs deeper than the schema", () => {
        // `content` is an array of blocks; `content.value` is not declared
        // property-by-property. Labelling that "Value" is what shipped to the
        // screen once — the reader wants "Content".
        expect(fieldLabel(properties, "content.value")).toBe("Content");
    });

    it("humanises an undeclared name rather than showing a raw path", () => {
        expect(fieldLabel(properties, "untitled_field")).toBe("Untitled field");
    });

    it("survives an unknown property", () => {
        expect(fieldLabel(properties, "nope")).toBe("Nope");
    });
});

describe("withListState — a record opened from a search comes back to it", () => {
    it("carries the search onto the entity URL", () => {
        expect(withListState("/c/posts/abc", "?search=latency"))
            .toBe("/c/posts/abc?search=latency");
    });

    it("carries filters and sort too, which have no fixed names", () => {
        const out = withListState("/c/posts/abc", "?search=x&__sort=title&status=eq.published");
        expect(out).toContain("__sort=title");
        expect(out).toContain("status=eq.published");
    });

    it("does not overwrite a param the target already sets", () => {
        expect(withListState("/c/posts/abc?__view=table", "?__view=list"))
            .toBe("/c/posts/abc?__view=table");
    });

    it("keeps the hash after the query, where it belongs", () => {
        expect(withListState("/c/posts/new#new", "?search=x"))
            .toBe("/c/posts/new?search=x#new");
    });

    it("leaves a URL alone when there is no list state to carry", () => {
        expect(withListState("/c/posts/abc", "")).toBe("/c/posts/abc");
    });
});

describe("offSlotMatch with the joined shown-keys round trip", () => {
    const matches = [
        { field: "full_name", snippet: "a" },
        { field: "questionnaire.certifications", snippet: "b" }
    ];

    it("round-trips dotted paths through the memo key", () => {
        // The hook joins the shown keys into a string to make the memo compare
        // by value, then splits them back. A separator that appears inside a
        // path — or an empty one — silently turns one key into several and the
        // exclusion stops working.
        expect(offSlotMatch(matches, "full_name|questionnaire.certifications".split("|")))
            .toBeUndefined();
        expect(offSlotMatch(matches, "full_name|".split("|").map(k => k || undefined))?.field)
            .toBe("questionnaire.certifications");
    });
});

describe("trimSnippetLead — the mark has to survive a narrow column", () => {
    /**
     * `ts_headline` centres its fragment on the match, so about half the
     * window is lead-in. In a list beside an open record that column is narrow
     * enough that the truncation lands before the mark, and the row shows a
     * fragment of the record with nothing highlighted in it — which reads as
     * the feature being broken.
     */
    const centred = "different statements. The second lets a <mark>planner</mark> de-risk by checking the API";

    it("pulls a centred fragment's mark to the front", () => {
        const out = trimSnippetLead(centred);
        expect(out.indexOf("<mark>")).toBeLessThanOrEqual(17);
        expect(out.startsWith("…")).toBe(true);
    });

    it("keeps the trailing context, which is what explains the hit", () => {
        expect(trimSnippetLead(centred)).toContain("de-risk by checking the API");
    });

    it("leaves a snippet that already opens near the mark alone", () => {
        const short = "the <mark>planner</mark> ignores your index";
        expect(trimSnippetLead(short)).toBe(short);
    });

    it("opens at a word boundary rather than mid-word", () => {
        const out = trimSnippetLead(centred).replace(/^…/, "");
        const firstWord = out.split(/\s/)[0];
        expect(new RegExp(`(^|\\s)${firstWord}(\\s|$)`).test(centred)).toBe(true);
    });

    it("leaves text with no mark untouched", () => {
        expect(trimSnippetLead("nothing marked here at all, quite a long line of it"))
            .toBe("nothing marked here at all, quite a long line of it");
    });

    it("never splits the mark tag itself", () => {
        // Cutting inside `<mark>` would render the tag as literal text.
        for (let lead = 0; lead < 40; lead++) {
            const out = trimSnippetLead(centred, lead);
            expect(out).toContain("<mark>planner</mark>");
        }
    });
});
