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
    { id: "01", words: ["Getting", "a", "backend", "has", "never", "been", "easier.", "Knowing", "whether", "it", "is", "safe", "never", "got", "easier."] },
    { id: "02", words: ["Authorization", "belongs", "in", "the", "database,", "where", "code", "cannot", "forget", "to", "ask."] },
    { id: "03", words: ["One", "definition,", "and", "everything", "else", "is", "compiled", "from", "it."] },
    { id: "04", words: ["REST,", "an", "OpenAPI", "spec,", "a", "typed", "SDK.", "None", "of", "it", "written."] },
    { id: "05", words: ["A", "backend", "for", "Postgres.", "The", "one", "you", "choose."] },
    { id: "06", words: ["Take", "only", "that:", "SDK,", "auth,", "storage,", "functions,", "cron,", "backups."] },
    { id: "07", words: ["Realtime", "too", "\u2014", "and", "the", "rows", "you", "cannot", "see", "never", "arrive."] },
    { id: "08", words: ["Or", "add", "the", "panel,", "and", "the", "same", "definition", "becomes", "an", "application", "for", "everyone", "else."] },
    { id: "09", words: ["Lists,", "boards,", "tables,", "forms.", "Every", "one", "of", "them", "generated."] },
    { id: "10", words: ["Add", "Studio", "and", "run", "the", "database", "from", "the", "same", "app."] },
    { id: "11", words: ["Drawn", "from", "the", "catalogue,", "so", "it", "is", "what", "is", "actually", "there."] },
    { id: "12", words: ["Per", "collection,", "per", "operation,", "per", "role.", "Postgres", "enforces", "every", "cell."] },
    { id: "13", words: ["The", "same", "call,", "two", "people,", "different", "rows.", "No", "branch", "anywhere."] },
    { id: "14", words: ["And", "rls-check", "will", "tell", "you", "the", "same", "about", "any", "Postgres."] },
    { id: "15", words: ["An", "agent", "gets", "the", "same", "authorization", "you", "do."] },
    { id: "16", words: ["Three", "commands,", "and", "all", "of", "it", "runs", "against", "your", "database."] },
    { id: "17", words: ["MIT,", "end", "to", "end.", "Nobody", "else", "holds", "your", "keys."] },
    { id: "18", words: ["Rebase.", "Open", "source.", "Postgres-native."] },
];
