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
    { id: "01", words: ["An", "agent", "built", "this", "backend", "in", "an", "afternoon.", "Ten", "seconds", "of", "audit", "found", "two", "ways", "in."] },
    { id: "02", words: ["So", "put", "the", "rules", "where", "nothing", "can", "route", "around", "them."] },
    { id: "03", words: ["You", "write", "the", "collection", "once,", "and", "the", "policies", "come", "from", "it."] },
    { id: "04", words: ["So", "does", "every", "endpoint,", "the", "OpenAPI", "spec,", "and", "a", "typed", "SDK", "that", "knows", "your", "columns."] },
    { id: "05", words: ["One", "package,", "your", "Postgres,", "and", "everything", "that", "follows."] },
    { id: "06", words: ["Auth,", "storage,", "realtime,", "functions,", "cron,", "backups", "\u2014", "running,", "not", "scaffolded."] },
    { id: "07", words: ["Every", "write", "arrives", "on", "a", "socket,", "filtered", "by", "the", "same", "policies,", "without", "a", "subscription", "server."] },
    { id: "08", words: ["Your", "team", "gets", "a", "real", "application", "\u2014", "the", "same", "data,", "the", "same", "API,", "nothing", "duplicated", "for", "them."] },
    { id: "09", words: ["Boards,", "tables,", "cards,", "forms,", "a", "record", "open", "beside", "them.", "All", "generated,", "all", "live."] },
    { id: "10", words: ["And", "you", "run", "the", "database", "from", "inside", "it.", "No", "second", "tool."] },
    { id: "11", words: ["Studio", "reads", "the", "catalogue,", "so", "the", "schema", "you", "are", "looking", "at", "is", "the", "one", "that", "exists."] },
    { id: "12", words: ["Forty", "answers", "here,", "per", "collection,", "per", "role", "\u2014", "and", "one", "file", "decides", "all", "of", "them."] },
    { id: "13", words: ["One", "call,", "two", "people,", "different", "rows.", "Neither", "can", "ask", "for", "the", "other's,", "ever."] },
    { id: "14", words: ["Run", "it", "against", "the", "database", "you", "have", "now,", "before", "you", "believe", "us."] },
    { id: "15", words: ["Agents", "get", "what", "you", "get.", "There", "is", "nothing", "to", "negotiate", "with."] },
    { id: "16", words: ["Three", "commands.", "No", "account,", "no", "container", "to", "pull,", "nothing", "to", "sign", "up", "for."] },
    { id: "17", words: ["MIT,", "end", "to", "end,", "on", "your", "own", "machine.", "Nobody", "holds", "your", "keys."] },
    { id: "18", words: ["Start", "with", "the", "database", "you", "already", "have."] },
];
