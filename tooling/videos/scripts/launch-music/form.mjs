/**
 * The film's form, as the arrangements read it: which section a bar is in,
 * where it sits inside it, and which of the three grooves a verb gets.
 *
 * Every track plays the same form, because the picture is cut to it: the
 * section starts are the cuts, the claim's words land on beats 0 and 2 of its
 * two bars, and the end card's drop is its first downbeat.
 */
import { BARS, BPM, SECTIONS } from "../../src/launch/score.ts";

export { BARS, BPM };
export const SECONDS = (BARS * 4 * 60) / BPM;

export const ORDER = Object.entries(SECTIONS).map(([name, s]) => ({ name, ...s }));
export const VERBS = ORDER.filter((s) => s.kind === "verb");

/** Everything an arrangement needs to know about one bar. */
export function bar(n) {
    const section = ORDER.find((s) => n >= s.bar && n < s.bar + s.bars);
    const verb = VERBS.findIndex((v) => v.name === section.name);
    return {
        n,
        section,
        kind: section.kind,
        first: n === section.bar,
        last: n === section.bar + section.bars - 1,
        /** Bars into the section. */
        inner: n - section.bar,
        /** The verbs come in pairs, and each pair grooves a little harder:
         *  A (define, secure), B (build, agents), C (manage, shape). */
        groove: verb < 0 ? null : ["A", "A", "B", "B", "C", "C"][verb],
        next: ORDER.find((s) => s.bar === n + 1) ?? null,
        /** The bar that rises into the first verb: the riser lives here,
         *  whatever kind of section it is. */
        intoFirstVerb: n === VERBS[0].bar - 1,
    };
}

export const BAR_LIST = Array.from({ length: BARS }, (_, n) => bar(n));
