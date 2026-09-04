/**
 * The voiceover, as data — so the film can render it and the rhythm can be
 * judged before anyone records it.
 *
 * Kept in step with VOICEOVER.md by hand, which is fine while it is a testing
 * aid and would not be if it ever shipped. Nothing in RebaseIntro reads this;
 * only the RebaseIntro-VO composition does.
 *
 * WORDS_PER_SECOND is 2.5 — 150 words a minute, an ordinary pace for technical
 * narration. The lines are written to occupy about 55% of their scene rather
 * than all of it: a line that fits its scene exactly is a line delivered with
 * no pause before or after it, and eight of these used to be over 88%.
 */
export const WORDS_PER_SECOND = 2.5;

/** Frames before the first word of a scene's line. */
export const LEAD_IN = 10;

export const NARRATION: { id: string; words: string[] }[] = [
    { id: "01", words: ["An", "afternoon", "to", "build.", "Ten", "seconds", "to", "find", "what", "it", "missed."] },
    { id: "02", words: ["Every", "client", "hits", "it,", "including", "the", "ones", "you", "did", "not", "write."] },
    { id: "03", words: ["One", "definition,", "and", "everything", "else", "is", "compiled", "from", "it."] },
    { id: "04", words: ["The", "same", "file", "also", "wrote", "an", "OpenAPI", "spec", "and", "a", "typed", "SDK."] },
    { id: "05", words: ["Everything", "after", "this", "point", "is", "optional."] },
    { id: "06", words: ["And", "the", "panel's", "packages", "are", "never", "installed", "on", "this", "path."] },
    { id: "07", words: ["You", "did", "not", "write", "a", "subscription", "server,", "or", "decide", "who", "may", "listen."] },
    { id: "08", words: ["Delete", "it", "tomorrow", "and", "not", "one", "API", "response", "changes", "for", "anyone."] },
    { id: "09", words: ["Lists,", "boards,", "tables,", "forms.", "Every", "one", "of", "them", "generated."] },
    { id: "10", words: ["No", "psql", "tab,", "and", "no", "second", "set", "of", "credentials."] },
    { id: "11", words: ["Nobody", "maintains", "this", "drawing,", "because", "nobody", "drew", "it."] },
    { id: "12", words: ["Forty", "of", "these,", "and", "one", "file", "decides", "them", "all."] },
    { id: "13", words: ["Neither", "of", "them", "can", "ask", "for", "the", "other's", "rows."] },
    { id: "14", words: ["Run", "it", "on", "what", "you", "have", "now,", "before", "believing", "any", "of", "this."] },
    { id: "15", words: ["There", "is", "nothing", "to", "talk", "into", "giving", "it", "more."] },
    { id: "16", words: ["No", "account,", "no", "container", "to", "pull,", "nothing", "to", "sign", "up", "for."] },
    { id: "17", words: ["MIT,", "end", "to", "end.", "Nobody", "else", "holds", "your", "keys."] },
    { id: "18", words: ["Start", "with", "the", "one", "you", "already", "have."] },
];
